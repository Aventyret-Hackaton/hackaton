import type { BufferGeometry } from 'three';

import type { LatLon } from '@/lib/globe/geo';
import { hash3, valueNoise3 } from '@/lib/voxel/hash';

import { type Cell, cellOf, CITY_DEPTH, CITY_WIDTH, createStockholmGround, type District, districtOf, LAND, PARK, WATER } from './stockholmMap';
import { buildCityGeometry, type CityVolume, createCityVolume } from './volume';

const CITY_HEIGHT = 24;
const CITY_JITTER = 0.07;
// Voxel layer of the water surface, and the first free layer above the streets.
const SEA = 0;
export const CITY_GROUND = 2;

const COLORS = {
  water: 0x2a66c0,
  waterLight: 0x3a7ad0,
  foam: 0x86b8ec,
  street: 0xb9ae99,
  quay: 0x8f97a3,
  plaza: 0xd9cfb8,
  grass: 0x5aa640,
  grassLight: 0x70b848,
  tree: 0x2f7d38,
  treeLight: 0x43963f,
  wallYellow: 0xe6ad3e,
  wallOchre: 0xd9902f,
  wallBurnt: 0xc7772c,
  wallPale: 0xecc978,
  wallRed: 0xd2603f,
  wallCream: 0xeadcae,
  wallGrey: 0xb7bcc4,
  wallGlass: 0x8fb1c9,
  wallWhite: 0xeeeae0,
  roofSlate: 0x47557f,
  roofDark: 0x384368,
  roofRed: 0xcf5a2c,
  roofGrey: 0x6a7690,
  copper: 0x5fa58f,
  window: 0x4a3526,
  windowLit: 0xfff0c2,
  brick: 0x9c4a34,
  brickDark: 0x7c3a2c,
  stone: 0xc9b48a,
  palace: 0xc99c62,
  gold: 0xffd24a,
  iron: 0x23283a,
  white: 0xf4f1e6,
  red: 0xd8432f,
  deck: 0x8a909c,
  pillar: 0x6c7380,
  blue: 0x2a63c4,
  mint: 0x73edb5,
  pink: 0xec8db4,
  glass: 0xbfe8f2,
  wood: 0x8a5a36,
  orange: 0xe8792e
} as const;

// What the city looks like from too far away to tell the houses apart.
export const CITY_TINTS = {
  water: [COLORS.water, COLORS.waterLight],
  grass: [COLORS.grass, COLORS.grassLight, COLORS.tree],
  urban: [COLORS.roofSlate, COLORS.roofDark, COLORS.roofRed, COLORS.roofRed, COLORS.street, COLORS.wallOchre]
} as const;

// What the ripples on the water lighten it towards: plain ripples, and foam.
export const WATER_GLINTS = [COLORS.waterLight, COLORS.foam] as const;

type ColorName = keyof typeof COLORS;

const COLOR_NAMES = Object.keys(COLORS) as ColorName[];
const PALETTE = COLOR_NAMES.map((name) => COLORS[name]);
// Voxels hold palette positions, counted from one.
const K = Object.fromEntries(COLOR_NAMES.map((name, index) => [name, index + 1])) as Record<ColorName, number>;

type Style = {
  // Distance between streets, and where the street grid starts.
  pitch: number;
  shift: number;
  floors: readonly [number, number];
  walls: readonly number[];
  roofs: readonly number[];
  yards: boolean;
  density: number;
};

const STYLES: Record<District, Style> = {
  old: {
    pitch: 4,
    shift: 1,
    floors: [4, 6],
    walls: [K.wallYellow, K.wallOchre, K.wallBurnt, K.wallRed, K.wallPale, K.wallRed],
    roofs: [K.roofRed, K.roofDark, K.roofRed, K.roofSlate],
    yards: false,
    density: 1
  },
  city: {
    pitch: 7,
    shift: 3,
    floors: [5, 7],
    walls: [K.wallCream, K.wallGrey, K.wallPale, K.wallGlass, K.wallOchre, K.wallWhite],
    roofs: [K.roofGrey, K.roofDark, K.roofSlate],
    yards: true,
    density: 1
  },
  stately: { pitch: 7, shift: 5, floors: [5, 6], walls: [K.wallOchre, K.wallPale, K.wallCream, K.wallYellow], roofs: [K.roofSlate, K.roofDark, K.copper], yards: true, density: 1 },
  mixed: {
    pitch: 6,
    shift: 2,
    floors: [4, 6],
    walls: [K.wallYellow, K.wallOchre, K.wallBurnt, K.wallPale, K.wallRed, K.wallCream],
    roofs: [K.roofSlate, K.roofDark, K.roofRed],
    yards: true,
    density: 0.95
  },
  suburb: { pitch: 5, shift: 0, floors: [2, 3], walls: [K.wallRed, K.wallYellow, K.wallWhite, K.wallPale], roofs: [K.roofDark, K.roofRed, K.roofSlate], yards: false, density: 0.5 }
};

