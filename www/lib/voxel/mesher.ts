import { BufferAttribute, BufferGeometry, Color } from 'three';

import type { VoxelCell } from './grid';
import { hash3 } from './hash';

type Triple = readonly [number, number, number];

type Face = { normal: Triple; corners: readonly Triple[] };

// Corners are counter-clockwise seen from outside the voxel.
const FACES: readonly Face[] = [
  {
    normal: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1]
    ]
  },
  {
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0]
    ]
  },
  {
    normal: [0, 1, 0],
    corners: [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0]
    ]
  },
  {
    normal: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ]
  },
  {
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ]
  },
  {
    normal: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0]
    ]
  }
];

// Emits only the faces that border empty space, one colour per voxel.
export const buildVoxelGeometry = (cells: readonly VoxelCell[], isSolid: (x: number, y: number, z: number) => boolean, jitter: number): BufferGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new Color();

  for (const cell of cells) {
    const shade = 1 + (hash3(cell.x, cell.y, cell.z) - 0.5) * jitter;
    color.setHex(cell.color);
    for (const face of FACES) {
      const [nx, ny, nz] = face.normal;
      if (isSolid(cell.x + nx, cell.y + ny, cell.z + nz)) continue;
      const base = positions.length / 3;
      for (const [cx, cy, cz] of face.corners) {
        positions.push(cell.x + cx, cell.y + cy, cell.z + cz);
        normals.push(nx, ny, nz);
        colors.push(color.r * shade, color.g * shade, color.b * shade);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  return geometry;
};
