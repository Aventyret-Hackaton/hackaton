import type { LatLon } from '@/lib/globe/geo';

// A hand-drawn, simplified map of central Stockholm on a grid of 25 metre cells.
export const CITY_WIDTH = 232;
export const CITY_DEPTH = 214;

const WEST = 18.018;
const EAST = 18.12;
const SOUTH = 59.3;
const NORTH = 59.348;

export type Cell = readonly [x: number, z: number];

export const WATER = 0;
export const LAND = 1;
export const PARK = 2;

export type District = 'old' | 'city' | 'stately' | 'mixed' | 'suburb';

// Cell coordinates of a place; x grows eastwards and z southwards.
export const cellOf = ([latitude, longitude]: LatLon): Cell => [((longitude - WEST) / (EAST - WEST)) * CITY_WIDTH, ((NORTH - latitude) / (NORTH - SOUTH)) * CITY_DEPTH];

const latitudeOf = (z: number): number => NORTH - ((z + 0.5) / CITY_DEPTH) * (NORTH - SOUTH);
const longitudeOf = (x: number): number => WEST + ((x + 0.5) / CITY_WIDTH) * (EAST - WEST);

export const DISTRICT_NAMES: readonly { name: string; at: LatLon }[] = [
  { name: 'Norrmalm', at: [59.3362, 18.0585] },
  { name: 'Gamla stan', at: [59.3246, 18.0712] },
  { name: 'Södermalm', at: [59.3128, 18.0585] },
  { name: 'Kungsholmen', at: [59.3312, 18.0385] },
  { name: 'Östermalm', at: [59.3378, 18.0855] },
  { name: 'Djurgården', at: [59.3268, 18.1075] }
];

type Shape = readonly LatLon[];

// Riddarfjärden, the bay between Kungsholmen and Södermalm.
const RIDDARFJARDEN: Shape = [
  [59.3255, 18.018],
  [59.3262, 18.026],
  [59.3268, 18.033],
  [59.3262, 18.04],
  [59.3266, 18.047],
  [59.327, 18.0545],
  [59.3279, 18.0575],
  [59.3281, 18.0625],
  [59.3262, 18.0625],
  [59.3255, 18.0618],
  [59.324, 18.0622],
  [59.3232, 18.064],
  [59.3228, 18.068],
  [59.3221, 18.0705],
  [59.3205, 18.0712],
  [59.3199, 18.069],
  [59.32, 18.06],
  [59.3205, 18.05],
  [59.3208, 18.043],
  [59.3222, 18.0425],
  [59.3232, 18.035],
  [59.3238, 18.028],
  [59.3235, 18.02],
  [59.3232, 18.018]
];

// Liljeholmsviken and Årstaviken, west and south of Södermalm.
const ARSTAVIKEN: Shape = [
  [59.32, 18.018],
  [59.3197, 18.024],
  [59.319, 18.0285],
  [59.317, 18.0305],
  [59.3145, 18.032],
  [59.3125, 18.0345],
  [59.3105, 18.038],
  [59.309, 18.043],
  [59.308, 18.05],
  [59.3072, 18.058],
  [59.3062, 18.066],
  [59.3055, 18.073],
  [59.3052, 18.077],
  [59.304, 18.077],
  [59.3038, 18.07],
  [59.304, 18.062],
  [59.3045, 18.054],
  [59.3055, 18.046],
  [59.3065, 18.04],
  [59.308, 18.035],
  [59.3095, 18.03],
  [59.312, 18.026],
  [59.315, 18.0225],
  [59.3165, 18.018]
];

const HAMMARBY_SJO: Shape = [
  [59.3048, 18.083],
  [59.3062, 18.088],
  [59.3072, 18.095],
  [59.3078, 18.101],
  [59.3082, 18.104],
  [59.306, 18.106],
  [59.304, 18.104],
  [59.3028, 18.098],
  [59.3025, 18.09],
  [59.303, 18.083]
];

// Strömmen and Saltsjön, from Gamla stan out towards the archipelago.
const SALTSJON: Shape = [
  [59.3205, 18.0735],
  [59.3222, 18.0742],
  [59.3235, 18.0752],
  [59.3255, 18.076],
  [59.327, 18.0757],
  [59.3282, 18.0735],
  [59.3293, 18.0745],
  [59.329, 18.0775],
  [59.3282, 18.08],
  [59.33, 18.0795],
  [59.3315, 18.078],
  [59.3327, 18.0765],
  [59.3328, 18.08],
  [59.3325, 18.086],
  [59.332, 18.0925],
  [59.331, 18.0925],
  [59.3295, 18.091],
  [59.3275, 18.0903],
  [59.3255, 18.0915],
  [59.324, 18.0935],
  [59.3225, 18.095],
  [59.3215, 18.0985],
  [59.3215, 18.104],
  [59.322, 18.11],
  [59.321, 18.12],
  [59.316, 18.12],
  [59.3158, 18.112],
  [59.315, 18.1045],
  [59.3158, 18.099],
  [59.317, 18.093],
  [59.3178, 18.086],
  [59.3185, 18.079],
  [59.3195, 18.075]
];