const DISTRICTS = Object.keys(STYLES) as District[];

type Painter = (v: CityVolume, x: number, z: number) => void;

// A hand-built building; x and z are the north-west corner of its footprint.
type Landmark = { at: LatLon; size: readonly [width: number, depth: number]; paint: Painter };

const box = (v: CityVolume, x: number, z: number, width: number, depth: number, y: number, height: number, color: number): void =>
  v.fill(x, x + width - 1, y, y + height - 1, z, z + depth - 1, color);

// Dark window dots on every other voxel of the outer walls.
const windows = (v: CityVolume, x: number, z: number, width: number, depth: number, rows: readonly number[]): void => {
  for (let cz = z; cz < z + depth; cz += 1) {
    for (let cx = x; cx < x + width; cx += 1) {
      const edge = cx === x || cx === x + width - 1 || cz === z || cz === z + depth - 1;
      if (edge && ((cx + cz) & 1) === 0) rows.forEach((y) => v.set(cx, y, cz, K.window));
    }
  }
};

const hall =
  (wall: number, roof: number, height: number): Painter =>
  (v, x, z) => {
    box(v, x, z, 5, 5, CITY_GROUND, height, wall);
    windows(v, x, z, 5, 5, [CITY_GROUND + 1, CITY_GROUND + 3]);
    box(v, x, z, 5, 5, CITY_GROUND + height, 1, roof);
    box(v, x + 1, z + 1, 3, 3, CITY_GROUND + height + 1, 1, roof);
  };

// A nave with a tower and a spire at its west end.
const church =
  (wall: number, towerHeight: number, spireHeight: number, spire: number): Painter =>
  (v, x, z) => {
    box(v, x + 3, z, 4, 3, CITY_GROUND, 4, wall);
    box(v, x + 3, z, 4, 3, CITY_GROUND + 4, 1, K.roofDark);
    box(v, x + 3, z + 1, 4, 1, CITY_GROUND + 5, 1, K.roofDark);
    box(v, x, z, 3, 3, CITY_GROUND, towerHeight, wall);
    box(v, x, z, 3, 3, CITY_GROUND + towerHeight, 1, spire);
    box(v, x + 1, z + 1, 1, 1, CITY_GROUND + towerHeight + 1, spireHeight, spire);
  };

const domed =
  (wall: number, dome: number): Painter =>
  (v, x, z) => {
    box(v, x, z, 5, 5, CITY_GROUND, 4, wall);
    windows(v, x, z, 5, 5, [CITY_GROUND + 1]);
    box(v, x + 1, z + 1, 3, 3, CITY_GROUND + 4, 2, dome);
    box(v, x + 2, z + 2, 1, 1, CITY_GROUND + 6, 2, K.gold);
  };

const highRise =
  (wall: number, height: number, crown: number): Painter =>
  (v, x, z) => {
    box(v, x, z, 3, 3, CITY_GROUND, height, wall);
    for (let y = CITY_GROUND + 1; y < CITY_GROUND + height; y += 2) box(v, x, z, 3, 3, y, 1, K.roofGrey);
    box(v, x, z, 3, 3, CITY_GROUND + height, 1, crown);
  };

