export const hash3 = (x: number, y: number, z: number): number => {
  let h =
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const smooth = (t: number): number => t * t * (3 - 2 * t);

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export const valueNoise3 = (x: number, y: number, z: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const tz = smooth(z - z0);
  const plane = (dz: number): number =>
    mix(
      mix(hash3(x0, y0, z0 + dz), hash3(x0 + 1, y0, z0 + dz), tx),
      mix(hash3(x0, y0 + 1, z0 + dz), hash3(x0 + 1, y0 + 1, z0 + dz), tx),
      ty,
    );
  return mix(plane(0), plane(1), tz);
};
