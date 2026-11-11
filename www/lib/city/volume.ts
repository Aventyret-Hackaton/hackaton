import { BufferAttribute, BufferGeometry, Color, Sphere, Vector3 } from 'three';

import { hash3 } from '@/lib/voxel/hash';
import { VOXEL_FACES } from '@/lib/voxel/mesher';

// A dense block of voxels. Colours are indices into a palette, 0 is empty.
export type CityVolume = {
  width: number;
  height: number;
  depth: number;
  get: (x: number, y: number, z: number) => number;
  set: (x: number, y: number, z: number, color: number) => void;
  // Ranges are inclusive at both ends. Voxels outside the block are ignored.
  fill: (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number) => void;
};

export const createCityVolume = (width: number, height: number, depth: number): CityVolume => {
  const data = new Uint8Array(width * height * depth);
  const inside = (x: number, y: number, z: number): boolean => x >= 0 && x < width && y >= 0 && y < height && z >= 0 && z < depth;
  const offset = (x: number, y: number, z: number): number => (y * depth + z) * width + x;

  const set = (x: number, y: number, z: number, color: number): void => {
    if (inside(x, y, z)) data[offset(x, y, z)] = color;
  };

  return {
    width,
    height,
    depth,
    get: (x, y, z): number => (inside(x, y, z) ? data[offset(x, y, z)] : 0),
    set,
    fill: (x0, x1, y0, y1, z0, z1, color): void => {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) {
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z += 1) {
          for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) set(x, y, z, color);
        }
      }
    }
  };
};

// Light per face, in the order of VOXEL_FACES: the tops and the south walls catch the sun.
// It is baked into the colours, so the city looks the same however the globe is turned.
const FACE_LIGHT = [0.7, 0.78, 1, 0.5, 0.93, 0.56];

// One quad per voxel face that borders empty space, centred on the block in x and z.
export const buildCityGeometry = ({ width, height, depth, get }: CityVolume, palette: readonly number[], jitter: number): BufferGeometry => {
  const linear = palette.map((hex) => new Color(hex));
  // The outer walls and the underside are never seen, so they count as covered.
  const isOpen = (x: number, y: number, z: number): boolean => y >= height || (y >= 0 && x >= 0 && x < width && z >= 0 && z < depth && get(x, y, z) === 0);

  const eachFace = (visit: (x: number, y: number, z: number, color: number, face: number) => void): void => {
    for (let y = 0; y < height; y += 1) {
      for (let z = 0; z < depth; z += 1) {
        for (let x = 0; x < width; x += 1) {
          const color = get(x, y, z);
          if (color === 0) continue;
          for (let face = 0; face < VOXEL_FACES.length; face += 1) {
            const [nx, ny, nz] = VOXEL_FACES[face].normal;
            if (isOpen(x + nx, y + ny, z + nz)) visit(x, y, z, color, face);
          }
        }
      }
    }
  };

  let faceCount = 0;
  eachFace(() => {
    faceCount += 1;
  });

  const positions = new Int16Array(faceCount * 12);
  const colors = new Uint8Array(faceCount * 12);
  const indices = new Uint32Array(faceCount * 6);
  let vertex = 0;
  let index = 0;

  eachFace((x, y, z, color, face) => {
    const { corners } = VOXEL_FACES[face];
    const tint = linear[color - 1];
    const shade = (1 + (hash3(x, y, z) - 0.5) * jitter) * FACE_LIGHT[face] * 255;
    for (const [cx, cy, cz] of corners) {
      const at = vertex * 3;
      positions[at] = x + cx - width / 2;
      positions[at + 1] = y + cy;
      positions[at + 2] = z + cz - depth / 2;
      colors[at] = Math.min(255, tint.r * shade);
      colors[at + 1] = Math.min(255, tint.g * shade);
      colors[at + 2] = Math.min(255, tint.b * shade);
      vertex += 1;
    }
    indices.set([vertex - 4, vertex - 3, vertex - 2, vertex - 4, vertex - 2, vertex - 1], index);
    index += 6;
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3, true));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.boundingSphere = new Sphere(new Vector3(0, height / 2, 0), Math.hypot(width, height, depth) / 2);
  return geometry;
};
