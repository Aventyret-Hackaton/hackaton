import type { BufferGeometry } from 'three';

import type { Cell } from './stockholmMap';
import { buildCityGeometry, type CityVolume, createCityVolume } from './volume';

const JITTER = 0.07;

const COLORS = {
  white: 0xf4f1e6,
  shade: 0xd4cfc0,
  grey: 0xb7bcc4,
  navy: 0x24304d,
  black: 0x23283a,
  blue: 0x2a63c4,
  yellow: 0xffd24a,
  red: 0xd8432f,
  wood: 0x8a5a36,
  darkWood: 0x5c3b22,
  window: 0x3b4a66,
  glass: 0xbfe8f2,
  foam: 0xd6ecff,
  smoke: 0xe3e6ea,
  skin: 0xf2c29b,
  beak: 0xf2a51e
} as const;

type ColorName = keyof typeof COLORS;

const COLOR_NAMES = Object.keys(COLORS) as ColorName[];
const PALETTE = COLOR_NAMES.map((name) => COLORS[name]);
const K = Object.fromEntries(COLOR_NAMES.map((name, index) => [name, index + 1])) as Record<ColorName, number>;

// Paints one pose of a model. The bow points towards +x and layer 0 lies in the water.
type Painter = (v: CityVolume, frame: number) => void;

// The block has to leave a voxel free around the model, or its outer sides are not drawn.
type Model = { size: readonly [width: number, height: number, depth: number]; frames: number; paint: Painter };

export type VesselKind = 'ferry' | 'steamer' | 'sloop' | 'cutter' | 'dinghy' | 'sightseer' | 'motorboat' | 'rowboat';

export type Vessel = {
  kind: VesselKind;
  // A loop over the water, in cells of the city map.
  route: readonly Cell[];
  // Cells per second, and how far round the loop the vessel starts.
  speed: number;
  lead: number;
  // Cells per voxel of the model, and poses per second.
  size: number;
  beat: number;
  // How far the vessel leans, in radians.
  heel: number;
};

// A hull between x0 and x1 that is rounded at the stern and narrows to the bow.
const paintHull = (v: CityVolume, x0: number, x1: number, z0: number, z1: number, y: number, color: number): void => {
  const middle = (z0 + z1) / 2;
  v.fill(x0 + 1, x1 - 2, y, y, z0, z1, color);
  v.fill(x0, x0, y, y, z0 + 1, z1 - 1, color);
  v.fill(x1 - 1, x1 - 1, y, y, z0 + 1, z1 - 1, color);
  v.fill(x1, x1, y, y, Math.floor(middle), Math.ceil(middle), color);
};

// Foam in two lines that spread behind the stern. Every other voxel shows in each pose, so the wake runs.
const paintWake = (v: CityVolume, stern: number, z0: number, z1: number, length: number, frame: number): void => {
  for (let back = 1; back <= length; back += 1) {
    if ((back + frame) % 2 === 0) continue;
    const spread = Math.floor(back / 3);
    v.set(stern - back, 0, z0 - spread, K.foam);
    v.set(stern - back, 0, z1 + spread, K.foam);
  }
  v.set(stern - 1 - frame, 0, Math.floor((z0 + z1) / 2), K.foam);
};

const paintCabin = (v: CityVolume, x0: number, x1: number, z0: number, z1: number): void => {
  v.fill(x0, x1, 2, 3, z0, z1, K.white);
  for (let x = x0; x <= x1; x += 2) {
    for (const z of [z0, z1]) v.set(x, 3, z, K.window);
  }
  v.fill(x0, x1, 4, 4, z0, z1, K.grey);
};

const paintFerry: Painter = (v, frame) => {
  paintHull(v, 7, 22, 2, 7, 0, K.navy);
  paintHull(v, 7, 22, 2, 7, 1, K.white);
  paintCabin(v, 10, 19, 3, 6);
  v.fill(17, 18, 5, 5, 4, 5, K.white);
  v.fill(18, 18, 5, 5, 4, 5, K.window);
  v.fill(13, 14, 5, 6, 4, 5, K.yellow);
  v.fill(13, 14, 7, 7, 4, 5, K.blue);
  v.fill(8, 8, 2, 4, 4, 4, K.black);
  v.set(8, 4, 5, K.yellow);
  paintWake(v, 7, 2, 7, 5, frame);
};