const paintCityHall: Painter = (v, x, z) => {
  box(v, x, z, 7, 6, CITY_GROUND, 4, K.brick);
  windows(v, x, z, 7, 6, [CITY_GROUND + 1, CITY_GROUND + 3]);
  box(v, x, z, 7, 6, CITY_GROUND + 4, 1, K.copper);
  box(v, x + 2, z + 2, 3, 2, CITY_GROUND, 5, 0);
  box(v, x + 5, z + 4, 2, 2, CITY_GROUND, 13, K.brick);
  box(v, x + 5, z + 4, 2, 2, CITY_GROUND + 13, 1, K.copper);
  box(v, x + 5, z + 4, 1, 1, CITY_GROUND + 14, 2, K.copper);
  v.set(x + 5, CITY_GROUND + 16, z + 4, K.gold);
};

const paintPalace: Painter = (v, x, z) => {
  box(v, x, z, 8, 8, CITY_GROUND, 4, K.palace);
  windows(v, x, z, 8, 8, [CITY_GROUND + 1, CITY_GROUND + 3]);
  box(v, x, z, 8, 8, CITY_GROUND + 4, 1, K.roofGrey);
  box(v, x + 2, z + 2, 4, 4, CITY_GROUND, 5, 0);
  box(v, x + 3, z, 1, 1, CITY_GROUND + 5, 4, K.iron);
  v.set(x + 4, CITY_GROUND + 8, z, K.blue);
  v.set(x + 5, CITY_GROUND + 8, z, K.gold);
};

const paintParliament: Painter = (v, x, z) => {
  box(v, x, z, 7, 3, CITY_GROUND, 4, K.wallGrey);
  windows(v, x, z, 7, 3, [CITY_GROUND + 1, CITY_GROUND + 3]);
  box(v, x, z, 7, 3, CITY_GROUND + 4, 1, K.roofDark);
  box(v, x + 3, z + 1, 1, 1, CITY_GROUND + 5, 1, K.copper);
};

const paintOffices: Painter = (v, x, z) => {
  box(v, x, z, 5, 14, CITY_GROUND, 1, K.wallGrey);
  for (let slab = 0; slab < 5; slab += 1) {
    box(v, x, z + slab * 3, 4, 1, CITY_GROUND + 1, 9, slab % 2 === 0 ? K.wallGlass : K.wallWhite);
    for (let y = CITY_GROUND + 2; y < CITY_GROUND + 10; y += 2) box(v, x, z + slab * 3, 4, 1, y, 1, K.roofGrey);
  }
};

const paintSquare: Painter = (v, x, z) => {
  for (let cz = z; cz < z + 5; cz += 1) {
    for (let cx = x; cx < x + 6; cx += 1) v.set(cx, CITY_GROUND - 1, cz, ((cx + cz) & 1) === 0 ? K.white : K.iron);
  }
  box(v, x + 2, z + 2, 1, 1, CITY_GROUND, 8, K.glass);
};

const paintStation: Painter = (v, x, z) => {
  box(v, x, z, 4, 10, CITY_GROUND, 3, K.stone);
  windows(v, x, z, 4, 10, [CITY_GROUND + 1]);
  box(v, x, z, 4, 10, CITY_GROUND + 3, 1, K.roofGrey);
  box(v, x + 1, z, 2, 10, CITY_GROUND + 4, 1, K.roofGrey);
};

const paintShipMuseum: Painter = (v, x, z) => {
  box(v, x, z, 6, 5, CITY_GROUND, 3, K.brickDark);
  box(v, x, z, 6, 5, CITY_GROUND + 3, 1, K.copper);
  box(v, x, z + 2, 6, 1, CITY_GROUND + 4, 1, K.copper);
  for (const mast of [1, 3, 5]) box(v, x + mast, z + 2, 1, 1, CITY_GROUND + 5, 5 + (mast === 3 ? 2 : 0), K.wood);
};

const paintNordicMuseum: Painter = (v, x, z) => {
  box(v, x, z, 4, 9, CITY_GROUND, 5, K.stone);
  windows(v, x, z, 4, 9, [CITY_GROUND + 1, CITY_GROUND + 3]);
  box(v, x, z, 4, 9, CITY_GROUND + 5, 1, K.copper);
  box(v, x + 1, z + 4, 2, 1, CITY_GROUND + 6, 3, K.stone);
  box(v, x + 1, z + 4, 2, 1, CITY_GROUND + 9, 2, K.copper);
  for (const end of [0, 8]) box(v, x + 1, z + end, 1, 1, CITY_GROUND + 6, 2, K.copper);
};

