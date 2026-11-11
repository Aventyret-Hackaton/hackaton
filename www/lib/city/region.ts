import type { BufferGeometry } from 'three';

import { SHALLOW } from '@/lib/globe/earth';
import { hash3, valueNoise3 } from '@/lib/voxel/hash';

import { CITY_TINTS } from './stockholm';
import { CITY_DEPTH, CITY_WIDTH, createStockholmGround, PARK, WATER } from './stockholmMap';
import { buildCityGeometry, createCityVolume } from './volume';

const REGION_JITTER = 0.07;
// How far from the city its own shores still decide what is land and what is water.
const SHORE_REACH = 0.9;
// The town thins out over about this distance beyond the map, further in some directions than others.
const SUBURB_REACH = 0.7;
// Out here the land follows the globe exactly, so the two meet without a seam.
const WILD_END = 8;
const FOREST = [0x3e8440, 0x4c9446, 0x357538];

// Bare ground is rock or snow: the globe has it in broad slabs that would crowd the city.
export type GlobeSurface = { water: boolean; bare: boolean; palette: readonly number[] };

// The surface of the globe at a point: x is east and z south of the middle of the city, in world units.
export type SurfaceLookup = (x: number, z: number) => GlobeSurface;

// The land around Stockholm, which any number of ever coarser levels can be cut from.
export type Region = {
  // A square of count x count cells of the given world size, centred on the city.
  level: (count: number, cell: number) => BufferGeometry;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const smooth = (from: number, to: number, value: number): number => {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};

const pickFrom = (tints: readonly number[], pick: number): number => tints[Math.min(tints.length - 1, Math.floor(pick * tints.length))];

export const createRegion = (cityCell: number, lookup: SurfaceLookup): Region => {
  const ground = createStockholmGround();
  const halfWidth = (CITY_WIDTH / 2) * cityCell;
  const halfDepth = (CITY_DEPTH / 2) * cityCell;

  const cityKind = (x: number, z: number): number => {
    const column = clamp(Math.floor(x / cityCell + CITY_WIDTH / 2), 0, CITY_WIDTH - 1);
    const row = clamp(Math.floor(z / cityCell + CITY_DEPTH / 2), 0, CITY_DEPTH - 1);
    return ground[row * CITY_WIDTH + column];
  };

  // Colour and height of the ground: 0 for water, 1 for land and 2 for built-up land.
  const sample = (x: number, z: number): { color: number; height: number } => {
    const pick = hash3(Math.round(x * 512), Math.round(z * 512), 3);
    const chance = hash3(Math.round(x * 512), Math.round(z * 512), 4);
    const outside = Math.hypot(Math.max(0, Math.abs(x) - halfWidth), Math.max(0, Math.abs(z) - halfDepth));
    if (outside === 0) {
      const kind = cityKind(x, z);
      if (kind === WATER) return { color: pickFrom(CITY_TINTS.water, pick), height: 0 };
      if (kind === PARK) return { color: pickFrom(CITY_TINTS.grass, pick), height: 1 };
      return { color: pickFrom(CITY_TINTS.urban, pick), height: chance < 0.5 ? 2 : 1 };
    }

    // Near the city the coast of the globe is bent out of its straight lines, and there are lakes.
    const wild = 1 - smooth(WILD_END / 2, WILD_END, Math.hypot(x, z));
    const bendX = (valueNoise3(x * 1.6, 5, z * 1.6) - 0.5) * 0.5 + (valueNoise3(x * 7, 9, z * 7) - 0.5) * 0.12;
    const bendZ = (valueNoise3(x * 1.6, 15, z * 1.6) - 0.5) * 0.5 + (valueNoise3(x * 7, 19, z * 7) - 0.5) * 0.12;
    const far = lookup(x + bendX * wild, z + bendZ * wild);
    const lake = valueNoise3(x * 2.3, 7, z * 2.3) * wild > 0.8;
    // Close to the map its shores carry on outwards; further off the globe decides.
    const shore = cityKind(clamp(x, -halfWidth, halfWidth), clamp(z, -halfDepth, halfDepth)) === WATER;
    const handover = smooth(0, SHORE_REACH, outside) + (valueNoise3(x * 4, 2, z * 4) - 0.5) * 0.6;
    const water = handover < 0.5 ? shore : far.water || lake;

    if (water) {
      const tints = outside < SHORE_REACH ? CITY_TINTS.water : far.water ? far.palette : SHALLOW;
      return { color: pickFrom(tints, pick), height: 0 };
    }
    const sprawl = SUBURB_REACH * (0.4 + 1.2 * valueNoise3(x * 1.5, 11, z * 1.5));
    const suburb = chance < 0.9 * (1 - smooth(0, sprawl, outside));
    const wooded = far.water || (far.bare && chance < wild);
    return { color: pickFrom(suburb ? CITY_TINTS.urban : wooded ? FOREST : far.palette, pick), height: 1 };
  };

  return {
    level: (count, cell): BufferGeometry => {
      const volume = createCityVolume(count, 3, count);
      const palette: number[] = [];
      for (let row = 0; row < count; row += 1) {
        for (let column = 0; column < count; column += 1) {
          const { color, height } = sample((column + 0.5 - count / 2) * cell, (row + 0.5 - count / 2) * cell);
          if (!palette.includes(color)) palette.push(color);
          volume.fill(column, column, 0, height, row, row, palette.indexOf(color) + 1);
        }
      }
      return buildCityGeometry(volume, palette, REGION_JITTER);
    }
  };
};
