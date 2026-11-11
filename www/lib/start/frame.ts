const DEG = Math.PI / 180;

// The picture that the scene recreates. Places in the scene are given as pixels of it.
export const FRAME_WIDTH = 1672;
export const FRAME_HEIGHT = 941;
export const FRAME_ASPECT = FRAME_WIDTH / FRAME_HEIGHT;
// Vertical field of view, in degrees, that shows exactly the frame.
export const FRAME_FOV = 40;

export const CAMERA_HEIGHT = 4.2;
// How far the camera looks down.
export const CAMERA_PITCH = 8 * DEG;

export const FOCAL = FRAME_HEIGHT / 2 / Math.tan((FRAME_FOV * DEG) / 2);

// A place in the scene: x to the right of the camera, y up, d ahead of it.
export type Place = { x: number; y: number; d: number };

export type Spot = readonly [x: number, d: number];

export type Pixel = readonly [px: number, py: number];

const SIN = Math.sin(CAMERA_PITCH);
const COS = Math.cos(CAMERA_PITCH);

// Direction from the camera through a pixel of the frame, as x, y and d.
export const frameRay = (px: number, py: number): readonly [x: number, y: number, d: number] => {
  const across = (px - FRAME_WIDTH / 2) / FOCAL;
  const upward = (FRAME_HEIGHT / 2 - py) / FOCAL;
  return [across, upward * COS - SIN, COS + upward * SIN];
};

// Where a pixel of the frame is on level ground at height 0.
export const onLevelGround = ([px, py]: Pixel): Spot => {
  const [x, y, d] = frameRay(px, py);
  const reach = -CAMERA_HEIGHT / y;
  return [x * reach, d * reach];
};

// Distance from the camera along the way it looks.
export const depthOf = ({ y, d }: Place): number => d * COS - (y - CAMERA_HEIGHT) * SIN;

// Size of a voxel that makes so many voxels cover so many pixels of the frame at a place.
export const fitVoxel = (place: Place, pixels: number, voxels: number): number => ((pixels / FOCAL) * depthOf(place)) / voxels;
