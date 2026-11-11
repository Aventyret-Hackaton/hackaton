import type { VoxelGrid } from '@/lib/voxel/grid';
import type { VoxelModelDef } from '@/lib/voxel/model';
import { P } from '@/lib/voxel/palette';

import { fillDisc, fillRounded } from './shapes';

const TAXI = 0xf6c624;
const TAXI_DARK = 0xd9a91a;
const TRAIN = 0x2f62c8;
const TRAIN_ROOF = 0x224a9c;
const TRAIN_DOOR = 0x4f86e6;
const LIT = 0xffd24a;
const FRONT = 0xd9dde2;
const HULL_STRIPE = 0x2a63c4;
const SEAT = 0xf7c531;
const WIRE = 0xb9bec7;
const PORTHOLE = 0x6ec1f2;

const WHEEL_FRAMES = 4;
// A mark on the hub goes over the top and down the front, a quarter turn at a time.
const HUB_MARK: readonly (readonly [x: number, y: number])[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0]
];

const paintWheel = (g: VoxelGrid, x: number, z0: number, z1: number, frame: number): void => {
  const [markX, markY] = HUB_MARK[frame % WHEEL_FRAMES];
  g.fill(x - 2, x + 2, 1, 3, z0, z1, P.black);
  g.fill(x - 1, x + 1, 0, 4, z0, z1, P.black);
  g.fill(x - 1, x + 1, 1, 3, z0, z1, P.steel);
  g.fill(x, x, 2, 2, z0, z1, P.dark);
  g.fill(x + markX, x + markX, 2 + markY, 2 + markY, z0, z1, P.white);
};

const paintTaxi = (g: VoxelGrid, frame: number): void => {
  g.fill(-12, 11, 2, 2, -5, 5, P.dark);
  g.fill(-14, 13, 3, 8, -6, 6, TAXI);
  g.clear(10, 13, 8, 8, -6, 6);
  g.clear(-14, -12, 8, 8, -6, 6);
  g.fill(-9, 7, 9, 10, -5, 5, TAXI);
  g.fill(-9, 6, 11, 12, -5, 5, TAXI);
  g.fill(-8, 5, 13, 13, -5, 5, TAXI);

  for (const z of [-5, 5]) {
    g.fill(-7, -2, 10, 12, z, z, P.glass);
    g.fill(0, 4, 10, 12, z, z, P.glass);
  }
  g.fill(7, 7, 10, 10, -4, 4, P.glass);
  g.fill(6, 6, 11, 12, -4, 4, P.glass);
  g.fill(-9, -9, 10, 12, -4, 4, P.glass);

  for (const z of [-6, 6]) {
    for (let x = -12; x <= 11; x += 1) {
      for (const y of [6, 7]) g.set(x, y, z, (x + y) % 2 === 0 ? P.black : P.white);
    }
    g.fill(-1, -1, 3, 5, z, z, TAXI_DARK);
    for (const x of [-3, 2]) g.set(x, 8, z, P.dark);
  }
  for (const z of [-5, -4, 4, 5]) {
    g.fill(13, 13, 6, 7, z, z, P.cream);
    g.fill(-14, -14, 6, 7, z, z, P.red);
  }
  g.fill(13, 13, 3, 4, -6, 6, P.steel);
  g.fill(-14, -14, 3, 4, -6, 6, P.steel);
  g.fill(13, 13, 5, 6, -2, 2, P.dark);
  g.fill(-14, -14, 5, 5, -1, 1, P.white);

  g.fill(-2, -1, 14, 15, -3, 3, TAXI);
  for (const z of [-3, -1, 1, 3]) g.fill(-2, -1, 14, 14, z, z, P.black);

  for (const x of [-9, 8]) {
    paintWheel(g, x, 5, 6, frame);
    paintWheel(g, x, -6, -5, frame);
  }
};

