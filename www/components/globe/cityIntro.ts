import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  type IUniform,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Vector2,
  Vector3,
  Vector4
} from 'three';

import { createRegion, type SurfaceLookup } from '@/lib/city/region';
import { buildStockholm, CITY_GROUND } from '@/lib/city/stockholm';
import { type Cell, cellOf, CITY_DEPTH, CITY_WIDTH } from '@/lib/city/stockholmMap';
import { DEG, type LatLon } from '@/lib/globe/geo';

import { DITHER_GLSL, REGION_GLSL, REGION_RIM } from './dither';

// World size of one cell of the city map.
const CITY_CELL = 0.007;
// The land around the city at falling detail: cells per side, and the world size of a cell.
const SURROUNDINGS = [
  { count: 150, cell: 0.02 },
  { count: 130, cell: 0.058 },
  { count: 96, cell: 0.17 }
] as const;
// Shares of the pull-back during which the city, and then each level around it, gives way to the next.
const STAGES = [
  [0.03, 0.3],
  [0.3, 0.5],
  [0.5, 0.68],
  [0.68, 0.86]
] as const;

// Room around the two flags in the opening shot, in cells. A flag and its name need the most to the north.
const MARGIN_SIDE = 26;
const MARGIN_NORTH = 36;
const MARGIN_SOUTH = 12;
// The camera never comes closer than this many cells.
const MIN_DISTANCE = 100;
// Addresses far apart may push the view this far past what the map can fill.
const OVERSHOOT = 1.7;

const DASH_SPACING = 3.6;
const ARROW_EVERY = 5;
const ROUTE_LIFT = 0.9;
const FLAG_CLEARANCE = 3.5;

const VERTEX_PARS = /* glsl */ `
uniform float uRegionCell;
uniform float uRegionCurve;
varying vec2 vRegion;
`;

// The ground follows the curve of the globe.
const VERTEX_MAIN = /* glsl */ `
#ifdef USE_INSTANCING
  vRegion = (instanceMatrix * vec4(transformed, 1.0)).xz * uRegionCell;
#else
  vRegion = transformed.xz * uRegionCell;
  transformed.y -= uRegionCurve * dot(transformed.xz, transformed.xz);
#endif
`;

const FRAGMENT_PARS = /* glsl */ `
uniform vec2 uRegionAnchor;
uniform vec4 uRegionReach;
uniform float uRegionFront;
uniform vec4 uRegionInnerReach;
uniform float uRegionInnerFront;
varying vec2 vRegion;
${DITHER_GLSL}
${REGION_GLSL}
`;

// A level is drawn inside its own front and outside the front of the finer level within it,
// so every pixel belongs to exactly one of them.
const FRAGMENT_DISCARD = /* glsl */ `
{
  vec2 regionOffset = vRegion - uRegionAnchor;
  float regionRim = ${REGION_RIM.toFixed(2)} * ditherBayer(gl_FragCoord.xy);
  if (regionShare(regionOffset, uRegionReach) > uRegionFront - regionRim) discard;
  if (regionShare(regionOffset, uRegionInnerReach) <= uRegionInnerFront - regionRim) discard;
}
`;

export type CityIntroOptions = {
  origin: LatLon;
  destination: LatLon;
  // Compass bearing of the way out of town, and where the way back in turns towards the goal.
  exitBearing: number;
  entry: LatLon;
  routeColor: number;
  arrowGeometry: BufferGeometry;
  // How the opening shot looks down on the city, both in radians.
  elevation: number;
  halfFov: number;
  // World radius of the water in the city, and what the globe has around it.
  radius: number;
  surface: SurfaceLookup;
};

export type CityFraming = {
  // What the camera looks at, in the coordinates of the group, and from how far.
  target: Vector3;
  distance: number;
};

// The part of the globe that the city and its surroundings take over.
export type CityFootprint = {
  anchor: IUniform<Vector2>;
  reach: IUniform<Vector4>;
  front: IUniform<number>;
};

