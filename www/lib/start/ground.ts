import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, Vector3 } from 'three';

import { hash3, valueNoise3 } from '@/lib/voxel/hash';

import { CAMERA_HEIGHT, frameRay, onLevelGround, type Pixel, type Place, type Spot } from './frame';
import { S } from './palette';

export type RoutePoint = { x: number; d: number; dx: number; dd: number };

export type Route = {
  length: number;
  // Place and direction of travel at a distance along the route. Open routes run straight on past their ends.
  at: (distance: number) => RoutePoint;
};

export type Routes = { footpath: Route; road: Route; trail: Route; rails: Route; river: Route; swan: Route };

export type Ground = {
  geometries: readonly BufferGeometry[];
  water: BufferGeometry;
  // Colours the water for a moment in time.
  flow: (seconds: number) => void;
  // Top of the ground at a place.
  heightAt: (x: number, d: number) => number;
  // Where a pixel of the frame sees the ground.
  seenAt: (pixel: Pixel) => Place;
  // Grass that is clear of the paths and the water.
  isLawn: (x: number, d: number) => boolean;
};

// How far along the rails the tunnel mouths are, from the start and from the end.
export const RAIL_MOUTHS = [10.5, 6] as const;
export const WATER_LEVEL = -0.2;

const GRASS = 0;
const SAND = 1;
const ROAD = 2;
const RAIL = 3;
const RIVER = 4;

const SAMPLE_STEP = 0.1;
const LANE_STEP = 0.25;
const SIDE_SHADE = 0.82;
const SKIRT = 4;
const JITTER = 0.07;

// Hills as x, d, radius across, radius ahead and height.
const HILLS: readonly (readonly [x: number, d: number, across: number, ahead: number, height: number])[] = [
  [-8.6, 13.2, 3.2, 3, 1.9],
  [-42, 56, 18, 16, 7.5],
  [-22.5, 45, 6, 6, 3.2],
  [-1, 46, 9, 6, 1.6],
  [-6, 64, 16, 10, 3.5],
  [12, 78, 22, 12, 5],
  [18.5, 36, 6, 5, 4.5],
  [24, 30, 7, 9, 2.5],
  [44, 62, 16, 16, 7]
];

type Lane = {
  kind: number;
  route: Route;
  from: number;
  to: number;
  half: (point: RoutePoint) => number;
  // Level ground beside the surface, and how far the ground takes to get back to its own height.
  shoulder: number;
  margin: number;
  level?: number;
  sink?: number;
};

type FieldSpec = {
  cell: number;
  step: number;
  x0: number;
  x1: number;
  d0: number;
  d1: number;
  lanes: boolean;
  owns: (x: number, d: number) => boolean;
};

