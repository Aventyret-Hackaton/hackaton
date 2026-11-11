// Shader pieces shared by everything that gives way to something else pixel by pixel.

// An ordered 4 x 4 pattern: every pixel gets a fixed threshold between 0 and 1.
export const DITHER_GLSL = /* glsl */ `
float ditherBayer(vec2 pixel) {
  const float pattern[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  int index = int(mod(pixel.x, 4.0)) + int(mod(pixel.y, 4.0)) * 4;
  return (pattern[index] + 0.5) / 16.0;
}
`;

// Width of the dithered rim of a region, as a share of the way from its anchor to its edge.
export const REGION_RIM = 0.18;

// How far a point is from the anchor towards the edge of a box, rounded at the corners.
// Reach holds the distances from the anchor to the west, east, north and south edges.
export const REGION_GLSL = /* glsl */ `
float regionShare(vec2 offset, vec4 reach) {
  vec2 share = abs(offset) / vec2(offset.x < 0.0 ? reach.x : reach.y, offset.y < 0.0 ? reach.z : reach.w);
  share *= share;
  share *= share;
  share *= share;
  return pow(share.x + share.y, 0.125);
}
`;