const paintSteamer: Painter = (v, frame) => {
  paintHull(v, 9, 28, 2, 7, 0, K.black);
  paintHull(v, 9, 28, 2, 7, 1, K.white);
  paintCabin(v, 13, 23, 3, 6);
  v.fill(17, 18, 5, 8, 4, 5, K.black);
  v.fill(17, 18, 7, 7, 4, 5, K.red);
  for (const x of [11, 26]) v.fill(x, x, 2, 8, 4, 4, K.wood);
  // The smoke trails behind the funnel.
  v.set(16 - frame, 10, 4 + frame, K.smoke);
  v.set(14 - frame, 11 + frame, 5 - frame, K.smoke);
  paintWake(v, 9, 2, 7, 5, frame);
};

const paintSailboat =
  (jib: number): Painter =>
  (v, frame) => {
    paintHull(v, 4, 12, 2, 4, 0, K.white);
    paintHull(v, 4, 12, 2, 4, 1, K.wood);
    v.fill(9, 9, 2, 12, 3, 3, K.darkWood);
    for (let y = 3; y <= 11; y += 1) v.fill(9 - Math.ceil((12 - y) * 0.55), 8, y, y, 3, 3, y === 3 ? K.shade : K.white);
    for (let y = 3; y <= 8; y += 1) v.fill(10, 9 + Math.ceil((9 - y) * 0.5), y, y, 3, 3, jib);
    v.set(6, 2, 3, K.red);
    paintWake(v, 4, 2, 4, 3, frame);
  };

const paintSightseer: Painter = (v, frame) => {
  paintHull(v, 7, 20, 2, 5, 0, K.white);
  paintHull(v, 7, 20, 2, 5, 1, K.red);
  for (let x = 9; x <= 18; x += 1) v.fill(x, x, 2, 2, 2, 5, (x - 9) % 3 === 0 ? K.white : K.glass);
  paintWake(v, 7, 2, 5, 5, frame);
};

const paintMotorboat: Painter = (v, frame) => {
  paintHull(v, 12, 18, 4, 6, 0, K.white);
  v.fill(13, 15, 1, 1, 4, 6, K.red);
  v.fill(16, 16, 1, 1, 4, 6, K.glass);
  v.set(14, 2, 5, K.black);
  paintWake(v, 12, 4, 6, 10, frame);
};

// The oars reach forward in one pose and back in the other.
const paintRowboat: Painter = (v, frame) => {
  const reach = frame === 0 ? 1 : -1;
  paintHull(v, 4, 8, 3, 5, 0, K.wood);
  v.set(6, 1, 4, K.red);
  v.set(6, 2, 4, K.skin);
  for (const z of [1, 2, 6, 7]) v.set(6 + (z === 1 || z === 7 ? reach : 0), 1, z, K.darkWood);
};

// How high each voxel of a wing is, from the body outwards: wings up, level and down.
const WING_HEIGHTS = [
  [2, 3, 4, 4],
  [2, 2, 2, 2],
  [2, 1, 1, 0]
] as const;

const paintGull: Painter = (v, frame) => {
  v.set(1, 2, 5, K.grey);
  v.fill(2, 6, 2, 2, 5, 5, K.white);
  v.set(7, 2, 5, K.beak);
  WING_HEIGHTS[frame].forEach((height, out) => {
    for (const z of [4 - out, 6 + out]) v.fill(3, 4, height, height, z, z, out === 3 ? K.black : out === 2 ? K.grey : K.white);
  });
};

const MODELS: Record<VesselKind, Model> = {
  ferry: { size: [30, 9, 10], frames: 2, paint: paintFerry },
  steamer: { size: [38, 13, 10], frames: 2, paint: paintSteamer },
  sloop: { size: [18, 14, 7], frames: 2, paint: paintSailboat(K.white) },
  cutter: { size: [18, 14, 7], frames: 2, paint: paintSailboat(K.red) },
  dinghy: { size: [18, 14, 7], frames: 2, paint: paintSailboat(K.yellow) },
  sightseer: { size: [28, 4, 8], frames: 2, paint: paintSightseer },
  motorboat: { size: [30, 4, 11], frames: 2, paint: paintMotorboat },
  rowboat: { size: [12, 4, 9], frames: 2, paint: paintRowboat }
};

