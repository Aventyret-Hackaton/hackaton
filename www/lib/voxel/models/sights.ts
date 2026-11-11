import { drawText } from '../font';
import type { VoxelGrid } from '../grid';
import type { VoxelModelDef } from '../model';
import { P } from '../palette';

// Sights face +z, so the front is visible when north is up on the globe.

const paintKiosk = (g: VoxelGrid): void => {
  g.fill(-1, 7, 0, 0, -1, 6, P.stone);
  g.fill(0, 6, 1, 4, 0, 4, P.cream);
  g.fill(1, 5, 2, 3, 4, 4, P.steel);
  g.fill(1, 5, 1, 1, 4, 4, P.ochre);
  g.fill(-1, 7, 5, 5, -1, 5, P.coral);
  for (const x of [0, 2, 4, 6]) g.fill(x, x, 5, 5, -1, 5, P.white);
  g.fill(1, 5, 6, 6, 1, 3, P.coral);
};

const paintRestStop = (g: VoxelGrid): void => {
  g.fill(-1, 9, 0, 0, -1, 5, P.stone);
  g.fill(1, 5, 3, 3, 1, 3, P.wood);
  g.fill(1, 1, 1, 2, 2, 2, P.darkWood);
  g.fill(5, 5, 1, 2, 2, 2, P.darkWood);
  g.fill(1, 5, 2, 2, 0, 0, P.darkWood);
  g.fill(1, 5, 2, 2, 4, 4, P.darkWood);
  g.fill(1, 1, 1, 1, 0, 0, P.darkWood);
  g.fill(5, 5, 1, 1, 0, 0, P.darkWood);
  g.fill(1, 1, 1, 1, 4, 4, P.darkWood);
  g.fill(5, 5, 1, 1, 4, 4, P.darkWood);
  g.fill(7, 8, 1, 3, 2, 3, P.darkGreen);
  g.fill(7, 8, 4, 4, 2, 3, P.dark);
};

const paintCharger = (g: VoxelGrid): void => {
  g.fill(0, 6, 0, 0, 0, 4, P.stone);
  g.fill(2, 3, 1, 6, 1, 2, P.white);
  g.fill(2, 3, 4, 5, 2, 2, P.mint);
  g.fill(2, 3, 7, 7, 1, 2, P.red);
  g.set(4, 4, 2, P.black);
  g.set(5, 3, 2, P.black);
  g.fill(5, 5, 1, 2, 2, 2, P.black);
  g.fill(4, 5, 1, 1, 3, 3, P.black);
};

const paintRoundabout = (g: VoxelGrid): void => {
  for (let x = 0; x <= 8; x += 1) {
    for (let z = 0; z <= 8; z += 1) {
      const fromCorner = Math.min(x, 8 - x) + Math.min(z, 8 - z);
      if (fromCorner >= 2) g.set(x, 0, z, P.dark);
    }
  }
  g.fill(2, 6, 1, 1, 2, 6, P.green);
  g.fill(4, 4, 2, 6, 4, 4, P.coral);
  g.fill(3, 5, 4, 4, 4, 4, P.mint);
  g.fill(5, 5, 6, 7, 4, 5, P.yellow);
  g.set(3, 2, 3, P.pink);
};

const paintDune = (g: VoxelGrid): void => {
  g.fill(0, 9, 0, 0, 0, 6, P.sand);
  g.fill(1, 7, 1, 1, 1, 5, P.sand);
  g.fill(2, 5, 2, 2, 2, 4, P.ochre);
  g.fill(3, 4, 3, 3, 2, 3, P.straw);
  g.set(8, 1, 2, P.straw);
};