type Field = FieldSpec & {
  cols: number;
  rows: number;
  // NaN where the field has no ground of its own.
  height: Float32Array;
  kind: Uint8Array;
  across: Float32Array;
  along: Float32Array;
  half: Float32Array;
  edge: Float32Array;
  target: Float32Array;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const smoothstep = (from: number, to: number, value: number): number => {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};

export const createRoute = (spots: readonly Spot[], closed = false): Route => {
  const curve = new CatmullRomCurve3(
    spots.map(([x, d]) => new Vector3(x, 0, d)),
    closed,
    'centripetal'
  );
  curve.arcLengthDivisions = 800;
  const length = curve.getLength();
  const point = new Vector3();
  const tangent = new Vector3();

  return {
    length,
    at: (distance): RoutePoint => {
      const lap = distance / length;
      const u = closed ? lap - Math.floor(lap) : clamp(lap, 0, 1);
      curve.getPointAt(u, point);
      curve.getTangentAt(u, tangent);
      const past = closed ? 0 : distance - u * length;
      return { x: point.x + tangent.x * past, d: point.z + tangent.z * past, dx: tangent.x, dd: tangent.z };
    }
  };
};

const level = (pixels: readonly Pixel[]): Spot[] => pixels.map(onLevelGround);

// The road is a loop: its right half is behind the panel. The rails start and end inside the hills.
export const createRoutes = (): Routes => ({
  footpath: createRoute(
    level([
      [-60, 1900],
      [70, 1300],
      [170, 1040],
      [280, 930],
      [380, 835],
      [462, 770],
      [540, 722],
      [596, 685],
      [645, 642]
    ])
  ),
  road: createRoute(
    level([
      [362, 585],
      [400, 600],
      [480, 610],
      [560, 622],
      [640, 636],
      [720, 636],
      [800, 626],
      [900, 612],
      [1000, 594],
      [1040, 556],
      [990, 522],
      [890, 505],
      [790, 500],
      [690, 505],
      [600, 515],
      [520, 532],
      [440, 552],
      [385, 568]
    ]),
    true
  ),
  trail: createRoute(
    level([
      [690, 505],
      [712, 470],
      [745, 445],
      [785, 428],
      [805, 414],
      [800, 398]
    ])
  ),
  rails: createRoute([
    [-25, 47.5],
    [-17.7, 40],
    [-12.5, 34.2],
    [-7.5, 30.6],
    [-1.5, 29.3],
    [5, 29.4],
    [11, 30.6],
    [15.5, 33],
    [20, 37]
  ]),
  river: createRoute(
    level([
      [2300, 690],
      [2000, 705],
      [1672, 738],
      [1500, 742],
      [1350, 765],
      [1200, 792],
      [1080, 815],
      [960, 852],
      [850, 895],
      [770, 950],
      [700, 1060],
      [640, 1300],
      [600, 1800]
    ])
  ),
  swan: createRoute(
    level([
      [1520, 733],
      [1380, 752],
      [1250, 775],
      [1270, 797],
      [1400, 776],
      [1540, 757]
    ]),
    true
  )
});

// The lie of the land, which the paths follow.
const landHeight = (x: number, d: number): number => {
  let height = 0;
  for (const [hillX, hillD, across, ahead, top] of HILLS) {
    const u = (x - hillX) / across;
    const v = (d - hillD) / ahead;
    const falloff = u * u + v * v;
    if (falloff < 9) height += top * Math.exp(-falloff);
  }
  height += (valueNoise3(x * 0.07, d * 0.07, 5) - 0.42) * 3 * smoothstep(36, 70, d);
  height += (valueNoise3(x * 0.022, d * 0.022, 9) - 0.4) * 10 * smoothstep(80, 200, d);
  return height;
};

// Low terraces in the lawn, between the flat ground in front and the hills.
const baseHeight = (x: number, d: number): number =>
  landHeight(x, d) + Math.max(0, valueNoise3(x * 0.15, d * 0.15, 13) - 0.66) * 3 * smoothstep(12, 17, d) * (1 - smoothstep(36, 70, d));

// The finest ground is a wedge in front of the camera, on whole metres so that the next field fits around it.
const inFront = (x: number, d: number): boolean => {
  const ahead = Math.floor(d) + 0.5;
  return ahead < 52 && Math.abs(Math.floor(x) + 0.5) < Math.min(36, 7 + ahead);
};
const inMiddle = (x: number, d: number): boolean => Math.abs(x) < 111 && d < 132;

const FIELDS: readonly FieldSpec[] = [
  { cell: 0.25, step: 0.5, x0: -36, x1: 36, d0: 0, d1: 52, lanes: true, owns: inFront },
  { cell: 1, step: 0.5, x0: -111, x1: 111, d0: 0, d1: 132, lanes: true, owns: (x, d): boolean => !inFront(x, d) },
  { cell: 3, step: 1.5, x0: -240, x1: 240, d0: 0, d1: 273, lanes: false, owns: (x, d): boolean => !inMiddle(x, d) }
];

const createLanes = ({ footpath, road, trail, rails, river }: Routes): readonly Lane[] => [
  { kind: SAND, route: footpath, from: 0, to: footpath.length, half: (): number => 0.45, shoulder: 0.2, margin: 0.8 },
  { kind: SAND, route: trail, from: 0, to: trail.length, half: (): number => 0.5, shoulder: 0.2, margin: 0.8 },
  { kind: ROAD, route: road, from: 0, to: road.length, half: (): number => 1.4, shoulder: 0.3, margin: 1.2 },
  { kind: RAIL, route: rails, from: RAIL_MOUTHS[0], to: rails.length - RAIL_MOUTHS[1], half: (): number => 1.05, shoulder: 0.5, margin: 1.4, level: 0 },
  // The river is narrow where it runs towards the camera and wide to the right.
  { kind: RIVER, route: river, from: 0, to: river.length, half: ({ x }): number => 0.42 + smoothstep(0.5, 6.5, x) * 1.15, shoulder: 0.12, margin: 0.3, sink: 0.45 }
];

const createField = (spec: FieldSpec): Field => {
  const cols = Math.round((spec.x1 - spec.x0) / spec.cell);
  const rows = Math.round((spec.d1 - spec.d0) / spec.cell);
  const size = cols * rows;
  return {
    ...spec,
    cols,
    rows,
    height: new Float32Array(size),
    kind: new Uint8Array(size),
    across: new Float32Array(size),
    along: new Float32Array(size),
    half: new Float32Array(size),
    edge: new Float32Array(size).fill(Number.POSITIVE_INFINITY),
    target: new Float32Array(size)
  };
};

// Marks the cells that a lane covers, and the ones beside it that give way to its level.
const stampLane = (field: Field, lane: Lane): void => {
  const { cell, cols, rows, x0, d0 } = field;
  for (let distance = lane.from; distance <= lane.to; distance += SAMPLE_STEP) {
    const point = lane.route.at(distance);
    const half = lane.half(point);
    const flat = half + lane.shoulder;
    const reach = flat + lane.margin;
    const target = (lane.level ?? landHeight(point.x, point.d)) - (lane.sink ?? 0);
    const firstCol = Math.max(0, Math.floor((point.x - reach - x0) / cell));
    const lastCol = Math.min(cols - 1, Math.floor((point.x + reach - x0) / cell));
    const firstRow = Math.max(0, Math.floor((point.d - reach - d0) / cell));
    const lastRow = Math.min(rows - 1, Math.floor((point.d + reach - d0) / cell));

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        const offsetX = x0 + (col + 0.5) * cell - point.x;
        const offsetD = d0 + (row + 0.5) * cell - point.d;
        const away = Math.hypot(offsetX, offsetD);
        if (away > reach) continue;
        const index = row * cols + col;
        const edge = (away - flat) / lane.margin;
        const kind = field.kind[index];
        const across = point.dx * offsetD - point.dd * offsetX >= 0 ? away : -away;
        if (edge < field.edge[index]) {
          field.edge[index] = edge;
          field.target[index] = target;
          // The banks need to know where along the river they are too.
          if (kind === GRASS) {
            field.across[index] = across;
            field.along[index] = distance;
          }
        }
        if (away > half) continue;
        if (lane.kind > kind || (lane.kind === kind && away < Math.abs(field.across[index]))) {
          field.kind[index] = lane.kind;
          field.across[index] = across;
          field.along[index] = distance;
          field.half[index] = half;
        }
      }
    }
  }
};

