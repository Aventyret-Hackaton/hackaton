import { BufferAttribute, BufferGeometry, Color, Sphere, Vector3 } from 'three';

import type { VoxelCell } from '@/lib/voxel/grid';
import { hash3, valueNoise3 } from '@/lib/voxel/hash';
import { buildVoxelGeometry, VOXEL_FACES } from '@/lib/voxel/mesher';

import { DEG } from './geo';
import { LAND_MASK_BASE64, LAND_MASK_HEIGHT, LAND_MASK_WIDTH } from './landMask';

export const GLOBE_RADIUS = 30;

const GLOBE_JITTER = 0.07;
// How far above the land the route and the vehicles hover.
const ROUTE_HOVER = 1.1;

type LevelSpec = {
  // Edge of one voxel in world units.
  voxelSize: number;
  // Heights in voxels above sea level.
  land: number;
  hills: number;
  mountain: number;
  beaches: boolean;
};

export const DEFAULT_EARTH_LEVEL = 2;

// Each level has voxels this many times smaller than the one before.
const LEVEL_RATIO = 1.32;

const voxelSizeOf = (index: number): number => LEVEL_RATIO ** (DEFAULT_EARTH_LEVEL - index);

// From far to near. Six levels give five zoom steps, one per key press.
const LEVEL_SPECS: readonly LevelSpec[] = [
  { voxelSize: voxelSizeOf(0), land: 1, hills: 0, mountain: 1, beaches: false },
  { voxelSize: voxelSizeOf(1), land: 1, hills: 0, mountain: 2, beaches: false },
  { voxelSize: voxelSizeOf(2), land: 1, hills: 0, mountain: 2, beaches: false },
  { voxelSize: voxelSizeOf(3), land: 1, hills: 1, mountain: 3, beaches: true },
  { voxelSize: voxelSizeOf(4), land: 2, hills: 1, mountain: 4, beaches: true },
  { voxelSize: voxelSizeOf(5), land: 2, hills: 2, mountain: 5, beaches: true }
];

export const EARTH_LEVEL_COUNT = LEVEL_SPECS.length;

type Region = readonly [latMin: number, latMax: number, lonMin: number, lonMax: number];

const DESERTS: readonly Region[] = [
  [15, 32, -17, 34],
  [14, 32, 35, 59],
  [24, 34, 52, 72],
  [37, 46, 54, 68],
  [36, 46, 78, 110],
  [-31, -19, 116, 142],
  [-28, -18, 13, 24],
  [24, 36, -116, -103],
  [-28, -16, -72, -68]
];

const MOUNTAINS: readonly Region[] = [
  [27, 37, 73, 100],
  [-50, 8, -79, -67],
  [34, 58, -124, -108],
  [44, 48, 6, 15],
  [61, 69, 7, 16],
  [5, 14, 36, 42]
];

const GREENLAND: readonly Region[] = [[60, 84, -56, -18]];

const PALETTES = {
  ocean: [0x1b4697, 0x1f4fa8, 0x2459b8, 0x1f4fa8],
  shallow: [0x2f6ccb, 0x3a78d4],
  ice: [0xf1eee4, 0xdde3f0, 0xf7f4ec],
  rock: [0x8a8f8c, 0x7d8a9a],
  snow: [0xf1eee4],
  sand: [0xe8a84a, 0xf0bc5e, 0xdb9438],
  tundra: [0x8fa56a, 0x7c9460, 0x9bae78],
  boreal: [0x3e8440, 0x4c9446, 0x357538],
  jungle: [0x3c9a3c, 0x48a83e, 0x2f8a36],
  grass: [0x6db33f, 0x5fa83c, 0x7cbb45, 0x8fbe4a],
  beach: [0xe9d9a0, 0xf0e2b0]
} as const;

type PaletteName = keyof typeof PALETTES;

export const SHALLOW = PALETTES.shallow;

// Beaches only exist on the near detail levels, never in the surface lookup.
export type SurfaceKind = Exclude<PaletteName, 'beach'>;

export type Surface = { kind: SurfaceKind; elevation: number; palette: readonly number[] };

const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[];

// Vertex colours are stored in linear space, one byte per channel.
const LINEAR_PALETTES: readonly (readonly Triple[])[] = PALETTE_NAMES.map((name) =>
  PALETTES[name].map((hex) => {
    const color = new Color(hex);
    return [color.r, color.g, color.b] as const;
  })
);

