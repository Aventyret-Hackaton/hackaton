import { Vector3 } from 'three';
import type { BufferGeometry } from 'three';

import { createVoxelGrid } from './grid';
import type { VoxelGrid } from './grid';
import { buildVoxelGeometry } from './mesher';

const MODEL_JITTER = 0.09;
export const OUTLINE_COLOR = 0xffffff;

// A loop of poses that the model goes through while it travels.
export type VoxelSequence = {
  frames: number;
  framesPerSecond: number;
  paint: (grid: VoxelGrid, frame: number) => void;
};

// Models face +x, stand on y = 0 and have +z on their right-hand side.
export type VoxelModelDef = {
  id: string;
  label: string;
  paint: (grid: VoxelGrid) => void;
  sequence?: VoxelSequence;
};

// The shift is what moved the painted voxels to where the model stands.
export type BuiltModel = { geometry: BufferGeometry; size: Vector3; shift: Vector3 };

const paintGeometry = (paint: (grid: VoxelGrid) => void): BufferGeometry => {
  const grid = createVoxelGrid();
  paint(grid);
  return buildVoxelGeometry(grid.cells(), grid.has, MODEL_JITTER);
};

// Planted models keep the voxel column at the origin in place instead of being centred.
const build = (def: VoxelModelDef, planted: boolean): BuiltModel => {
  const geometry = paintGeometry(def.paint);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error(`Voxel model "${def.id}" is empty`);
  const size = box.getSize(new Vector3());
  const shift = new Vector3(planted ? -0.5 : -(box.min.x + box.max.x) / 2, -box.min.y, planted ? -0.5 : -(box.min.z + box.max.z) / 2);
  geometry.translate(shift.x, shift.y, shift.z);
  geometry.computeBoundingSphere();
  return { geometry, size, shift };
};

export const buildModel = (def: VoxelModelDef): BuiltModel => build(def, false);

export const buildPlantedModel = (def: VoxelModelDef): BuiltModel => build(def, true);

// A shell one voxel outside the model, placed like it. Drawn inside out, it shows as an outline around the model.
export const buildOutline = ({ paint }: VoxelModelDef, { shift }: BuiltModel): BufferGeometry => {
  const grid = createVoxelGrid();
  paint(grid);
  const shell = createVoxelGrid();
  for (const { x, y, z } of grid.cells()) shell.fill(x - 1, x + 1, y - 1, y + 1, z - 1, z + 1, OUTLINE_COLOR);
  return buildVoxelGeometry(shell.cells(), shell.has, 0).translate(shift.x, shift.y, shift.z);
};

// One pose of the sequence, placed like the still model so that nothing jumps between poses.
export const buildPose = ({ paint }: VoxelSequence, frame: number, { shift }: BuiltModel): BufferGeometry =>
  paintGeometry((grid) => paint(grid, frame)).translate(shift.x, shift.y, shift.z);