const DJURGARDSBRUNNSVIKEN: Shape = [
  [59.3321, 18.092],
  [59.3327, 18.099],
  [59.3338, 18.106],
  [59.3345, 18.113],
  [59.3348, 18.12],
  [59.3326, 18.12],
  [59.3322, 18.113],
  [59.3318, 18.106],
  [59.3313, 18.099],
  [59.331, 18.092]
];

const NORRSTROM: Shape = [
  [59.3283, 18.0625],
  [59.3288, 18.066],
  [59.329, 18.0705],
  [59.329, 18.074],
  [59.327, 18.0757],
  [59.3275, 18.0725],
  [59.3273, 18.0685],
  [59.3266, 18.066],
  [59.3262, 18.0625]
];

const WATERS: readonly Shape[] = [RIDDARFJARDEN, ARSTAVIKEN, HAMMARBY_SJO, SALTSJON, DJURGARDSBRUNNSVIKEN, NORRSTROM];

// Islands that lie inside the waters above.
const ISLANDS: readonly Shape[] = [
  // Helgeandsholmen
  [
    [59.3284, 18.0655],
    [59.3286, 18.07],
    [59.3279, 18.0705],
    [59.3277, 18.066]
  ],
  // Skeppsholmen
  [
    [59.3275, 18.0812],
    [59.3272, 18.0848],
    [59.3262, 18.0866],
    [59.3245, 18.0863],
    [59.3238, 18.0842],
    [59.3245, 18.0815],
    [59.3262, 18.0806]
  ],
  // Kastellholmen
  [
    [59.3228, 18.088],
    [59.3225, 18.0905],
    [59.3214, 18.0908],
    [59.3212, 18.0888],
    [59.322, 18.0875]
  ],
  // Beckholmen
  [
    [59.3209, 18.097],
    [59.3207, 18.1012],
    [59.3199, 18.1018],
    [59.3197, 18.0985]
  ]
];

type Channel = { path: Shape; widths: readonly number[] };

// Narrow waters, drawn as lines with a width in cells at every point.
const CHANNELS: readonly Channel[] = [
  // Klara sjö, Barnhusviken and Karlbergssjön
  {
    path: [
      [59.3275, 18.0563],
      [59.3295, 18.0553],
      [59.3318, 18.0522],
      [59.334, 18.0482],
      [59.3362, 18.044],
      [59.3385, 18.0388],
      [59.3402, 18.033],
      [59.3413, 18.027],
      [59.342, 18.018]
    ],
    widths: [2.6, 2.6, 2.6, 3, 3.6, 4.4, 6.5, 6.5, 5.5]
  },
  // Riddarholmskanalen
  {
    path: [
      [59.3264, 18.0661],
      [59.3235, 18.0661]
    ],
    widths: [1.8, 1.8]
  },
  // Pålsundet
  {
    path: [
      [59.321, 18.0432],
      [59.3203, 18.036],
      [59.3199, 18.03],
      [59.3198, 18.0235]
    ],
    widths: [2.4, 2.2, 2.2, 2.6]
  },
  // Hammarbykanalen
  {
    path: [
      [59.3046, 18.0765],
      [59.304, 18.0835]
    ],
    widths: [3.4, 3.4]
  },
  // Danvikskanalen
  {
    path: [
      [59.3079, 18.1036],
      [59.311, 18.104],
      [59.3152, 18.1034]
    ],
    widths: [2.4, 2.4, 2.4]
  }
];

type Region = readonly [latMin: number, latMax: number, lonMin: number, lonMax: number];