type Triple = readonly [number, number, number];

// One byte per cell: elevation in the low three bits, palette above them.
const ELEVATION_MASK = 7;
const PALETTE_SHIFT = 3;
const UNSET = 255;

const surfaceCode = (elevation: number, palette: PaletteName): number => elevation | (PALETTE_NAMES.indexOf(palette) << PALETTE_SHIFT);

export type EarthLevel = {
  index: number;
  geometry: BufferGeometry;
  voxelSize: number;
  // Radius, in world units, at which the route and vehicles travel on this level.
  routeRadius: number;
  // World radius of the surface in the given direction.
  surfaceRadius: (unit: Vector3) => number;
};

export type EarthLevelBuilder = {
  // Works for about the given time and returns the level once it is complete.
  step: (budgetMs: number) => EarthLevel | null;
};

const inRegions = (regions: readonly Region[], latitude: number, longitude: number): boolean =>
  regions.some(([latMin, latMax, lonMin, lonMax]) => latitude >= latMin && latitude <= latMax && longitude >= lonMin && longitude <= lonMax);

type LandLookup = (latitude: number, longitude: number) => boolean;

let landLookup: LandLookup | null = null;

const getLandLookup = (): LandLookup => {
  if (landLookup) return landLookup;
  const mask = Uint8Array.from(atob(LAND_MASK_BASE64), (character) => character.charCodeAt(0));
  landLookup = (latitude, longitude): boolean => {
    const row = Math.min(LAND_MASK_HEIGHT - 1, Math.max(0, Math.floor(90 - latitude)));
    const column = ((Math.floor(longitude + 180) % LAND_MASK_WIDTH) + LAND_MASK_WIDTH) % LAND_MASK_WIDTH;
    const index = row * LAND_MASK_WIDTH + column;
    return ((mask[index >> 3] >> (index & 7)) & 1) === 1;
  };
  return landLookup;
};

// Elevation and palette of the surface under a unit vector, packed into one byte.
const classifySurface = (spec: LevelSpec, isLand: LandLookup, ux: number, uy: number, uz: number): number => {
  const latitude = Math.asin(uy) / DEG;
  const longitude = Math.atan2(ux, uz) / DEG;
  const patch = valueNoise3(ux * 8, uy * 8, uz * 8);
  const grain = valueNoise3(ux * 26 + 9, uy * 26, uz * 26);
  const nudgedLat = latitude + (patch - 0.5) * 7;
  const nudgedLon = longitude + (grain - 0.5) * 7;

  if (!isLand(latitude, longitude)) {
    if (latitude > 77 + patch * 6) return surfaceCode(latitude > 84 ? 1 : 0, 'ice');
    const coastal = isLand(latitude + 2, longitude) || isLand(latitude - 2, longitude) || isLand(latitude, longitude + 2.5) || isLand(latitude, longitude - 2.5);
    return surfaceCode(0, coastal ? 'shallow' : 'ocean');
  }

  // Only the near levels have room for rolling ground, peaks and beaches.
  const peak = spec.hills > 0 ? 1 : 0;
  const rolling = spec.hills > 0 ? valueNoise3(ux * 17 + 4, uy * 17, uz * 17) : 0;
  const hill = rolling > 0.7 ? spec.hills : rolling > 0.58 ? 1 : 0;
  const ground = spec.land + hill;
  if (latitude > 72 || latitude < -60 || inRegions(GREENLAND, latitude, longitude)) return surfaceCode(ground, 'ice');
  if (inRegions(MOUNTAINS, nudgedLat, nudgedLon) && grain > 0.45) {
    return grain > 0.68 ? surfaceCode(spec.mountain + peak, 'snow') : surfaceCode(spec.mountain, 'rock');
  }
  if (spec.beaches && Math.abs(latitude) < 48 && patch > 0.4) {
    const shore = !isLand(latitude + 1.1, longitude) || !isLand(latitude - 1.1, longitude) || !isLand(latitude, longitude + 1.3) || !isLand(latitude, longitude - 1.3);
    if (shore) return surfaceCode(spec.land, 'beach');
  }
  if (inRegions(DESERTS, nudgedLat, nudgedLon)) return surfaceCode(ground, 'sand');
  if (latitude > 62 || latitude < -46) return surfaceCode(ground, 'tundra');
  if (latitude > 50) return surfaceCode(ground, 'boreal');
  if (Math.abs(latitude) < 10) return surfaceCode(ground, 'jungle');
  return surfaceCode(ground, 'grass');
};

