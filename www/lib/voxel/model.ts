import { Vector3 } from "three";
import type { BufferGeometry } from "three";

import { createVoxelGrid } from "./grid";
import type { VoxelGrid } from "./grid";
import { buildVoxelGeometry } from "./mesher";

const MODEL_JITTER = 0.09;

// Models face +x, stand on y = 0 and have +z on their right-hand side.
export type VoxelModelDef = {
  id: string;
  label: string;
  paint: (grid: VoxelGrid) => void;
};

export type BuiltModel = { geometry: BufferGeometry; size: Vector3 };

export const buildModel = (def: VoxelModelDef): BuiltModel => {
  const grid = createVoxelGrid();
  def.paint(grid);
  const geometry = buildVoxelGeometry(grid.cells(), grid.has, MODEL_JITTER);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error(`Voxel model "${def.id}" is empty`);
  const size = box.getSize(new Vector3());
  geometry.translate(
    -(box.min.x + box.max.x) / 2,
    -box.min.y,
    -(box.min.z + box.max.z) / 2,
  );
  geometry.computeBoundingSphere();
  return { geometry, size };
};