const paintOffice = (g: VoxelGrid): void => {
  g.fill(-1, 9, 0, 0, -1, 5, P.stone);
  g.fill(0, 6, 1, 4, 0, 4, P.ochre);
  g.fill(-1, 7, 5, 5, -1, 5, P.darkRed);
  g.fill(0, 6, 6, 6, 1, 3, P.darkRed);
  g.fill(3, 3, 1, 3, 4, 4, P.dark);
  g.fill(1, 1, 2, 3, 4, 4, P.steel);
  g.fill(5, 5, 2, 3, 4, 4, P.steel);
  g.fill(8, 8, 1, 5, 2, 2, P.steel);
  g.fill(8, 8, 6, 9, 1, 3, P.blue);
  g.set(8, 8, 2, P.white);
  g.fill(8, 8, 6, 7, 2, 2, P.white);
};

const paintBuoy = (g: VoxelGrid): void => {
  g.fill(-1, 3, 0, 0, -1, 3, P.blue);
  g.fill(0, 2, 1, 2, 0, 2, P.red);
  g.fill(0, 2, 3, 3, 0, 2, P.white);
  g.fill(1, 1, 4, 6, 1, 1, P.red);
  g.set(1, 7, 1, P.yellow);
};

const paintWave = (g: VoxelGrid): void => {
  g.fill(0, 8, 0, 0, 0, 3, P.blue);
  g.fill(1, 7, 1, 1, 0, 3, P.blue);
  g.fill(2, 6, 2, 2, 0, 3, P.sky);
  g.fill(4, 6, 3, 3, 0, 3, P.foam);
  g.fill(6, 7, 2, 2, 0, 3, P.foam);
};

const paintGarage = (g: VoxelGrid): void => {
  g.fill(0, 8, 0, 0, 0, 5, P.stone);
  for (const y of [2, 4, 6]) g.fill(0, 8, y, y, 0, 5, P.stone);
  for (const x of [0, 8]) {
    for (const z of [0, 5]) g.fill(x, x, 1, 6, z, z, P.steel);
  }
  g.fill(4, 4, 1, 6, 0, 0, P.steel);
  g.fill(2, 3, 3, 3, 2, 3, P.coral);
  g.fill(5, 6, 5, 5, 1, 2, P.mint);
  g.fill(5, 6, 1, 1, 3, 4, P.yellow);
  g.fill(2, 6, 7, 13, 5, 5, P.blue);
  drawText('P', (column, row) => g.set(3 + column, 12 - row, 5, P.white));
};

const paintSignpost = (g: VoxelGrid): void => {
  g.fill(0, 4, 0, 0, 0, 2, P.stone);
  g.fill(2, 2, 1, 4, 1, 1, P.steel);
  g.fill(-1, 5, 5, 8, 1, 1, P.yellow);
  g.fill(0, 4, 7, 7, 1, 1, P.dark);
  g.fill(0, 2, 6, 6, 1, 1, P.dark);
};

const paintGate = (g: VoxelGrid): void => {
  g.fill(-1, 10, 0, 0, -1, 5, P.stone);
  g.fill(0, 2, 1, 4, 0, 2, P.cream);
  g.fill(1, 1, 2, 3, 2, 2, P.glass);
  g.fill(-1, 3, 5, 5, -1, 3, P.coral);
  g.fill(3, 3, 1, 3, 4, 4, P.steel);
  g.fill(4, 10, 3, 3, 4, 4, P.white);
  for (const x of [5, 7, 9]) g.set(x, 3, 4, P.red);
  g.fill(5, 8, 1, 2, 0, 1, P.mint);
  g.fill(5, 8, 3, 4, 0, 1, P.ochre);
};

const paintQueue = (g: VoxelGrid): void => {
  g.fill(-1, 15, 0, 0, -1, 3, P.blue);
  const cargo = [P.coral, P.mint, P.yellow];
  cargo.forEach((color, index) => {
    const x = index * 5;
    g.fill(x, x + 3, 1, 1, 0, 2, P.deepBlue);
    g.fill(x + 1, x + 3, 2, 2, 0, 2, color);
    g.fill(x, x, 2, 3, 1, 1, P.white);
  });
};