const GULL: Model = { size: [9, 6, 11], frames: WING_HEIGHTS.length, paint: paintGull };

const RIDDARFJARDEN: readonly Cell[] = [
  [20, 102],
  [50, 100],
  [80, 104],
  [95, 112],
  [85, 116],
  [60, 108.5],
  [35, 106],
  [15, 104.5]
];

// Every route keeps at least a cell and a half of water around it.
export const FLEET: readonly Vessel[] = [
  { kind: 'sloop', route: RIDDARFJARDEN, speed: 1, lead: 0, size: 0.48, beat: 3, heel: 0.14 },
  { kind: 'cutter', route: RIDDARFJARDEN, speed: 1, lead: 0.5, size: 0.48, beat: 3, heel: 0.14 },
  {
    kind: 'ferry',
    route: [
      [136, 123],
      [158, 123.5],
      [174, 127.5],
      [186, 131.5],
      [202, 129.5],
      [214, 125],
      [218, 121.5],
      [212, 120],
      [202, 126],
      [188, 129.3],
      [175, 125.2],
      [158, 120.8],
      [138, 120.5],
      [133, 122]
    ],
    speed: 1.5,
    lead: 0.1,
    size: 0.5,
    beat: 3,
    heel: 0
  },
  {
    kind: 'steamer',
    route: [
      [148, 128.5],
      [166, 132.5],
      [186, 137.5],
      [208, 139.5],
      [224, 138],
      [229, 135],
      [224, 132.5],
      [206, 135.2],
      [188, 134.3],
      [170, 130],
      [152, 126.8],
      [144, 127]
    ],
    speed: 1.2,
    lead: 0.55,
    size: 0.5,
    beat: 2,
    heel: 0
  },
  {
    kind: 'dinghy',
    route: [
      [192, 68.5],
      [204, 66],
      [218, 64.5],
      [220, 66.8],
      [210, 68],
      [200, 69.5]
    ],
    speed: 0.7,
    lead: 0.3,
    size: 0.42,
    beat: 3,
    heel: 0.14
  },
  {
    kind: 'sightseer',
    route: [
      [146, 73],
      [158, 73.5],
      [161, 80],
      [158, 87],
      [148, 88],
      [144, 81]
    ],
    speed: 0.9,
    lead: 0.7,
    size: 0.44,
    beat: 3,
    heel: 0
  },
  {
    kind: 'motorboat',
    route: [
      [8, 134],
      [15, 146],
      [26, 158],
      [38, 170],
      [56, 181],
      [76, 187.5],
      [96, 191],
      [112, 192.6],
      [120, 193],
      [123, 191.6],
      [112, 190.2],
      [98, 187.2],
      [80, 183.8],
      [62, 179.5],
      [46, 171.5],
      [34, 160],
      [25, 148],
      [19, 137],
      [13, 131.5]
    ],
    speed: 2.6,
    lead: 0.2,
    size: 0.42,
    beat: 4,
    heel: 0
  },
  {
    kind: 'rowboat',
    route: [
      [165, 190],
      [185, 186],
      [190, 192],
      [175, 196],
      [158, 195]
    ],
    speed: 0.45,
    lead: 0,
    size: 0.46,
    beat: 1.2,
    heel: 0
  }
];

const buildFrames = ({ size: [width, height, depth], frames, paint }: Model): BufferGeometry[] =>
  Array.from({ length: frames }, (_, frame) => {
    const volume = createCityVolume(width, height, depth);
    paint(volume, frame);
    return buildCityGeometry(volume, PALETTE, JITTER);
  });

// The poses of a vessel, centred on its block and standing on the water.
export const buildVessel = (kind: VesselKind): BufferGeometry[] => buildFrames(MODELS[kind]);

// A gull with its wings up, level and down.
export const buildGull = (): BufferGeometry[] => buildFrames(GULL);
