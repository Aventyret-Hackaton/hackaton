import { drawBlockText } from '@/lib/voxel/blockFont';
import type { VoxelGrid } from '@/lib/voxel/grid';
import { hash3 } from '@/lib/voxel/hash';
import type { VoxelModelDef } from '@/lib/voxel/model';
import { P } from '@/lib/voxel/palette';

import { S } from './palette';
import { fillRounded } from './shapes';

type Box = readonly [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number];

// A block of leaves, lighter on top and darker underneath.
const paintCrown = (g: VoxelGrid, [x0, x1, y0, y1, z0, z1]: Box): void => {
  fillRounded(g, x0, x1, y0, y1, z0, z1, (x, y, z): number => {
    if (y >= y1 - 1) return S.leafLight;
    if (y === y0) return S.leafDark;
    return hash3(x, y, z) < 0.16 ? S.leafLight : S.leaf;
  });
};

const paintTree = (g: VoxelGrid, half: number, height: number, crowns: readonly Box[]): void => {
  g.fill(-half, half, 0, height, -half, half, S.trunk);
  g.fill(half, half, 0, height, -half, 0, S.trunkDark);
  g.fill(-half, -half + 1, 0, height, half, half, S.trunkDark);
  crowns.forEach((crown) => paintCrown(g, crown));
};

const paintBush = (g: VoxelGrid): void => {
  const leaves = (x: number, y: number, z: number): number => (hash3(x, y, z) < 0.2 ? S.bushDark : S.bush);
  fillRounded(g, -6, 5, 0, 6, -5, 5, leaves);
  fillRounded(g, -2, 8, 3, 10, -6, 2, leaves);
  fillRounded(g, -9, -3, 0, 4, -2, 4, leaves);
};

const paintBloom = (g: VoxelGrid): void => {
  g.fill(0, 0, 0, 2, 0, 0, S.tuft);
  g.set(1, 1, 0, S.tuft);
  g.fill(-1, 1, 3, 5, -1, 1, P.pink);
  g.fill(-1, 1, 5, 5, -1, 1, P.pinkLight);
};

const paintTuft = (g: VoxelGrid): void => {
  for (const [x, z, height] of [
    [-2, 0, 1],
    [-1, 0, 2],
    [0, 0, 3],
    [1, 0, 2],
    [2, 0, 1],
    [0, -1, 2],
    [0, 1, 1]
  ]) {
    g.fill(x, x, 0, height - 1, z, z, S.tuft);
  }
};

// How far the mouth of the tunnel reaches to each side at a height, or -1 above it.
const mouthReach = (y: number): number => (y <= 7 ? 5 : y <= 9 ? 4 : y === 10 ? 3 : -1);
const inMouth = (y: number, z: number): boolean => y >= 0 && Math.abs(z) <= mouthReach(y);

// The mouth opens towards +x, with a black wall three voxels in for the train to come through.
const paintPortal = (g: VoxelGrid): void => {
  for (let x = -9; x <= 0; x += 1) {
    for (let y = 0; y <= 13; y += 1) {
      for (let z = -8; z <= 8; z += 1) {
        const open = inMouth(y, z);
        if (open && x >= -2) continue;
        if (open) {
          if (x === -3) g.set(x, y, z, P.black);
          continue;
        }
        const joint = y % 3 === 0 || (z + (Math.floor(y / 3) % 2) * 2 + 16) % 4 === 0;
        const lining = x < 0 && Math.abs(z) <= 6 && y <= 11;
        g.set(x, y, z, lining ? S.tunnel : x === 0 && !joint ? S.stoneLight : S.stone);
      }
    }
  }
  for (let y = 0; y <= 12; y += 1) {
    for (let z = -7; z <= 7; z += 1) {
      if (!inMouth(y, z) && (inMouth(y - 1, z) || inMouth(y, z - 1) || inMouth(y, z + 1))) g.set(1, y, z, S.stoneLight);
    }
  }
};

const SUN_FRAMES = 4;

// Faces +x. The rays take turns to shine straight out and diagonally.
const paintSun = (g: VoxelGrid, frame: number): void => {
  for (let y = -8; y <= 8; y += 1) {
    for (let z = -8; z <= 8; z += 1) {
      const radius = Math.hypot(y, z);
      if (radius <= 5.3) g.fill(0, 1, y, y, z, z, S.sun);
      else if (radius <= 7.3) g.set(0, y, z, S.sunHalo);
    }
  }
  if (frame % 2 === 0) {
    const reach = frame === 0 ? 10 : 9;
    for (const [y, z] of [
      [reach, 0],
      [-reach, 0],
      [0, reach],
      [0, -reach]
    ]) {
      g.fill(0, 0, y - Number(z !== 0), y + Number(z !== 0), z - Number(y !== 0), z + Number(y !== 0), S.sunHalo);
    }
    return;
  }
  for (const y of [-7, 6]) {
    for (const z of [-7, 6]) g.fill(0, 0, y, y + 1, z, z + 1, S.sunHalo);
  }
};

