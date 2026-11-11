import { paintMiniFigure } from '../figure';
import { drawText } from '../font';
import type { VoxelGrid } from '../grid';
import type { VoxelModelDef } from '../model';
import { P } from '../palette';

const paintScooter = (g: VoxelGrid): void => {
  g.fill(0, 1, 0, 1, 1, 1, P.black);
  g.fill(10, 11, 0, 1, 1, 1, P.black);
  g.fill(2, 9, 1, 1, 0, 2, P.mint);
  g.fill(3, 8, 1, 1, 1, 1, P.dark);
  g.set(1, 2, 1, P.dark);
  g.set(2, 2, 1, P.red);

  g.fill(10, 10, 2, 3, 1, 1, P.steel);
  g.fill(9, 9, 4, 5, 1, 1, P.steel);
  g.fill(9, 9, 6, 6, -1, 3, P.black);
  g.set(9, 6, -1, P.mint);
  g.set(9, 6, 3, P.mint);
  g.set(10, 4, 1, P.yellow);

  paintMiniFigure(g, 5, 2, 1, {
    skin: P.skinTan,
    hair: P.hairDark,
    top: P.coral,
    bottom: P.dark,
    shoes: P.white,
    arms: 'forward',
    hat: P.yellow
  });
};

const MOWER_FRAMES = 8;
// A mark on a wheel goes over the top and down the front, a quarter turn at a time.
const QUARTER_TURNS: readonly (readonly [x: number, y: number])[] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0]
];
// Clippings fly out under the collector in an arc: how far back and how high, step by step.
const CLIPPING_ARC: readonly (readonly [back: number, y: number])[] = [
  [4, 1],
  [5, 2],
  [6, 2],
  [7, 1],
  [8, 0]
];
const CLIPPINGS: readonly (readonly [z: number, delay: number])[] = [
  [2, 0],
  [4, 3],
  [5, 6],
  [3, 1],
  [1, 4],
  [4, 7]
];
// A puff from the exhaust drifts up and back before the next one.
const EXHAUST: readonly (readonly (readonly [x: number, y: number, z: number])[])[] = [
  [[11, 8, 5]],
  [[10, 9, 5]],
  [
    [9, 10, 5],
    [10, 10, 4]
  ],
  [[8, 11, 4]]
];

const paintMower = (g: VoxelGrid, frame: number): void => {
  // The small front wheels turn twice for every turn of the rear wheels.
  const [rearX, rearY] = QUARTER_TURNS[Math.floor(frame / 2) % 4];
  const [frontX, frontY] = QUARTER_TURNS[frame % 4];
  const treadAcross = Math.floor(frame / 2) % 2 === 1;

  for (const z of [-2, 7]) {
    g.fill(0, 3, 0, 3, z, z + 1, P.black);
    g.clear(0, 0, 0, 0, z, z + 1);
    g.clear(3, 3, 0, 0, z, z + 1);
    g.clear(0, 0, 3, 3, z, z + 1);
    g.clear(3, 3, 3, 3, z, z + 1);
    if (treadAcross) {
      g.fill(0, 0, 1, 2, z, z + 1, P.steel);
      g.fill(3, 3, 1, 2, z, z + 1, P.steel);
    } else {
      g.fill(1, 2, 0, 0, z, z + 1, P.steel);
      g.fill(1, 2, 3, 3, z, z + 1, P.steel);
    }
  }
  for (const z of [-2, 8]) {
    g.fill(1, 2, 1, 2, z, z, P.yellow);
    g.set(1 + rearX, 1 + rearY, z, P.orange);
  }
  for (const z of [-1, 7]) {
    g.fill(10, 11, 0, 1, z, z, P.black);
    g.set(10 + frontX, frontY, z, P.steel);
  }

  g.fill(1, 12, 2, 3, 0, 6, P.red);
  g.fill(7, 12, 4, 5, 0, 6, P.red);
  g.fill(12, 12, 3, 4, 1, 5, P.dark);
  g.set(12, 5, 0, P.yellow);
  g.set(12, 5, 6, P.yellow);
  g.fill(5, 9, 1, 1, -1, 7, P.yellow);

  g.fill(7, 7, 6, 7, 3, 3, P.dark);
  g.fill(6, 6, 8, 8, 2, 4, P.black);
  g.fill(2, 4, 4, 4, 1, 5, P.black);
  g.fill(1, 1, 5, 7, 1, 5, P.black);

  g.fill(-3, 0, 3, 6, 0, 6, P.darkGreen);
  g.fill(-3, 0, 7, 7, 1, 5, P.darkGreen);
  CLIPPINGS.forEach(([z, delay], index) => {
    const step = CLIPPING_ARC[(frame + delay) % MOWER_FRAMES];
    if (step) g.set(-step[0], step[1], z, index % 2 === 0 ? P.green : P.darkGreen);
  });

  g.fill(11, 11, 6, 7, 5, 5, P.steel);
  for (const [x, y, z] of EXHAUST[frame % EXHAUST.length]) g.set(x, y, z, P.shade);

  paintMiniFigure(g, 3, 5, 3, {
    skin: P.skinLight,
    hair: P.hairGrey,
    top: P.blue,
    bottom: P.khaki,
    shoes: P.dark,
    seated: true,
    arms: 'forward',
    hat: P.coral
  });
};

const paintBus = (g: VoxelGrid): void => {
  for (const z of [0, 8]) {
    for (const x of [4, 19]) {
      g.fill(x, x + 2, 0, 2, z, z, P.black);
      g.set(x + 1, 1, z, P.steel);
    }
  }
  g.fill(0, 25, 1, 2, 1, 7, P.dark);
  g.fill(0, 25, 3, 12, 0, 8, P.red);
  g.fill(0, 25, 13, 13, 1, 7, P.cream);

  for (const z of [0, 8]) {
    g.fill(2, 23, 7, 10, z, z, P.glass);
    for (const x of [5, 9, 13, 17, 21]) g.fill(x, x, 7, 10, z, z, P.red);
  }
  g.fill(20, 22, 3, 6, 8, 8, P.darkRed);
  g.fill(25, 25, 6, 10, 1, 7, P.glass);
  g.fill(0, 0, 8, 10, 2, 6, P.glass);
  g.fill(25, 25, 11, 12, 1, 7, P.black);
  g.fill(25, 25, 11, 12, 2, 3, P.orange);
  g.fill(25, 25, 11, 12, 5, 6, P.orange);
  g.fill(25, 25, 3, 3, 0, 8, P.dark);
  g.set(25, 4, 1, P.yellow);
  g.set(25, 4, 7, P.yellow);
  g.set(25, 9, -1, P.dark);
  g.set(25, 9, 9, P.dark);

  drawText('43X', (column, row) => g.set(7 + column, 13, 2 + row, P.navy));
};

export const WHEEL_MODELS = {
  scooter: { id: 'scooter', label: 'Elsparkcykel', paint: paintScooter },
  mower: {
    id: 'mower',
    label: 'Åkgräsklippare',
    paint: (g): void => paintMower(g, 0),
    sequence: { frames: MOWER_FRAMES, framesPerSecond: 10, paint: paintMower }
  },
  bus: { id: 'bus', label: 'Ersättningsbuss 43X', paint: paintBus }
} satisfies Record<string, VoxelModelDef>;