const paintFunfair: Painter = (v, x, z) => {
  box(v, x, z + 4, 3, 3, CITY_GROUND, 2, K.pink);
  box(v, x + 4, z + 5, 2, 2, CITY_GROUND, 3, K.mint);
  box(v, x + 6, z + 3, 3, 2, CITY_GROUND, 2, K.wallYellow);
  for (let y = 0; y < 15; y += 1) v.set(x + 8, CITY_GROUND + y, z, y % 3 === 2 ? K.red : K.white);
  v.set(x + 8, CITY_GROUND + 15, z, K.gold);
  // A wheel standing in the plane that faces the camera.
  const tints = [K.pink, K.gold, K.mint, K.white];
  for (let wy = -3; wy <= 3; wy += 1) {
    for (let wx = -3; wx <= 3; wx += 1) {
      if (Math.round(Math.hypot(wx, wy)) === 3) v.set(x + 3 + wx, CITY_GROUND + 4 + wy, z + 2, tints[(wx + wy + 12) % tints.length]);
    }
  }
  box(v, x + 3, z + 2, 1, 1, CITY_GROUND, 5, K.white);
};

const paintLibrary: Painter = (v, x, z) => {
  box(v, x, z, 5, 5, CITY_GROUND, 3, K.orange);
  box(v, x + 1, z + 1, 3, 3, CITY_GROUND + 3, 4, K.orange);
  windows(v, x + 1, z + 1, 3, 3, [CITY_GROUND + 5]);
};

const paintLift: Painter = (v, x, z) => {
  box(v, x, z + 2, 1, 1, CITY_GROUND, 8, K.iron);
  box(v, x, z, 1, 3, CITY_GROUND + 8, 1, K.iron);
};

const paintCitadel: Painter = (v, x, z) => {
  box(v, x, z, 2, 2, CITY_GROUND, 5, K.brick);
  box(v, x, z, 1, 1, CITY_GROUND + 5, 3, K.iron);
  v.set(x + 1, CITY_GROUND + 7, z, K.blue);
};

const paintTwinTowers: Painter = (v, x, z) => {
  box(v, x + 1, z, 5, 3, CITY_GROUND, 4, K.brick);
  box(v, x + 1, z, 5, 3, CITY_GROUND + 4, 1, K.roofDark);
  for (const side of [0, 2]) {
    box(v, x, z + side, 1, 1, CITY_GROUND, 10, K.brick);
    box(v, x, z + side, 1, 1, CITY_GROUND + 10, 2, K.copper);
  }
};

const LANDMARKS: readonly Landmark[] = [
  { at: [59.3275, 18.0538], size: [7, 6], paint: paintCityHall },
  { at: [59.3268, 18.0717], size: [8, 8], paint: paintPalace },
  { at: [59.3281, 18.0679], size: [7, 3], paint: paintParliament },
  // Storkyrkan, Tyska kyrkan, Riddarholmskyrkan, Klara kyrka and S:t Johannes
  { at: [59.3256, 18.0702], size: [7, 3], paint: church(K.wallYellow, 8, 2, K.roofDark) },
  { at: [59.324, 18.0716], size: [7, 3], paint: church(K.brick, 7, 6, K.copper) },
  { at: [59.3248, 18.064], size: [7, 3], paint: church(K.brick, 6, 8, K.iron) },
  { at: [59.3312, 18.0612], size: [7, 3], paint: church(K.brick, 7, 8, K.copper) },
  { at: [59.3386, 18.0668], size: [7, 3], paint: church(K.brick, 7, 7, K.roofDark) },
  { at: [59.3418, 18.0745], size: [7, 3], paint: church(K.brick, 11, 2, K.copper) },
  // Katarina kyrka, Sofia kyrka and Gustaf Vasa kyrka
  { at: [59.3172, 18.0782], size: [5, 5], paint: domed(K.wallYellow, K.roofDark) },
  { at: [59.3127, 18.0897], size: [5, 5], paint: domed(K.brick, K.copper) },
  { at: [59.3431, 18.0497], size: [5, 5], paint: domed(K.wallWhite, K.roofGrey) },
  { at: [59.3177, 18.0425], size: [6, 3], paint: paintTwinTowers },
  { at: [59.334, 18.0637], size: [5, 14], paint: paintOffices },
  { at: [59.3323, 18.0647], size: [6, 5], paint: paintSquare },
  { at: [59.3301, 18.0581], size: [4, 10], paint: paintStation },
  // The opera, Nationalmuseum, Dramaten and Fotografiska
  { at: [59.3298, 18.071], size: [5, 5], paint: hall(K.wallCream, K.roofDark, 4) },
  { at: [59.3287, 18.0782], size: [5, 5], paint: hall(K.stone, K.roofGrey, 4) },
  { at: [59.3332, 18.0768], size: [5, 5], paint: hall(K.wallWhite, K.gold, 4) },
  { at: [59.3179, 18.085], size: [5, 5], paint: hall(K.brick, K.roofDark, 3) },
  // Skatteskrapan and Söder Torn
  { at: [59.3118, 18.0745], size: [3, 3], paint: highRise(K.wallWhite, 12, K.roofGrey) },
  { at: [59.3129, 18.0698], size: [3, 3], paint: highRise(K.wallRed, 10, K.copper) },
  { at: [59.328, 18.0916], size: [6, 5], paint: paintShipMuseum },
  { at: [59.3291, 18.0938], size: [4, 9], paint: paintNordicMuseum },
  { at: [59.3233, 18.0968], size: [9, 7], paint: paintFunfair },
  { at: [59.3263, 18.1035], size: [3, 3], paint: highRise(K.brick, 6, K.copper) },
  { at: [59.3434, 18.0547], size: [5, 5], paint: paintLibrary },
  { at: [59.319, 18.0738], size: [1, 3], paint: paintLift },
  { at: [59.3219, 18.0893], size: [2, 2], paint: paintCitadel }
];