const CLOUDS: readonly (readonly Box[])[] = [
  [
    [-14, 13, 0, 3, -3, 3],
    [-9, 6, 4, 6, -2, 2],
    [-3, 10, 4, 8, -3, 2],
    [2, 7, 9, 10, -1, 1]
  ],
  [
    [-10, 9, 0, 2, -2, 2],
    [-6, 5, 3, 5, -2, 2],
    [-2, 3, 6, 7, -1, 1]
  ],
  [
    [-12, 11, 0, 2, -3, 3],
    [-12, -4, 3, 4, -2, 2],
    [-2, 9, 3, 6, -2, 2],
    [1, 6, 7, 8, -1, 1]
  ]
];

const paintCloud = (g: VoxelGrid, boxes: readonly Box[]): void => {
  for (const [x0, x1, y0, y1, z0, z1] of boxes) {
    fillRounded(g, x0, x1, y0, y1, z0, z1, (_x, y): number => (y === 0 ? S.cloudShade : S.cloud));
  }
};

// Text that faces +z, cream in front of a coral shadow that sits one voxel down to the right.
const paintSign = (g: VoxelGrid, text: string, shadow: boolean): void => {
  const lit: (readonly [column: number, row: number])[] = [];
  const left = -Math.floor(drawBlockText(text, (column, row) => lit.push([column, row])) / 2);
  if (shadow) {
    for (const [column, row] of lit) g.fill(left + column + 1, left + column + 1, 7 - row, 7 - row, -2, -1, P.coral);
  }
  for (const [column, row] of lit) g.fill(left + column, left + column, 8 - row, 8 - row, 0, 1, P.cream);
};

const paintStripes = (g: VoxelGrid): void => {
  g.fill(-12, 12, 6, 7, 0, 1, P.mint);
  g.fill(-12, 12, 3, 4, 0, 1, P.cream);
  g.fill(-12, 12, 0, 1, 0, 1, P.coral);
};

export const START_TREES = {
  oak: {
    id: 'start-oak',
    label: 'Ek',
    paint: (g): void =>
      paintTree(g, 2, 13, [
        [-9, 8, 12, 21, -8, 8],
        [-6, 4, 22, 26, -5, 5],
        [3, 12, 9, 15, -3, 7]
      ])
  },
  round: {
    id: 'start-round-tree',
    label: 'Runt träd',
    paint: (g): void =>
      paintTree(g, 1, 7, [
        [-5, 5, 7, 15, -5, 5],
        [-3, 2, 16, 18, -2, 3]
      ])
  },
  tall: {
    id: 'start-tall-tree',
    label: 'Högt träd',
    paint: (g): void =>
      paintTree(g, 1, 9, [
        [-4, 4, 9, 14, -4, 4],
        [-6, 2, 13, 19, -3, 6],
        [-2, 4, 19, 22, -3, 2]
      ])
  }
} satisfies Record<string, VoxelModelDef>;

export const START_CLOUDS: readonly VoxelModelDef[] = CLOUDS.map((boxes, index) => ({
  id: `start-cloud-${index}`,
  label: 'Moln',
  paint: (g): void => paintCloud(g, boxes)
}));

export const START_SCENERY = {
  bush: { id: 'start-bush', label: 'Buske', paint: paintBush },
  bloom: { id: 'start-bloom', label: 'Blomma', paint: paintBloom },
  tuft: { id: 'start-tuft', label: 'Grästuva', paint: paintTuft },
  portal: { id: 'start-portal', label: 'Tunnelmynning', paint: paintPortal },
  stripes: { id: 'start-stripes', label: 'Ränder', paint: paintStripes },
  rule: { id: 'start-rule', label: 'Linje', paint: (g): void => g.fill(-20, 20, 0, 0, 0, 0, P.cream) },
  sun: {
    id: 'start-sun',
    label: 'Sol',
    paint: (g): void => paintSun(g, 0),
    sequence: { frames: SUN_FRAMES, framesPerSecond: 1.5, paint: paintSun }
  }
} satisfies Record<string, VoxelModelDef>;

export const createSign = (id: string, text: string, shadow: boolean): VoxelModelDef => ({
  id,
  label: text,
  paint: (g): void => paintSign(g, text, shadow)
});