const isRail = (across: number): boolean => Math.abs(across) >= 0.5 && Math.abs(across) < 0.78;

const shapeField = (field: Field): void => {
  const { cell, cols, rows, x0, d0, step } = field;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const x = x0 + (col + 0.5) * cell;
      const d = d0 + (row + 0.5) * cell;
      if (!field.owns(x, d)) {
        field.height[index] = Number.NaN;
        continue;
      }
      const base = baseHeight(x, d);
      const edge = field.edge[index];
      if (edge <= 0) {
        const rail = field.kind[index] === RAIL && isRail(field.across[index]) ? 0.1 : 0;
        field.height[index] = Math.round(field.target[index] / LANE_STEP) * LANE_STEP + rail;
      } else {
        const height = edge < 1 ? field.target[index] + (base - field.target[index]) * smoothstep(0, 1, edge) : base;
        field.height[index] = Math.round(height / step) * step;
      }
    }
  }
};

const lawnColor = (x: number, d: number): number => {
  const tone = valueNoise3(x * 0.11, d * 0.11, 21);
  return tone > 0.6 ? S.grassLight : tone < 0.36 ? S.grassDark : S.grass;
};

const laneColor = (kind: number, across: number, along: number, half: number, speck: number): number => {
  const side = Math.abs(across);
  if (kind === SAND) return side > half - 0.25 || speck < 0.12 ? S.sandDark : S.sand;
  if (kind === ROAD) {
    if (side > half - 0.3) return S.kerb;
    if (side < 0.18 && along % 2.4 < 1.2) return S.dash;
    return speck < 0.3 ? S.asphaltDark : S.asphalt;
  }
  if (isRail(across)) return S.rail;
  return side < 0.95 && along % 0.8 < 0.3 ? S.sleeper : S.ballast;
};