const paintShelter = (g: VoxelGrid): void => {
  g.fill(-1, 9, 0, 0, -1, 4, P.stone);
  g.fill(0, 6, 1, 5, 0, 0, P.sky);
  g.fill(0, 0, 1, 5, 0, 2, P.steel);
  g.fill(6, 6, 1, 5, 0, 2, P.steel);
  g.fill(-1, 7, 6, 6, 0, 3, P.dark);
  g.fill(1, 5, 2, 2, 1, 1, P.wood);
  g.fill(8, 8, 1, 7, 2, 2, P.steel);
  g.fill(8, 8, 6, 8, 1, 3, P.white);
};

const paintRoadwork = (g: VoxelGrid): void => {
  g.fill(-1, 9, 0, 0, -1, 5, P.dark);
  for (const [x, z] of [
    [0, 4],
    [3, 5],
    [8, 4]
  ] as const) {
    g.set(x, 1, z, P.orange);
    g.set(x, 2, z, P.white);
    g.set(x, 3, z, P.orange);
  }
  g.fill(1, 7, 3, 4, 2, 2, P.white);
  for (const x of [2, 4, 6]) g.fill(x, x, 3, 4, 2, 2, P.red);
  g.fill(1, 1, 1, 2, 2, 2, P.steel);
  g.fill(7, 7, 1, 2, 2, 2, P.steel);
  g.fill(4, 7, 1, 1, 0, 1, P.stone);
  g.fill(5, 6, 2, 2, 0, 1, P.stone);
};

// One flag on its pole. Side is -1 for cloth to the left of the pole and 1 for the right.
const paintFlag = (g: VoxelGrid, letter: string, pole: number, side: number): void => {
  g.fill(pole - 1, pole + 1, 0, 0, -1, 1, P.coral);
  g.fill(pole, pole, 1, 22, 0, 0, P.darkRed);
  g.fill(pole + side, pole + side * 7, 16, 22, 0, 0, P.cream);
  for (const y of [17, 19, 21]) g.clear(pole + side * 7, pole + side * 7, y, y, 0, 0);
  const left = side < 0 ? pole - 5 : pole + 3;
  drawText(letter, (column, row) => g.set(left + column, 21 - row, 0, P.navy));
};

const paintFlags = (g: VoxelGrid): void => {
  paintFlag(g, 'A', -1, -1);
  paintFlag(g, 'B', 1, 1);
};

export const SIGHT_MODELS = {
  kiosk: { id: 'kiosk', label: 'Kiosk', paint: paintKiosk },
  restStop: { id: 'restStop', label: 'Rastplats', paint: paintRestStop },
  charger: { id: 'charger', label: 'Laddstolpe', paint: paintCharger },
  roundabout: { id: 'roundabout', label: 'Rondell', paint: paintRoundabout },
  dune: { id: 'dune', label: 'Sanddyn', paint: paintDune },
  office: { id: 'office', label: 'Turistkontor', paint: paintOffice },
  buoy: { id: 'buoy', label: 'Boj', paint: paintBuoy },
  wave: { id: 'wave', label: 'Våg', paint: paintWave },
  garage: { id: 'garage', label: 'Parkeringshus', paint: paintGarage },
  signpost: { id: 'signpost', label: 'Skylt', paint: paintSignpost },
  gate: { id: 'gate', label: 'Terminalgrind', paint: paintGate },
  queue: { id: 'queue', label: 'Fartygskö', paint: paintQueue },
  shelter: { id: 'shelter', label: 'Busskur', paint: paintShelter },
  roadwork: { id: 'roadwork', label: 'Vägarbete', paint: paintRoadwork }
} satisfies Record<string, VoxelModelDef>;

export const FLAGS_MODEL: VoxelModelDef = {
  id: 'flags',
  label: 'Start- och målflagga',
  paint: paintFlags
};

// The same flags one by one, each with its pole in the voxel column at the origin.
export const START_FLAG_MODEL: VoxelModelDef = { id: 'startFlag', label: 'Startflagga', paint: (g): void => paintFlag(g, 'A', 0, -1) };
export const GOAL_FLAG_MODEL: VoxelModelDef = { id: 'goalFlag', label: 'Målflagga', paint: (g): void => paintFlag(g, 'B', 0, 1) };