// The surface as the starting detail level sees it.
export const createSurfaceLookup = (): ((ux: number, uy: number, uz: number) => Surface) => {
  const isLand = getLandLookup();
  const spec = LEVEL_SPECS[DEFAULT_EARTH_LEVEL];
  return (ux, uy, uz): Surface => {
    const code = classifySurface(spec, isLand, ux, uy, uz);
    const kind = PALETTE_NAMES[code >> PALETTE_SHIFT] as SurfaceKind;
    return { kind, elevation: code & ELEVATION_MASK, palette: PALETTES[kind] };
  };
};

type Numeric = Int16Array | Int8Array | Uint8Array | Uint32Array;

const grown = <T extends Numeric>(data: T, needed: number, create: (size: number) => T): T => {
  if (needed <= data.length) return data;
  const next = create(Math.max(needed, data.length * 2));
  next.set(data);
  return next;
};

// Builds one detail level a slab at a time, so it can be spread over many frames.
export const createEarthLevelBuilder = (index: number): EarthLevelBuilder => {
  const spec = LEVEL_SPECS[index];
  const isLand = getLandLookup();
  const radius = GLOBE_RADIUS / spec.voxelSize;
  const peak = spec.hills > 0 ? 1 : 0;
  const maxElevation = Math.max(spec.mountain + peak, spec.land + spec.hills);
  const radiusSquared = radius * radius;
  const outerSquared = (radius + maxElevation) ** 2;
  const buriedSquared = Math.max(0, radius - 1.01) ** 2;
  const reach = Math.ceil(radius + maxElevation) + 1;
  const size = reach * 2 + 1;
  const codes = new Uint8Array(size * size * size).fill(UNSET);

  const classify = (ux: number, uy: number, uz: number): number => classifySurface(spec, isLand, ux, uy, uz);

  const codeAt = (x: number, y: number, z: number): number => {
    const cell = ((x + reach) * size + (y + reach)) * size + (z + reach);
    if (codes[cell] === UNSET) {
      const distance = Math.hypot(x, y, z) || 1;
      codes[cell] = classify(x / distance, y / distance, z / distance);
    }
    return codes[cell];
  };

  const isSolid = (x: number, y: number, z: number): boolean => {
    const squared = x * x + y * y + z * z;
    if (squared <= radiusSquared) return true;
    if (squared > outerSquared) return false;
    return Math.sqrt(squared) <= radius + (codeAt(x, y, z) & ELEVATION_MASK);
  };

  let positions = new Int16Array(60000);
  let normals = new Int8Array(60000);
  let colors = new Uint8Array(60000);
  let indices = new Uint32Array(30000);
  let vertexCount = 0;
  let indexCount = 0;

  const emitVoxel = (x: number, y: number, z: number): void => {
    if (!isSolid(x, y, z)) return;
    let shaded: Triple | null = null;
    for (const face of VOXEL_FACES) {
      const [nx, ny, nz] = face.normal;
      if (isSolid(x + nx, y + ny, z + nz)) continue;
      if (!shaded) {
        const palette = LINEAR_PALETTES[codeAt(x, y, z) >> PALETTE_SHIFT];
        const noise = hash3(x, y, z);
        const [r, g, b] = palette[Math.floor(noise * palette.length)];
        const shade = (1 + (noise - 0.5) * GLOBE_JITTER) * 255;
        shaded = [Math.min(255, r * shade), Math.min(255, g * shade), Math.min(255, b * shade)];
      }
      positions = grown(positions, (vertexCount + 4) * 3, (length) => new Int16Array(length));
      normals = grown(normals, (vertexCount + 4) * 3, (length) => new Int8Array(length));
      colors = grown(colors, (vertexCount + 4) * 3, (length) => new Uint8Array(length));
      indices = grown(indices, indexCount + 6, (length) => new Uint32Array(length));
      for (const [cx, cy, cz] of face.corners) {
        const at = vertexCount * 3;
        positions.set([x + cx, y + cy, z + cz], at);
        normals.set([nx * 127, ny * 127, nz * 127], at);
        colors.set(shaded, at);
        vertexCount += 1;
      }
      const base = vertexCount - 4;
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], indexCount);
      indexCount += 6;
    }
  };

  // Only the shell between the buried core and the highest peak can show.
  const emitSlab = (x: number): void => {
    for (let y = -reach; y <= reach; y += 1) {
      const planar = x * x + y * y;
      if (planar > outerSquared) continue;
      const top = Math.floor(Math.sqrt(outerSquared - planar));
      const bottom = planar < buriedSquared ? Math.floor(Math.sqrt(buriedSquared - planar)) : 0;
      for (let z = bottom; z <= top; z += 1) {
        emitVoxel(x, y, z);
        if (z !== 0) emitVoxel(x, y, -z);
      }
    }
  };

  // Marches inwards along the ray until it hits the first solid voxel.
  const surfaceRadius = (unit: Vector3): number => {
    for (let distance = radius + maxElevation + 1.5; distance > radius - 2; distance -= 0.1) {
      if (isSolid(Math.round(unit.x * distance), Math.round(unit.y * distance), Math.round(unit.z * distance))) {
        return distance * spec.voxelSize;
      }
    }
    return GLOBE_RADIUS;
  };

  const finish = (): EarthLevel => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions.slice(0, vertexCount * 3), 3));
    geometry.setAttribute('normal', new BufferAttribute(normals.slice(0, vertexCount * 3), 3, true));
    geometry.setAttribute('color', new BufferAttribute(colors.slice(0, vertexCount * 3), 3, true));
    geometry.setIndex(new BufferAttribute(indices.slice(0, indexCount), 1));
    geometry.boundingSphere = new Sphere(new Vector3(0.5, 0.5, 0.5), radius + maxElevation + 2);
    return {
      index,
      geometry,
      voxelSize: spec.voxelSize,
      routeRadius: GLOBE_RADIUS + spec.voxelSize * (spec.land + spec.hills + 0.5) + ROUTE_HOVER,
      surfaceRadius
    };
  };

  let slab = -reach;
  let level: EarthLevel | null = null;

  return {
    step: (budgetMs): EarthLevel | null => {
      if (level) return level;
      const deadline = performance.now() + budgetMs;
      while (slab <= reach) {
        emitSlab(slab);
        slab += 1;
        if (performance.now() >= deadline) break;
      }
      if (slab > reach) level = finish();
      return level;
    }
  };
};