const linear = new Map<number, Color>();
const toLinear = (hex: number): Color => {
  let color = linear.get(hex);
  if (!color) {
    color = new Color(hex);
    linear.set(hex, color);
  }
  return color;
};

const isWet = (height: number): boolean => height < WATER_LEVEL - 0.05;

const heightOf = ({ height, cols, rows }: Field, col: number, row: number): number => (col < 0 || row < 0 || col >= cols || row >= rows ? Number.NaN : height[row * cols + col]);

// The four ways to a neighbour, each with the corners of the wall towards it: across, ahead and whether at the top.
const WALLS: readonly { col: number; row: number; normal: readonly [number, number, number]; corners: readonly (readonly [number, number, number])[] }[] = [
  {
    col: 1,
    row: 0,
    normal: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1]
    ]
  },
  {
    col: -1,
    row: 0,
    normal: [-1, 0, 0],
    corners: [
      [0, 1, 0],
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1]
    ]
  },
  {
    col: 0,
    row: -1,
    normal: [0, 0, 1],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ]
  },
  {
    col: 0,
    row: 1,
    normal: [0, 0, -1],
    corners: [
      [1, 1, 0],
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1]
    ]
  }
];

const TOP: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1]
];

type Quads = { positions: number[]; normals: number[]; colors: number[] };

const toGeometry = ({ positions, normals, colors }: Quads): BufferGeometry => {
  const quads = positions.length / 12;
  const indices = new Uint32Array(quads * 6);
  for (let quad = 0; quad < quads; quad += 1) {
    indices.set([quad * 4, quad * 4 + 1, quad * 4 + 2, quad * 4, quad * 4 + 2, quad * 4 + 3], quad * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
};

const buildField = (field: Field): BufferGeometry => {
  const { cell, cols, rows, x0, d0 } = field;
  const quads: Quads = { positions: [], normals: [], colors: [] };
  const far = toLinear(S.hill);
  const color = new Color();

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const height = field.height[index];
      if (Number.isNaN(height)) continue;
      const x = x0 + col * cell;
      const d = d0 + row * cell;
      const kind = field.kind[index];
      const speck = hash3(col, row, 31);

      if (isWet(height)) color.copy(toLinear(S.riverDeep));
      else if (kind === GRASS || kind === RIVER) color.copy(toLinear(lawnColor(x, d))).lerp(far, smoothstep(55, 200, d));
      else color.copy(toLinear(laneColor(kind, field.across[index], field.along[index], field.half[index], speck)));
      color.multiplyScalar(1 + (hash3(col, row, 7) - 0.5) * JITTER);

      for (const [across, ahead] of TOP) {
        quads.positions.push(x + across * cell, height, -(d + ahead * cell));
        quads.normals.push(0, 1, 0);
        quads.colors.push(color.r, color.g, color.b);
      }

      for (const wall of WALLS) {
        const beside = heightOf(field, col + wall.col, row + wall.row);
        const foot = Number.isNaN(beside) ? height - SKIRT : beside;
        if (foot >= height) continue;
        for (const [across, ahead, top] of wall.corners) {
          quads.positions.push(x + across * cell, top === 1 ? height : foot, -(d + ahead * cell));
          quads.normals.push(...wall.normal);
          quads.colors.push(color.r * SIDE_SHADE, color.g * SIDE_SHADE, color.b * SIDE_SHADE);
        }
      }
    }
  }
  return toGeometry(quads);
};

