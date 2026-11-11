const KEY_OFFSET = 128;
const KEY_MASK = 0xff;

export type VoxelCell = { x: number; y: number; z: number; color: number };

export type VoxelGrid = {
  set: (x: number, y: number, z: number, color: number) => void;
  fill: (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number) => void;
  clear: (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => void;
  has: (x: number, y: number, z: number) => boolean;
  cells: () => VoxelCell[];
};

const voxelKey = (x: number, y: number, z: number): number => ((x + KEY_OFFSET) << 16) | ((y + KEY_OFFSET) << 8) | (z + KEY_OFFSET);

const eachInRange = (a: number, b: number, visit: (value: number) => void): void => {
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  for (let value = from; value <= to; value += 1) visit(value);
};

const eachInBox = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, visit: (x: number, y: number, z: number) => void): void => {
  eachInRange(x0, x1, (x) => eachInRange(y0, y1, (y) => eachInRange(z0, z1, (z) => visit(x, y, z))));
};

// Ranges are inclusive at both ends, in any order.
export const createVoxelGrid = (): VoxelGrid => {
  const store = new Map<number, number>();

  const set = (x: number, y: number, z: number, color: number): void => {
    store.set(voxelKey(x, y, z), color);
  };

  return {
    set,
    fill: (x0, x1, y0, y1, z0, z1, color): void => eachInBox(x0, x1, y0, y1, z0, z1, (x, y, z) => set(x, y, z, color)),
    clear: (x0, x1, y0, y1, z0, z1): void =>
      eachInBox(x0, x1, y0, y1, z0, z1, (x, y, z) => {
        store.delete(voxelKey(x, y, z));
      }),
    has: (x, y, z): boolean => store.has(voxelKey(x, y, z)),
    cells: (): VoxelCell[] =>
      Array.from(store, ([key, color]) => ({
        x: (key >> 16) - KEY_OFFSET,
        y: ((key >> 8) & KEY_MASK) - KEY_OFFSET,
        z: (key & KEY_MASK) - KEY_OFFSET,
        color
      }))
  };
};
