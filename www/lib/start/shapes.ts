import type { VoxelGrid } from '@/lib/voxel/grid';
import { hash3 } from '@/lib/voxel/hash';

export type Tint = number | ((x: number, y: number, z: number) => number);

// A box without its twelve edges, which reads as rounded.
export const fillRounded = (g: VoxelGrid, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tint: Tint): void => {
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      for (let z = z0; z <= z1; z += 1) {
        const extremes = Number(x === x0 || x === x1) + Number(y === y0 || y === y1) + Number(z === z0 || z === z1);
        if (extremes < 2) g.set(x, y, z, typeof tint === 'number' ? tint : tint(x, y, z));
      }
    }
  }
};

// Mostly the first colour, with the given share of voxels in the second.
export const speckled =
  (color: number, speck: number, share: number): Tint =>
  (x, y, z): number =>
    hash3(x, y, z) < share ? speck : color;

// A filled circle around the vertical axis, at one height.
export const fillDisc = (g: VoxelGrid, y: number, radius: number, color: number): void => {
  const reach = Math.ceil(radius);
  for (let x = -reach; x <= reach; x += 1) {
    for (let z = -reach; z <= reach; z += 1) {
      if (x * x + z * z <= radius * radius) g.set(x, y, z, color);
    }
  }
};
