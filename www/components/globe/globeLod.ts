import { Group, type IUniform, Mesh, MeshLambertMaterial, Vector2, type Vector3, type Vector4 } from 'three';

import { createEarthLevelBuilder, DEFAULT_EARTH_LEVEL, EARTH_LEVEL_COUNT } from '@/lib/globe/earth';
import type { EarthLevel, EarthLevelBuilder } from '@/lib/globe/earth';

import { DITHER_GLSL, REGION_GLSL, REGION_RIM } from './dither';

// Part of the step between two levels in which one gives way to the other.
// The zoom positions rest outside it, so a still globe is never half way.
const BLEND_START = 0.12;
const BLEND_END = 0.88;
// The finer levels are generated first: the journey opens close to the ground.
const BUILD_ORDER = [1, 2, 3, -1, -2];
// A cut-out only reaches this far into the globe, so it never opens the far side.
const CUTOUT_DEPTH = 8;

const VERTEX_PARS = /* glsl */ `
uniform float uLodVoxel;
uniform vec3 uCutOrigin;
uniform vec3 uCutEast;
uniform vec3 uCutUp;
uniform vec3 uCutSouth;
varying vec3 vCut;
`;

// Where the voxel lies in the frame of the cut-out: east, up and south of its origin.
const VERTEX_MAIN = /* glsl */ `
{
  vec3 cutPoint = (transformed - 0.5) * uLodVoxel - uCutOrigin;
  vCut = vec3(dot(cutPoint, uCutEast), dot(cutPoint, uCutUp), dot(cutPoint, uCutSouth));
}
`;

const SHADER_PARS = /* glsl */ `
uniform float uLodBlend;
uniform float uLodFine;
uniform vec2 uLodViewport;
uniform vec2 uCutAnchor;
uniform vec4 uCutReach;
uniform float uCutFront;
varying vec3 vCut;

// How much later the edge of the view changes than its centre.
const float LOD_SPREAD = 0.7;
${DITHER_GLSL}
${REGION_GLSL}
`;

// The finer level takes the pixels the coarser one gives up, so every pixel
// always belongs to exactly one of them and the globe never thins out.
const SHADER_DISCARD = /* glsl */ `
{
  vec2 lodOffset = (gl_FragCoord.xy - 0.5 * uLodViewport) / (0.5 * length(uLodViewport));
  float lodLocal = clamp(uLodBlend * (1.0 + LOD_SPREAD) - min(length(lodOffset), 1.0) * LOD_SPREAD, 0.0, 1.0);
  float lodPattern = ditherBayer(gl_FragCoord.xy);
  if (uLodFine > 0.5 ? lodPattern >= lodLocal : lodPattern < lodLocal) discard;
  // Whatever is drawn in the cut-out has these pixels instead.
  if (vCut.y > -${CUTOUT_DEPTH.toFixed(1)} && regionShare(vCut.xz - uCutAnchor, uCutReach) <= uCutFront - ${REGION_RIM.toFixed(2)} * lodPattern) discard;
}
`;

// A patch of the globe that something more detailed is drawn in place of.
export type GlobeCutout = {
  // The middle of the patch, and its east, up and south directions, in the globe's own space.
  origin: Vector3;
  east: Vector3;
  up: Vector3;
  south: Vector3;
  // The patch itself, in that frame: see regionShare.
  anchor: IUniform<Vector2>;
  reach: IUniform<Vector4>;
  front: IUniform<number>;
};

export type LodBlend = {
  // The coarser and the finer level, and how far the finer one has taken over.
  from: number;
  to: number;
  amount: number;
};

export type GlobeLodOptions = {
  onLevelReady: (level: EarthLevel) => void;
  cutout: GlobeCutout;
};

export type GlobeLod = {
  group: Group;
  defaultLevel: EarthLevel;
  level: (index: number) => EarthLevel | null;
  // The most detailed level that can be shown without waiting for it.
  finestReady: () => number;
  // Spends a few milliseconds generating the levels that are not ready yet.
  build: (budgetMs: number) => void;
  // Shows the level, or pair of levels, that belongs to the zoom coordinate.
  update: (coordinate: number, width: number, height: number) => LodBlend;
  dispose: () => void;
};