type Water = { geometry: BufferGeometry; flow: (seconds: number) => void };

// One quad per wet cell. Bands of lighter and darker water run down the river.
const buildWater = (fields: readonly Field[]): Water => {
  const quads: Quads = { positions: [], normals: [], colors: [] };
  const cells: { along: number; across: number; seed: number }[] = [];

  for (const field of fields) {
    const { cell, cols, rows, x0, d0 } = field;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        if (!isWet(field.height[index])) continue;
        for (const [across, ahead] of TOP) {
          quads.positions.push(x0 + (col + across) * cell, WATER_LEVEL, -(d0 + (row + ahead) * cell));
          quads.normals.push(0, 1, 0);
          quads.colors.push(0, 0, 0);
        }
        cells.push({ along: field.along[index], across: field.across[index], seed: hash3(col, row, 3) });
      }
    }
  }

  const geometry = toGeometry(quads);
  const colors = geometry.getAttribute('color');
  const tones = [S.river, S.riverLight, S.riverDeep, S.foam].map(toLinear);

  return {
    geometry,
    flow: (seconds): void => {
      const beat = Math.floor(seconds * 3);
      cells.forEach(({ along, across, seed }, cellIndex) => {
        const wave = Math.sin((along - seconds * 1.1) * 2.3 + Math.sin(across * 2.6 + seed) * 0.9);
        const glint = hash3(cellIndex, beat, 5) < 0.012;
        const tone = tones[glint ? 3 : wave > 0.8 ? 1 : wave < -0.72 ? 2 : 0];
        for (let corner = 0; corner < 4; corner += 1) colors.setXYZ(cellIndex * 4 + corner, tone.r, tone.g, tone.b);
      });
      colors.needsUpdate = true;
    }
  };
};

export const createGround = (routes: Routes): Ground => {
  const lanes = createLanes(routes);
  const fields = FIELDS.map((spec) => {
    const field = createField(spec);
    if (spec.lanes) lanes.forEach((lane) => stampLane(field, lane));
    shapeField(field);
    return field;
  });

  const cellAt = (x: number, d: number): { field: Field; index: number } | null => {
    for (const field of fields) {
      const col = Math.floor((x - field.x0) / field.cell);
      const row = Math.floor((d - field.d0) / field.cell);
      if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) continue;
      const index = row * field.cols + col;
      if (!Number.isNaN(field.height[index])) return { field, index };
    }
    return null;
  };

  const heightAt = (x: number, d: number): number => {
    const found = cellAt(x, d);
    return found ? found.field.height[found.index] : Number.NEGATIVE_INFINITY;
  };

  const water = buildWater(fields);
  water.flow(0);

  return {
    geometries: fields.map(buildField),
    water: water.geometry,
    flow: water.flow,
    heightAt,
    seenAt: ([px, py]): Place => {
      const [x, y, d] = frameRay(px, py);
      let reach = 2;
      while (reach < 500 && CAMERA_HEIGHT + y * reach > heightAt(x * reach, d * reach)) reach += 0.02 + reach * 0.004;
      return { x: x * reach, y: heightAt(x * reach, d * reach), d: d * reach };
    },
    isLawn: (x, d): boolean => {
      const found = cellAt(x, d);
      return found !== null && found.field.kind[found.index] === GRASS && found.field.edge[found.index] > 0.3 && !isWet(found.field.height[found.index]);
    }
  };
};