const collectShell = (radius: number, margin: number, isSolid: (x: number, y: number, z: number) => boolean, colorOf: (x: number, y: number, z: number) => number): VoxelCell[] => {
  const cells: VoxelCell[] = [];
  const reach = radius + margin;
  for (let x = -reach; x <= reach; x += 1) {
    for (let y = -reach; y <= reach; y += 1) {
      for (let z = -reach; z <= reach; z += 1) {
        if (!isSolid(x, y, z)) continue;
        const buried = isSolid(x + 1, y, z) && isSolid(x - 1, y, z) && isSolid(x, y + 1, z) && isSolid(x, y - 1, z) && isSolid(x, y, z + 1) && isSolid(x, y, z - 1);
        if (!buried) cells.push({ x, y, z, color: colorOf(x, y, z) });
      }
    }
  }
  return cells;
};

export const MOON_RADIUS = 5;
const MOON_COLORS = [0xe8d9b5, 0xd8c8a4, 0xf0e3c2] as const;
const MOON_CRATER = 0x9b8f86;

export const createMoonGeometry = (): BufferGeometry => {
  const isSolid = (x: number, y: number, z: number): boolean => x * x + y * y + z * z <= MOON_RADIUS * MOON_RADIUS;
  const colorOf = (x: number, y: number, z: number): number =>
    valueNoise3(x * 0.45 + 3, y * 0.45, z * 0.45) > 0.62 ? MOON_CRATER : MOON_COLORS[Math.floor(hash3(x, y, z) * MOON_COLORS.length)];
  const cells = collectShell(MOON_RADIUS, 1, isSolid, colorOf);
  const geometry = buildVoxelGeometry(cells, isSolid, GLOBE_JITTER);
  geometry.translate(-0.5, -0.5, -0.5);
  return geometry;
};