// One car of the metro, with the cab at the front.
const paintTrainCar = (g: VoxelGrid): void => {
  g.fill(-21, 20, 2, 2, -4, 4, P.dark);
  g.fill(-23, 22, 3, 12, -5, 5, TRAIN);
  g.fill(-23, 22, 13, 13, -4, 4, TRAIN_ROOF);
  g.fill(-12, -5, 14, 14, -2, 2, P.steel);
  g.fill(4, 11, 14, 14, -2, 2, P.steel);

  for (const z of [-5, 5]) {
    g.fill(-23, 22, 4, 4, z, z, P.white);
    for (const x of [-20, -9, 2, 13]) g.fill(x, x + 5, 8, 10, z, z, LIT);
    for (const x of [-13, -2, 9]) {
      g.fill(x, x + 2, 5, 11, z, z, TRAIN_DOOR);
      g.fill(x, x + 2, 8, 10, z, z, LIT);
      g.fill(x + 1, x + 1, 5, 11, z, z, TRAIN_ROOF);
    }
  }

  g.fill(22, 22, 4, 7, -5, 5, FRONT);
  g.fill(22, 22, 8, 11, -4, 4, P.glass);
  g.fill(22, 22, 12, 12, -2, 2, P.orange);
  for (const z of [-4, 4]) {
    g.set(22, 5, z, P.cream);
    g.set(22, 6, z, P.red);
  }
  g.fill(-23, -23, 8, 11, -3, 3, P.glass);

  for (const x of [-19, 12]) {
    g.fill(x, x + 7, 0, 1, -4, 4, P.dark);
    for (const z of [-5, 5]) {
      g.fill(x + 1, x + 2, 0, 1, z, z, P.steel);
      g.fill(x + 5, x + 6, 0, 1, z, z, P.steel);
    }
  }
};

const ROCKET_FRAMES = 4;
const FLAME_LENGTHS = [0, 6, 9, 7];

// Stands on its fins. Frame 0 is cold, the others burn.
const paintRocket = (g: VoxelGrid, frame: number): void => {
  for (let y = 1; y <= 2; y += 1) fillDisc(g, y, 2.2, P.dark);
  for (let y = 3; y <= 4; y += 1) fillDisc(g, y, 3.2, P.steel);
  for (let y = 5; y <= 24; y += 1) fillDisc(g, y, 4.3, y === 8 || y === 9 ? P.red : P.white);
  [3.6, 3.6, 2.9, 2.9, 2.2, 2.2, 1.2, 1.2, 0.5].forEach((radius, index) => fillDisc(g, 25 + index, radius, P.red));

  for (let y = 0; y <= 9; y += 1) {
    const reach = 3 - Math.floor(y / 3);
    g.fill(5, 5 + reach, y, y, 0, 0, P.red);
    g.fill(-5 - reach, -5, y, y, 0, 0, P.red);
    g.fill(0, 0, y, y, 5, 5 + reach, P.red);
    g.fill(0, 0, y, y, -5 - reach, -5, P.red);
  }

  g.fill(5, 5, 16, 20, -2, 2, P.steel);
  g.clear(5, 5, 17, 19, -1, 1);
  g.fill(4, 4, 17, 19, -1, 1, PORTHOLE);
  g.set(4, 19, -1, P.white);

  const length = FLAME_LENGTHS[frame % ROCKET_FRAMES];
  for (let below = 1; below <= length; below += 1) {
    const radius = Math.max(0.6, 2.6 - below * 0.28 - ((frame + below) % 2) * 0.4);
    fillDisc(g, 1 - below, radius, below <= length / 3 ? P.yellow : P.orange);
  }
};

const SWAN_FRAMES = 4;
// Foam that the paddles throw up behind the boat.
const PADDLE_FOAM: readonly (readonly (readonly [x: number, y: number, z: number])[])[] = [
  [
    [-16, 0, -3],
    [-17, 1, 2],
    [-18, 0, 0]
  ],
  [
    [-17, 0, -2],
    [-18, 1, 3],
    [-19, 0, 1]
  ],
  [
    [-16, 1, 3],
    [-18, 0, -3],
    [-20, 0, 0]
  ],
  [
    [-17, 1, -1],
    [-19, 0, 2],
    [-16, 0, 0]
  ]
];

const paintHullLayer = (g: VoxelGrid, y: number, x0: number, x1: number, half: number, color: number): void => {
  const centre = (x0 + x1) / 2;
  const reach = (x1 - x0) / 2 + 0.5;
  for (let x = x0; x <= x1; x += 1) {
    for (let z = -half; z <= half; z += 1) {
      if (((x - centre) / reach) ** 4 + (z / (half + 0.5)) ** 4 <= 1) g.set(x, y, z, color);
    }
  }
};