type Bridge = { from: LatLon; to: LatLon; wide?: boolean; arches?: boolean };

const BRIDGES: readonly Bridge[] = [
  // Centralbron
  { from: [59.329, 18.0605], to: [59.3262, 18.0632], wide: true },
  { from: [59.3262, 18.0632], to: [59.3232, 18.0672], wide: true },
  { from: [59.3232, 18.0672], to: [59.3204, 18.07], wide: true },
  // Vasabron, Norrbro, Strömbron and Skeppsholmsbron
  { from: [59.3286, 18.0642], to: [59.3264, 18.0664] },
  { from: [59.3292, 18.0692], to: [59.3272, 18.07] },
  { from: [59.3292, 18.0738], to: [59.327, 18.0752] },
  { from: [59.3285, 18.0795], to: [59.3272, 18.0814] },
  // Kastellholmsbron and Djurgårdsbron
  { from: [59.3239, 18.0858], to: [59.3227, 18.0885] },
  { from: [59.3323, 18.0932], to: [59.3308, 18.0934], wide: true },
  // Västerbron
  { from: [59.3272, 18.0268], to: [59.3228, 18.0288], wide: true, arches: true },
  { from: [59.3212, 18.0292], to: [59.319, 18.0302], wide: true },
  // Over Klara sjö, Barnhusviken and Karlbergssjön
  { from: [59.328, 18.055], to: [59.3282, 18.0575] },
  { from: [59.3303, 18.0535], to: [59.3308, 18.0558] },
  { from: [59.3325, 18.05], to: [59.3333, 18.0525] },
  { from: [59.3378, 18.0375], to: [59.3396, 18.0398], wide: true },
  // Liljeholmsbron, Skanstullsbron and Danviksbron
  { from: [59.3142, 18.0318], to: [59.3118, 18.026], wide: true },
  { from: [59.3068, 18.0762], to: [59.3034, 18.0768], wide: true },
  { from: [59.3142, 18.1024], to: [59.3142, 18.1048] },
  // Pålsundsbron and Långholmsbron
  { from: [59.3212, 18.0405], to: [59.32, 18.041] },
  { from: [59.3206, 18.0325], to: [59.3194, 18.033] }
];

type Boat = { at: LatLon; long: boolean; masts?: boolean };

// Moored ships. The ones that sail are in harbour.ts.
const BOATS: readonly Boat[] = [{ at: [59.3252, 18.0798], long: false, masts: true }];

// Start and goal plates, and anything else that wants a clear patch of ground.
export type CityMarker = { cell: Cell; color: 'mint' | 'pink' };

