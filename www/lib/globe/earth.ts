import type { BufferGeometry, Vector3 } from 'three';

import type { VoxelCell } from '@/lib/voxel/grid';
import { hash3, valueNoise3 } from '@/lib/voxel/hash';
import { buildVoxelGeometry } from '@/lib/voxel/mesher';

import { DEG } from './geo';
import { LAND_MASK_BASE64, LAND_MASK_HEIGHT, LAND_MASK_WIDTH } from './landMask';

export const GLOBE_RADIUS = 30;

const MAX_ELEVATION = 2;
const GLOBE_JITTER = 0.07;

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

const OCEAN = [0x1b4697, 0x1f4fa8, 0x2459b8, 0x1f4fa8] as const;
const SHALLOW = [0x2f6ccb, 0x3a78d4] as const;
const ICE = [0xf1eee4, 0xdde3f0, 0xf7f4ec] as const;
const ROCK = [0x8a8f8c, 0x7d8a9a] as const;
const SNOW = [0xf1eee4] as const;
const SAND = [0xe8a84a, 0xf0bc5e, 0xdb9438] as const;
const TUNDRA = [0x8fa56a, 0x7c9460, 0x9bae78] as const;
const BOREAL = [0x3e8440, 0x4c9446, 0x357538] as const;
const JUNGLE = [0x3c9a3c, 0x48a83e, 0x2f8a36] as const;
const GRASS = [0x6db33f, 0x5fa83c, 0x7cbb45, 0x8fbe4a] as const;

type Surface = { elevation: number; palette: readonly number[] };

export type Earth = {
  geometry: BufferGeometry;
  surfaceRadius: (unit: Vector3) => number;
};

const inRegions = (regions: readonly Region[], latitude: number, longitude: number): boolean =>
  regions.some(([latMin, latMax, lonMin, lonMax]) => latitude >= latMin && latitude <= latMax && longitude >= lonMin && longitude <= lonMax);

const createLandLookup = (): ((lat: number, lon: number) => boolean) => {
  const mask = Uint8Array.from(atob(LAND_MASK_BASE64), (character) => character.charCodeAt(0));
  return (latitude, longitude): boolean => {
    const row = Math.min(LAND_MASK_HEIGHT - 1, Math.max(0, Math.floor(90 - latitude)));
    const column = ((Math.floor(longitude + 180) % LAND_MASK_WIDTH) + LAND_MASK_WIDTH) % LAND_MASK_WIDTH;
    const index = row * LAND_MASK_WIDTH + column;
    return ((mask[index >> 3] >> (index & 7)) & 1) === 1;
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

export const createEarth = (): Earth => {
  const isLand = createLandLookup();

  const classify = (ux: number, uy: number, uz: number): Surface => {
    const latitude = Math.asin(uy) / DEG;
    const longitude = Math.atan2(ux, uz) / DEG;
    const patch = valueNoise3(ux * 8, uy * 8, uz * 8);
    const grain = valueNoise3(ux * 26 + 9, uy * 26, uz * 26);
    const nudgedLat = latitude + (patch - 0.5) * 7;
    const nudgedLon = longitude + (grain - 0.5) * 7;

    if (!isLand(latitude, longitude)) {
      if (latitude > 77 + patch * 6) {
        return { elevation: latitude > 84 ? 1 : 0, palette: ICE };
      }
      const coastal = isLand(latitude + 2, longitude) || isLand(latitude - 2, longitude) || isLand(latitude, longitude + 2.5) || isLand(latitude, longitude - 2.5);
      return { elevation: 0, palette: coastal ? SHALLOW : OCEAN };
    }
    if (latitude > 72 || latitude < -60 || inRegions(GREENLAND, latitude, longitude)) {
      return { elevation: 1, palette: ICE };
    }
    if (inRegions(MOUNTAINS, nudgedLat, nudgedLon) && grain > 0.45) {
      return { elevation: 2, palette: grain > 0.68 ? SNOW : ROCK };
    }
    if (inRegions(DESERTS, nudgedLat, nudgedLon)) {
      return { elevation: 1, palette: SAND };
    }
    if (latitude > 62 || latitude < -46) return { elevation: 1, palette: TUNDRA };
    if (latitude > 50) return { elevation: 1, palette: BOREAL };
    if (Math.abs(latitude) < 10) return { elevation: 1, palette: JUNGLE };
    return { elevation: 1, palette: GRASS };
  };

  const isSolid = (x: number, y: number, z: number): boolean => {
    const squared = x * x + y * y + z * z;
    if (squared <= GLOBE_RADIUS * GLOBE_RADIUS) return true;
    if (squared > (GLOBE_RADIUS + MAX_ELEVATION) ** 2) return false;
    const distance = Math.sqrt(squared);
    const surface = classify(x / distance, y / distance, z / distance);
    return distance <= GLOBE_RADIUS + surface.elevation;
  };

  const colorOf = (x: number, y: number, z: number): number => {
    const distance = Math.hypot(x, y, z) || 1;
    const { palette } = classify(x / distance, y / distance, z / distance);
    return palette[Math.floor(hash3(x, y, z) * palette.length)];
  };

  const cells = collectShell(GLOBE_RADIUS, MAX_ELEVATION + 1, isSolid, colorOf);
  const geometry = buildVoxelGeometry(cells, isSolid, GLOBE_JITTER);
  geometry.translate(-0.5, -0.5, -0.5);

  // Marches inwards along the ray until it hits the first solid voxel.
  const surfaceRadius = (unit: Vector3): number => {
    const start = GLOBE_RADIUS + MAX_ELEVATION + 1.5;
    for (let radius = start; radius > GLOBE_RADIUS - 2; radius -= 0.1) {
      const solid = isSolid(Math.round(unit.x * radius), Math.round(unit.y * radius), Math.round(unit.z * radius));
      if (solid) return radius;
    }
    return GLOBE_RADIUS;
  };

  return { geometry, surfaceRadius };
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