const paintSwanBoat = (g: VoxelGrid, frame: number): void => {
  paintHullLayer(g, 0, -12, 11, 5, HULL_STRIPE);
  paintHullLayer(g, 1, -13, 12, 6, HULL_STRIPE);
  for (let y = 2; y <= 5; y += 1) paintHullLayer(g, y, -14, 13, 7, P.white);
  g.clear(-9, 6, 3, 5, -5, 5);
  g.fill(-9, 6, 2, 2, -5, 5, P.shade);

  for (const side of [-1, 1]) {
    const inner = Math.min(side, side * 4);
    const outer = Math.max(side, side * 4);
    g.fill(-7, -3, 3, 4, inner, outer, SEAT);
    g.fill(-8, -7, 3, 8, inner, outer, SEAT);
    g.fill(-8, 3, 5, 7, side * 8, side * 8, P.white);
    g.fill(-9, -2, 8, 8, side * 8, side * 8, P.white);
    g.fill(-10, -6, 9, 9, side * 8, side * 8, P.shade);
  }
  g.fill(4, 4, 3, 6, 0, 0, P.steel);
  g.fill(3, 3, 6, 6, -1, 1, P.dark);

  g.fill(9, 12, 6, 8, -2, 2, P.white);
  g.fill(10, 12, 9, 14, -1, 1, P.white);
  g.fill(11, 13, 15, 17, -1, 1, P.white);
  fillRounded(g, 11, 16, 17, 21, -2, 2, P.white);
  g.fill(17, 19, 18, 19, -1, 1, P.orange);
  g.set(20, 18, 0, P.orange);
  for (const z of [-2, 2]) g.set(15, 20, z, P.black);

  g.fill(-15, -13, 6, 7, -3, 3, P.white);
  g.fill(-16, -15, 8, 9, -2, 2, P.white);

  for (const [x, y, z] of PADDLE_FOAM[frame % SWAN_FRAMES]) g.set(x, y, z, P.foam);
};

const paintCart = (g: VoxelGrid): void => {
  for (let x = -5; x <= 7; x += 1) {
    for (let z = -4; z <= 4; z += 1) {
      const rim = x === -5 || x === 7 || z === -4 || z === 4;
      if (rim || (x + z) % 2 === 0) g.set(x, 5, z, WIRE);
      if (!rim) continue;
      const upright = (z === -4 || z === 4 ? x : z) % 2 === 0 || ((x === -5 || x === 7) && (z === -4 || z === 4));
      for (let y = 6; y <= 11; y += 1) {
        if (upright || y === 8 || y === 11) g.set(x, y, z, WIRE);
      }
    }
  }

  for (const z of [-4, 4]) {
    g.set(-6, 12, z, WIRE);
    g.set(-7, 13, z, WIRE);
    g.fill(-5, 6, 2, 2, z * 0.75, z * 0.75, P.steel);
    for (const x of [-5, 6]) {
      g.fill(x, x, 3, 4, z * 0.75, z * 0.75, P.steel);
      g.fill(x, x + 1, 0, 1, z * 0.75, z * 0.75, P.black);
    }
  }
  g.fill(-8, -8, 13, 13, -4, 4, P.red);
  g.fill(-4, -4, 7, 10, -3, 3, P.red);
};

export const START_VEHICLES = {
  taxi: {
    id: 'start-taxi',
    label: 'Taxi',
    paint: (g): void => paintTaxi(g, 0),
    sequence: { frames: WHEEL_FRAMES, framesPerSecond: 12, paint: paintTaxi }
  },
  train: { id: 'start-train', label: 'Tunnelbanevagn', paint: paintTrainCar },
  rocket: {
    id: 'start-rocket',
    label: 'Raket',
    paint: (g): void => paintRocket(g, 0),
    sequence: { frames: ROCKET_FRAMES, framesPerSecond: 10, paint: paintRocket }
  },
  swan: {
    id: 'start-swan',
    label: 'Svantrampbåt',
    paint: (g): void => paintSwanBoat(g, 0),
    sequence: { frames: SWAN_FRAMES, framesPerSecond: 4, paint: paintSwanBoat }
  },
  cart: { id: 'start-cart', label: 'Kundvagn', paint: paintCart }
} satisfies Record<string, VoxelModelDef>;