export const buildStockholm = (markers: readonly CityMarker[]): BufferGeometry => {
  const v = createCityVolume(CITY_WIDTH, CITY_HEIGHT, CITY_DEPTH);
  const ground = createStockholmGround();
  const reserved = new Uint8Array(CITY_WIDTH * CITY_DEPTH);
  const at = (x: number, z: number): number => z * CITY_WIDTH + x;
  const inside = (x: number, z: number): boolean => x >= 0 && x < CITY_WIDTH && z >= 0 && z < CITY_DEPTH;
  const isWater = (x: number, z: number): boolean => inside(x, z) && ground[at(x, z)] === WATER;

  const reserve = (x0: number, x1: number, z0: number, z1: number): void => {
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (!inside(x, z)) continue;
        reserved[at(x, z)] = 1;
        ground[at(x, z)] = LAND;
      }
    }
  };

  const corners = LANDMARKS.map(({ at: place, size }) => {
    const [x, z] = cellOf(place);
    return [Math.round(x - size[0] / 2), Math.round(z - size[1] / 2)] as const;
  });
  LANDMARKS.forEach(({ size }, index) => reserve(corners[index][0] - 1, corners[index][0] + size[0], corners[index][1] - 1, corners[index][1] + size[1]));
  const markerCells = markers.map(({ cell }) => [Math.round(cell[0]), Math.round(cell[1])] as const);
  for (const [x, z] of markerCells) reserve(x - 2, x + 2, z - 2, z + 2);

  // Every cell a bridge passes, with how far along the bridge it lies.
  const spans = BRIDGES.map((bridge) => {
    const [ax, az] = cellOf(bridge.from);
    const [bx, bz] = cellOf(bridge.to);
    const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(bz - az)));
    const cells = Array.from({ length: steps + 1 }, (_, step) => [Math.round(ax + ((bx - ax) * step) / steps), Math.round(az + ((bz - az) * step) / steps)] as const);
    return { bridge, cells, sideways: Math.abs(bx - ax) < Math.abs(bz - az) };
  });
  for (const { cells } of spans) {
    for (const [x, z] of cells) {
      if (inside(x, z) && ground[at(x, z)] !== WATER) reserved[at(x, z)] = 1;
    }
  }

  const nearWater = (x: number, z: number): boolean => {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (isWater(x + dx, z + dz)) return true;
      }
    }
    return false;
  };

  // The building every cell belongs to, or zero for open ground.
  const owner = new Int32Array(CITY_WIDTH * CITY_DEPTH);
  const lots = new Uint8Array(CITY_WIDTH * CITY_DEPTH);
  for (let z = 0; z < CITY_DEPTH; z += 1) {
    for (let x = 0; x < CITY_WIDTH; x += 1) {
      if (ground[at(x, z)] !== LAND || reserved[at(x, z)] === 1 || nearWater(x, z)) continue;
      const district = DISTRICTS.indexOf(districtOf(x, z));
      const { pitch, shift, yards, density } = STYLES[DISTRICTS[district]];
      const lx = (x + shift) % pitch;
      const lz = (z + shift) % pitch;
      if (lx === 0 || lz === 0) continue;
      const bx = Math.floor((x + shift) / pitch);
      const bz = Math.floor((z + shift) / pitch);
      const inYard = yards && lx >= 3 && lx <= pitch - 3 && lz >= 3 && lz <= pitch - 3;
      if (inYard || hash3(bx, bz, district + 11) > density) {
        lots[at(x, z)] = 1;
        continue;
      }
      const split = hash3(bx, bz, 31);
      const half = split < 0.55 ? Number(lx > pitch / 2) : split < 0.8 ? Number(lz > pitch / 2) : 0;
      owner[at(x, z)] = 1 + ((district << 22) | (bx << 12) | (bz << 2) | half);
    }
  }
  const ownerAt = (x: number, z: number): number => (inside(x, z) ? owner[at(x, z)] : 0);

  const paintTree = (x: number, z: number, chance: number): void => {
    const pick = hash3(x, z, 5);
    if (pick > chance) return;
    v.set(x, CITY_GROUND, z, K.tree);
    if (pick < chance * 0.45) v.set(x, CITY_GROUND + 1, z, K.treeLight);
  };

  for (let z = 0; z < CITY_DEPTH; z += 1) {
    for (let x = 0; x < CITY_WIDTH; x += 1) {
      const kind = ground[at(x, z)];
      // The ripples are drawn on top of the water as it moves.
      if (kind === WATER) {
        v.set(x, SEA, z, K.water);
        continue;
      }
      const green = kind === PARK || lots[at(x, z)] === 1;
      const open = reserved[at(x, z)] === 1 ? K.plaza : nearWater(x, z) ? K.quay : K.street;
      v.fill(x, x, SEA, CITY_GROUND - 1, z, z, green ? (hash3(x, z, 9) < 0.3 ? K.grassLight : K.grass) : open);
      if (reserved[at(x, z)] === 1) continue;
      if (kind === PARK) paintTree(x, z, 0.2 + 0.6 * valueNoise3(x / 6, 0, z / 6));
      else if (lots[at(x, z)] === 1) paintTree(x, z, 0.45);

      const id = owner[at(x, z)];
      if (id === 0) continue;
      const { floors, walls, roofs } = STYLES[DISTRICTS[(id - 1) >> 22]];
      const height = floors[0] + Math.floor(hash3(id, 1, 0) * (floors[1] - floors[0] + 1));
      const wall = walls[Math.floor(hash3(id, 2, 0) * walls.length)];
      const roof = roofs[Math.floor(hash3(id, 3, 0) * roofs.length)];
      const edge = ownerAt(x - 1, z) !== id || ownerAt(x + 1, z) !== id || ownerAt(x, z - 1) !== id || ownerAt(x, z + 1) !== id;
      for (let floor = 0; floor < height; floor += 1) {
        const pane = edge && floor % 2 === 1 && ((x + z) & 1) === 0;
        v.set(x, CITY_GROUND + floor, z, pane ? (hash3(x, floor, z) < 0.14 ? K.windowLit : K.window) : wall);
      }
      v.set(x, CITY_GROUND + height, z, roof);
      if (!edge) v.set(x, CITY_GROUND + height + 1, z, roof);
    }
  }

  markers.forEach(({ color }, index) => {
    const [x, z] = markerCells[index];
    box(v, x - 2, z - 2, 5, 5, CITY_GROUND - 1, 1, K[color]);
    box(v, x - 1, z - 1, 3, 3, CITY_GROUND - 1, 1, K.windowLit);
  });

  // Decks one layer above the quays, on pillars, so the water shows underneath.
  for (const { bridge, cells, sideways } of spans) {
    cells.forEach(([x, z], step) => {
      const lanes = bridge.wide ? [0, 1] : [0];
      for (const lane of lanes) {
        const cx = x + (sideways ? lane : 0);
        const cz = z + (sideways ? 0 : lane);
        if (!isWater(cx, cz)) continue;
        v.set(cx, CITY_GROUND, cz, K.deck);
        if (step % 3 === 1) v.set(cx, CITY_GROUND - 1, cz, K.pillar);
      }
      if (bridge.arches && isWater(x, z)) {
        const rise = Math.round(3 * Math.abs(Math.sin((step / cells.length) * Math.PI * 2)));
        if (rise > 0) v.set(x, CITY_GROUND + rise, z, K.deck);
      }
    });
  }

  LANDMARKS.forEach(({ paint }, index) => paint(v, corners[index][0], corners[index][1]));

  for (const boat of BOATS) {
    const [x, z] = cellOf(boat.at).map(Math.round);
    const [width, depth] = boat.long ? [5, 2] : [2, 5];
    box(v, x, z, width, depth, SEA + 1, 1, K.white);
    box(v, x + (boat.long ? 1 : 0), z + (boat.long ? 0 : 1), boat.long ? 3 : 2, boat.long ? 2 : 3, SEA + 2, 1, boat.masts ? K.wood : K.wallWhite);
    if (boat.masts) for (const mast of [0, 2, 4]) box(v, x, z + mast, 1, 1, SEA + 2, 5, K.wood);
    else v.set(x + (boat.long ? 2 : 0), SEA + 3, z + (boat.long ? 0 : 2), K.red);
  }

  return buildCityGeometry(v, PALETTE, CITY_JITTER);
};