export type CityIntro = {
  // In world units: x east, y up from the water and z south, centred on the middle of the map.
  group: Group;
  origin: Vector3;
  destination: Vector3;
  footprint: CityFootprint;
  // A place on the map, at street level.
  locate: (position: LatLon) => Vector3;
  frame: (aspect: number) => CityFraming;
  // Generates one more level of the land around the city, if any is still missing.
  build: () => void;
  // How far the pull-back has come, from 0 to 1.
  setProgress: (progress: number) => void;
  dispose: () => void;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// Like clamp, but a range that has turned inside out gives its middle.
const within = (value: number, low: number, high: number): number => (low > high ? (low + high) / 2 : clamp(value, low, high));

type Dash = { x: number; z: number; fx: number; fz: number };

// Evenly spaced points along the path, each with the direction of travel.
const walk = (path: readonly Cell[], from: number, trim: number): Dash[] => {
  const lengths = path.slice(1).map(([x, z], index) => Math.hypot(x - path[index][0], z - path[index][1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const dashes: Dash[] = [];
  let travelled = 0;
  let next = from;
  lengths.forEach((length, index) => {
    const [ax, az] = path[index];
    const fx = (path[index + 1][0] - ax) / length;
    const fz = (path[index + 1][1] - az) / length;
    for (; next < travelled + length && next < total - trim; next += DASH_SPACING) {
      const x = ax + fx * (next - travelled);
      const z = az + fz * (next - travelled);
      if (x > 0 && x < CITY_WIDTH && z > 0 && z < CITY_DEPTH) dashes.push({ x, z, fx, fz });
    }
    travelled += length;
  });
  return dashes;
};

export const createCityIntro = ({ origin, destination, exitBearing, entry, routeColor, arrowGeometry, elevation, halfFov, radius, surface }: CityIntroOptions): CityIntro => {
  const place = (position: LatLon): Cell => {
    const [x, z] = cellOf(position);
    return [clamp(x, MARGIN_SIDE, CITY_WIDTH - MARGIN_SIDE), clamp(z, MARGIN_NORTH, CITY_DEPTH - MARGIN_SOUTH)];
  };
  const start = place(origin);
  const goal = place(destination);
  // Layer 1 of the map is the water, which lies at height zero and bends with the globe.
  const local = ([x, z]: Cell, layer: number): Vector3 => {
    const east = (x - CITY_WIDTH / 2) * CITY_CELL;
    const south = (z - CITY_DEPTH / 2) * CITY_CELL;
    return new Vector3(east, (layer - 1) * CITY_CELL - (east * east + south * south) / (2 * radius), south);
  };

  // The city first, then its surroundings from fine to coarse.
  const halves = [[(CITY_WIDTH / 2) * CITY_CELL, (CITY_DEPTH / 2) * CITY_CELL], ...SURROUNDINGS.map(({ count, cell }) => [(count / 2) * cell, (count / 2) * cell])];
  const anchor = { value: new Vector2() };
  const reaches = halves.map(() => ({ value: new Vector4(1, 1, 1, 1) }));
  const fronts = halves.map(() => ({ value: 1 }));
  // What every level has to stay out of: the reach and front of the finer level inside it.
  const innerReaches = halves.map(() => ({ value: new Vector4(1, 1, 1, 1) }));
  const innerFronts = halves.map(() => ({ value: 0 }));
  const materials: Material[] = [];
  const geometries: BufferGeometry[] = [];

  const dissolving = <T extends Material>(material: T, level: number, cell: number): T => {
    material.onBeforeCompile = (shader): void => {
      Object.assign(shader.uniforms, {
        uRegionAnchor: anchor,
        uRegionCell: { value: cell },
        uRegionCurve: { value: cell / (2 * radius) },
        uRegionReach: reaches[level],
        uRegionFront: fronts[level],
        uRegionInnerReach: innerReaches[level],
        uRegionInnerFront: innerFronts[level]
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAGMENT_DISCARD}`);
    };
    materials.push(material);
    return material;
  };

  // Every level has its water at height zero, whatever the size of its cells.
  const laidOut = <T extends Object3D>(object: T, cell: number): T => {
    object.scale.setScalar(cell);
    object.position.y = -cell;
    return object;
  };

  const group = new Group();
  group.matrixAutoUpdate = false;
  const cityGroup = laidOut(new Group(), CITY_CELL);
  group.add(cityGroup);

  const cityGeometry = buildStockholm([
    { cell: start, color: 'mint' },
    { cell: goal, color: 'pink' }
  ]);
  geometries.push(cityGeometry);
  // The light is baked into the colours, here and in the land around.
  const city = new Mesh(cityGeometry, dissolving(new MeshBasicMaterial({ vertexColors: true }), 0, CITY_CELL));
  city.frustumCulled = false;
  cityGroup.add(city);

  const region = createRegion(CITY_CELL, surface);
  const levels: (Object3D | null)[] = [cityGroup, ...SURROUNDINGS.map(() => null)];
  const buildLevel = (index: number): void => {
    const { count, cell } = SURROUNDINGS[index];
    const geometry = region.level(count, cell);
    geometries.push(geometry);
    const mesh = laidOut(new Mesh(geometry, dissolving(new MeshBasicMaterial({ vertexColors: true }), index + 1, cell)), cell);
    mesh.frustumCulled = false;
    group.add(mesh);
    levels[index + 1] = mesh;
  };
  // The coarsest level covers everything and is quick to make; the finer ones can wait a frame each.
  const pending = SURROUNDINGS.map((_, index) => index);
  buildLevel(pending.pop() ?? 0);

  // A level that has not been generated yet leaves its pixels to the coarser one around it,
  // which then stays out of the nearest finer level that does exist.
  let progress = 0;
  const applyProgress = (): void => {
    let finer = 0;
    STAGES.forEach(([from, to], level) => {
      const object = levels[level];
      fronts[level].value = object ? 1 - clamp((progress - from) / (to - from), 0, 1) : 0;
      if (!object) return;
      object.visible = fronts[level].value > 0;
      if (level > 0) {
        innerReaches[level].value.copy(reaches[finer].value);
        innerFronts[level].value = fronts[finer].value;
      }
      finer = level;
    });
  };

  // The way out heads for the exit and leaves the map; the way in comes up from the south.
  const heading = exitBearing * DEG;
  const [dx, dz] = [Math.sin(heading), -Math.cos(heading)];
  const along = (distance: number, sideways: number): Cell => [start[0] + dx * distance - dz * sideways, start[1] + dz * distance + dx * sideways];
  const turn = cellOf(entry);
  const dashes = [
    ...walk([start, along(12, 3), along(32, -2), along(420, 0)], FLAG_CLEARANCE, 0),
    ...walk([[turn[0] + 12, CITY_DEPTH + 20], [turn[0] + 9, turn[1] + 14], turn, goal], 0, FLAG_CLEARANCE)
  ];

  // Drawn on top of the houses, like a line on a map.
  const routeMaterial = dissolving(new MeshBasicMaterial({ toneMapped: false, depthTest: false }), 0, CITY_CELL);
  const dashGeometry = new BoxGeometry(2.2, 0.8, 0.9);
  geometries.push(dashGeometry);
  const matrix = new Matrix4();
  const tint = new Color(routeColor);
  const markers = (geometry: BufferGeometry, picked: readonly Dash[], scale: number): void => {
    const mesh = new InstancedMesh(geometry, routeMaterial, picked.length);
    picked.forEach(({ x, z, fx, fz }, index) => {
      matrix.set(fx * scale, 0, -fz * scale, x - CITY_WIDTH / 2, 0, scale, 0, CITY_GROUND + ROUTE_LIFT, fz * scale, 0, fx * scale, z - CITY_DEPTH / 2, 0, 0, 0, 1);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, tint);
    });
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    cityGroup.add(mesh);
  };
  markers(
    dashGeometry,
    dashes.filter((_, index) => index % ARROW_EVERY !== ARROW_EVERY - 1),
    1
  );
  markers(
    arrowGeometry,
    dashes.filter((_, index) => index % ARROW_EVERY === ARROW_EVERY - 1),
    1.5
  );

  const frame = (aspect: number): CityFraming => {
    // Per cell of camera distance: how far the view reaches over the ground.
    const north = Math.sin(elevation) / Math.tan(elevation - halfFov) - Math.cos(elevation);
    const south = Math.cos(elevation) - Math.sin(elevation) / Math.tan(elevation + halfFov);
    const nearHalf = (Math.tan(halfFov) * aspect * Math.sin(elevation)) / Math.sin(elevation + halfFov);
    const farHalf = (Math.tan(halfFov) * aspect * Math.sin(elevation)) / Math.sin(elevation - halfFov);

    const west = Math.min(start[0], goal[0]) - MARGIN_SIDE;
    const east = Math.max(start[0], goal[0]) + MARGIN_SIDE;
    const top = Math.min(start[1], goal[1]) - MARGIN_NORTH;
    const bottom = Math.max(start[1], goal[1]) + MARGIN_SOUTH;
    // Both flags fit in the view, and the view stays on the map as long as it can.
    const limit = Math.min(CITY_WIDTH / (2 * farHalf), CITY_DEPTH / (north + south)) * OVERSHOOT;
    const distance = Math.min(limit, Math.max(MIN_DISTANCE, (bottom - top) / (north + south), (east - west) / (2 * nearHalf)));
    const x = within((west + east) / 2, farHalf * distance, CITY_WIDTH - farHalf * distance);
    const z = within((top + bottom) / 2 + ((north - south) * distance) / 2, north * distance, CITY_DEPTH - south * distance);

    const target = local([x, z], CITY_GROUND);
    anchor.value.set(target.x, target.z);
    halves.forEach(([halfWidth, halfDepth], level) => {
      reaches[level].value.set(halfWidth + target.x, halfWidth - target.x, halfDepth + target.z, halfDepth - target.z);
    });
    applyProgress();
    return { target, distance: distance * CITY_CELL };
  };

  return {
    group,
    origin: local(start, CITY_GROUND),
    destination: local(goal, CITY_GROUND),
    footprint: { anchor, reach: reaches[reaches.length - 1], front: fronts[fronts.length - 1] },
    locate: (position): Vector3 => local(cellOf(position), CITY_GROUND),
    frame,
    build: (): void => {
      const next = pending.shift();
      if (next === undefined) return;
      buildLevel(next);
      applyProgress();
    },
    setProgress: (value): void => {
      progress = value;
      // Once the camera pulls back every level has to be there.
      if (value > 0) pending.splice(0).forEach(buildLevel);
      applyProgress();
    },
    dispose: (): void => {
      for (const item of [...geometries, ...materials]) item.dispose();
    }
  };
};
