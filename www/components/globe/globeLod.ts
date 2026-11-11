import { Group, Mesh, MeshLambertMaterial, Vector2 } from 'three';

import { createEarthLevelBuilder, DEFAULT_EARTH_LEVEL, EARTH_LEVEL_COUNT } from '@/lib/globe/earth';
import type { EarthLevel, EarthLevelBuilder } from '@/lib/globe/earth';

// Part of the step between two levels in which one gives way to the other.
// The zoom positions rest outside it, so a still globe is never half way.
const BLEND_START = 0.12;
const BLEND_END = 0.88;
// The levels next to the starting one are generated first.
const BUILD_ORDER = [1, -1, 2, -2, 3, -3];

const SHADER_PARS = /* glsl */ `
uniform float uLodBlend;
uniform float uLodFine;
uniform vec2 uLodViewport;

// How much later the edge of the view changes than its centre.
const float LOD_SPREAD = 0.7;

float lodBayer(vec2 pixel) {
  const float pattern[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  int index = int(mod(pixel.x, 4.0)) + int(mod(pixel.y, 4.0)) * 4;
  return (pattern[index] + 0.5) / 16.0;
}
`;

// The finer level takes the pixels the coarser one gives up, so every pixel
// always belongs to exactly one of them and the globe never thins out.
const SHADER_DISCARD = /* glsl */ `
{
  vec2 lodOffset = (gl_FragCoord.xy - 0.5 * uLodViewport) / (0.5 * length(uLodViewport));
  float lodLocal = clamp(uLodBlend * (1.0 + LOD_SPREAD) - min(length(lodOffset), 1.0) * LOD_SPREAD, 0.0, 1.0);
  float lodPattern = lodBayer(gl_FragCoord.xy);
  if (uLodFine > 0.5 ? lodPattern >= lodLocal : lodPattern < lodLocal) discard;
}
`;

export type LodBlend = {
  // The coarser and the finer level, and how far the finer one has taken over.
  from: number;
  to: number;
  amount: number;
};

export type GlobeLodOptions = {
  onLevelReady: (level: EarthLevel) => void;
};

export type GlobeLod = {
  group: Group;
  defaultLevel: EarthLevel;
  level: (index: number) => EarthLevel | null;
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
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const createGlobeLod = ({ onLevelReady }: GlobeLodOptions): GlobeLod => {
  const group = new Group();
  const viewport = { value: new Vector2(1, 1) };

  const slots: LevelSlot[] = Array.from({ length: EARTH_LEVEL_COUNT }, (_, index) => {
    const blend = { value: 1 };
    const fine = { value: 1 };
    const material = new MeshLambertMaterial({ vertexColors: true });
    material.onBeforeCompile = (shader): void => {
      shader.uniforms.uLodBlend = blend;
      shader.uniforms.uLodFine = fine;
      shader.uniforms.uLodViewport = viewport;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SHADER_PARS}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${SHADER_DISCARD}`);
    };
    return { builder: createEarthLevelBuilder(index), level: null, mesh: null, material, blend, fine };
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