const PARKS: readonly Region[] = [
  // Djurgården and Gärdet
  [59.319, 59.3362, 18.094, 18.12],
  [59.319, 59.3322, 18.089, 18.094],
  // Skeppsholmen and Kastellholmen
  [59.321, 59.3277, 18.08, 18.0912],
  // Långholmen
  [59.32, 59.324, 18.018, 18.0432],
  // Rålambshovsparken
  [59.3262, 59.3292, 18.02, 18.031],
  // Kronobergsparken
  [59.3322, 59.3342, 18.0355, 18.041],
  // Kungsträdgården
  [59.3298, 59.3322, 18.0706, 18.0722],
  // Humlegården
  [59.3384, 59.341, 18.07, 18.0762],
  // Vasaparken
  [59.3398, 59.3416, 18.0395, 18.0465],
  // Observatorielunden
  [59.3408, 59.3425, 18.053, 18.057],
  // Tantolunden
  [59.3105, 59.314, 18.037, 18.048],
  // Mariatorget
  [59.3165, 59.3176, 18.062, 18.0645],
  // Vitabergsparken
  [59.3115, 59.314, 18.0865, 18.0925],
  // Eriksdalslunden
  [59.3055, 59.3072, 18.066, 18.075],
  // Skinnarviksberget
  [59.32, 59.3212, 18.046, 18.054],
  // Karlbergsparken
  [59.3405, 59.344, 18.018, 18.03]
];

const within = (latitude: number, longitude: number, [latMin, latMax, lonMin, lonMax]: Region): boolean =>
  latitude >= latMin && latitude <= latMax && longitude >= lonMin && longitude <= lonMax;

// The kind of city that grows at the given cell.
export const districtOf = (x: number, z: number): District => {
  const latitude = latitudeOf(z);
  const longitude = longitudeOf(x);
  if (within(latitude, longitude, [59.3215, 59.329, 18.0615, 18.0765])) return 'old';
  if (latitude < 59.3048 || (longitude < 18.03 && latitude < 59.318) || (longitude > 18.1045 && latitude < 59.316)) return 'suburb';
  if (within(latitude, longitude, [59.3285, 59.3375, 18.055, 18.076])) return 'city';
  if (latitude > 59.332 && longitude > 18.076) return 'stately';
  return 'mixed';
};

const contains = (shape: readonly Cell[], x: number, z: number): boolean => {
  let inside = false;
  for (let index = 0, previous = shape.length - 1; index < shape.length; previous = index, index += 1) {
    const [ax, az] = shape[index];
    const [bx, bz] = shape[previous];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
};

// Distance from a point to a line segment, and how far along the segment it is.
const toSegment = (x: number, z: number, [ax, az]: Cell, [bx, bz]: Cell): { distance: number; along: number } => {
  const dx = bx - ax;
  const dz = bz - az;
  const along = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return { distance: Math.hypot(x - ax - dx * along, z - az - dz * along), along };
};

// One value per cell, row by row from the north-west corner.
export const createStockholmGround = (): Uint8Array => {
  const ground = new Uint8Array(CITY_WIDTH * CITY_DEPTH).fill(LAND);
  const paint = (shape: Shape, kind: number): void => {
    const cells = shape.map(cellOf);
    const x0 = Math.max(0, Math.floor(Math.min(...cells.map(([x]) => x))));
    const x1 = Math.min(CITY_WIDTH - 1, Math.ceil(Math.max(...cells.map(([x]) => x))));
    const z0 = Math.max(0, Math.floor(Math.min(...cells.map(([, z]) => z))));
    const z1 = Math.min(CITY_DEPTH - 1, Math.ceil(Math.max(...cells.map(([, z]) => z))));
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (contains(cells, x + 0.5, z + 0.5)) ground[z * CITY_WIDTH + x] = kind;
      }
    }
  };

  for (const shape of WATERS) paint(shape, WATER);
  for (const shape of ISLANDS) paint(shape, LAND);

  for (const { path, widths } of CHANNELS) {
    const cells = path.map(cellOf);
    for (let index = 1; index < cells.length; index += 1) {
      const reach = Math.max(widths[index - 1], widths[index]);
      const [ax, az] = cells[index - 1];
      const [bx, bz] = cells[index];
      for (let z = Math.max(0, Math.floor(Math.min(az, bz) - reach)); z <= Math.min(CITY_DEPTH - 1, Math.ceil(Math.max(az, bz) + reach)); z += 1) {
        for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - reach)); x <= Math.min(CITY_WIDTH - 1, Math.ceil(Math.max(ax, bx) + reach)); x += 1) {
          const { distance, along } = toSegment(x + 0.5, z + 0.5, cells[index - 1], cells[index]);
          if (distance <= (widths[index - 1] + (widths[index] - widths[index - 1]) * along) / 2) ground[z * CITY_WIDTH + x] = WATER;
        }
      }
    }
  }

  for (let z = 0; z < CITY_DEPTH; z += 1) {
    for (let x = 0; x < CITY_WIDTH; x += 1) {
      const index = z * CITY_WIDTH + x;
      if (ground[index] === LAND && PARKS.some((park) => within(latitudeOf(z), longitudeOf(x), park))) ground[index] = PARK;
    }
  }
  return ground;
};