type LevelSlot = {
  builder: EarthLevelBuilder;
  level: EarthLevel | null;
  mesh: Mesh | null;
  material: MeshLambertMaterial;
  blend: { value: number };
  fine: { value: number };
  voxel: { value: number };
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const createGlobeLod = ({ onLevelReady, cutout }: GlobeLodOptions): GlobeLod => {
  const group = new Group();
  const viewport = { value: new Vector2(1, 1) };

  const slots: LevelSlot[] = Array.from({ length: EARTH_LEVEL_COUNT }, (_, index) => {
    const blend = { value: 1 };
    const fine = { value: 1 };
    const voxel = { value: 1 };
    const material = new MeshLambertMaterial({ vertexColors: true });
    material.onBeforeCompile = (shader): void => {
      shader.uniforms.uLodBlend = blend;
      shader.uniforms.uLodFine = fine;
      shader.uniforms.uLodViewport = viewport;
      Object.assign(shader.uniforms, {
        uLodVoxel: voxel,
        uCutOrigin: { value: cutout.origin },
        uCutEast: { value: cutout.east },
        uCutUp: { value: cutout.up },
        uCutSouth: { value: cutout.south },
        uCutAnchor: cutout.anchor,
        uCutReach: cutout.reach,
        uCutFront: cutout.front
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SHADER_PARS}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${SHADER_DISCARD}`);
    };
    return { builder: createEarthLevelBuilder(index), level: null, mesh: null, material, blend, fine, voxel };
  });

  const adopt = (slot: LevelSlot, level: EarthLevel): EarthLevel => {
    const mesh = new Mesh(level.geometry, slot.material);
    mesh.scale.setScalar(level.voxelSize);
    // Voxel centres sit on whole numbers, so the corners start half a voxel back.
    mesh.position.setScalar(-0.5 * level.voxelSize);
    mesh.visible = false;
    group.add(mesh);
    slot.level = level;
    slot.mesh = mesh;
    slot.voxel.value = level.voxelSize;
    onLevelReady(level);
    return level;
  };

  const ensure = (index: number): EarthLevel => {
    const slot = slots[index];
    if (slot.level) return slot.level;
    const level = slot.builder.step(Number.POSITIVE_INFINITY);
    if (!level) throw new Error(`Earth level ${index} could not be built`);
    return adopt(slot, level);
  };

  const show = (index: number, fine: boolean, blend: number): void => {
    const slot = slots[index];
    ensure(index);
    slot.fine.value = fine ? 1 : 0;
    slot.blend.value = blend;
    if (slot.mesh) slot.mesh.visible = true;
  };

  const defaultLevel = ensure(DEFAULT_EARTH_LEVEL);
  const pending = BUILD_ORDER.map((offset) => DEFAULT_EARTH_LEVEL + offset).filter((index) => index >= 0 && index < EARTH_LEVEL_COUNT);

  return {
    group,
    defaultLevel,
    level: (index): EarthLevel | null => slots[index]?.level ?? null,
    finestReady: (): number => slots.reduce((finest, slot, index) => (slot.level ? index : finest), DEFAULT_EARTH_LEVEL),
    build: (budgetMs): void => {
      const deadline = performance.now() + budgetMs;
      while (pending.length > 0 && performance.now() < deadline) {
        const slot = slots[pending[0]];
        if (!slot.level) {
          const level = slot.builder.step(deadline - performance.now());
          if (!level) return;
          adopt(slot, level);
        }
        pending.shift();
      }
    },
    update: (coordinate, width, height): LodBlend => {
      const position = clamp(coordinate, 0, EARTH_LEVEL_COUNT - 1);
      const from = Math.min(EARTH_LEVEL_COUNT - 2, Math.floor(position));
      const to = from + 1;
      const linear = clamp((position - from - BLEND_START) / (BLEND_END - BLEND_START), 0, 1);
      const amount = linear * linear * (3 - 2 * linear);

      viewport.value.set(width, height);
      for (const slot of slots) {
        if (slot.mesh) slot.mesh.visible = false;
      }
      if (amount <= 0) show(from, true, 1);
      else if (amount >= 1) show(to, true, 1);
      else {
        show(from, false, amount);
        show(to, true, amount);
      }
      return { from, to, amount };
    },
    dispose: (): void => {
      for (const slot of slots) {
        slot.level?.geometry.dispose();
        slot.material.dispose();
      }
    }
  };
};
