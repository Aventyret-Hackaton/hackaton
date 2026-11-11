import type { VoxelGrid } from '@/lib/voxel/grid';
import { P } from '@/lib/voxel/palette';

import { fillRounded } from './shapes';

export type ChibiLook = {
  skin: number;
  top: number;
  bottom: number;
  shoes: number;
  sole?: number;
};

// Hanging, forearm ahead, hand low ahead, hand at the mouth, or straight up.
export type ChibiArm = 'down' | 'bent' | 'low' | 'sip' | 'up';

export type ChibiPose = {
  // Step of the walk, below CHIBI_STEPS. In step 0 the right foot reaches forward.
  step?: number;
  // Short steps that never lift the body.
  shuffle?: boolean;
  // On the ground with the legs stretched out ahead.
  seated?: boolean;
  // Voxels that the upper body is lifted.
  lift?: number;
  right?: ChibiArm;
  left?: ChibiArm;
  // How far ahead of the shoulder a raised hand is.
  wave?: number;
  blink?: boolean;
  // The toes of the right foot are off the ground.
  toesUp?: boolean;
};

export type Fill = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number) => void;

export const CHIBI_STEPS = 8;
const SEAT_DROP = 6;

// One leg through the walk: how far ahead of the hip the knee and the foot are, and how high the foot is.
const STRIDE: readonly (readonly [knee: number, foot: number, lift: number])[] = [
  [1, 3, 0],
  [1, 2, 0],
  [0, 0, 0],
  [0, -2, 0],
  [-1, -3, 0],
  [0, -3, 1],
  [1, 0, 2],
  [2, 3, 1]
];
const SHUFFLE: readonly (readonly [knee: number, foot: number, lift: number])[] = [
  [0, 1, 0],
  [0, 1, 0],
  [0, 0, 0],
  [0, -1, 0],
  [0, -1, 0],
  [0, -1, 1],
  [0, 0, 1],
  [0, 1, 1]
];
const STANDING = [0, 0, 0] as const;
// The right arm swings against the right leg: behind, hanging or ahead.
const SWING = [-1, -1, 0, 1, 1, 1, 0, -1];
const RISE = [0, 0, 1, 1, 0, 0, 1, 1];

// Fills boxes the given number of voxels above where they are said to be.
export const raised =
  (g: VoxelGrid, up: number): Fill =>
  (x0, x1, y0, y1, z0, z1, color): void =>
    g.fill(x0, x1, y0 + up, y1 + up, z0, z1, color);

// Figure with a big head, 29 voxels tall, facing +x. Returns how far the upper body is above its standing place.
export const paintChibi = (g: VoxelGrid, look: ChibiLook, pose: ChibiPose = {}): number => {
  const { step, seated = false } = pose;
  const walking = step !== undefined && !seated;
  const strides = pose.shuffle ? SHUFFLE : STRIDE;
  const rise = walking && !pose.shuffle ? RISE[step % CHIBI_STEPS] : 0;
  const up = rise + (pose.lift ?? 0) - (seated ? SEAT_DROP : 0);
  const sole = look.sole ?? look.shoes;
  const body = raised(g, up);

  const paintLeg = (side: number, phase: number): void => {
    const z0 = side;
    const z1 = side * 4;
    if (seated) {
      g.fill(-2, 9, 0, 3, z0, z1, look.bottom);
      g.fill(10, 12, 0, 4, z0, z1, look.shoes);
      g.fill(13, 13, 0, 4, z0, z1, sole);
      return;
    }
    const [knee, foot, lift] = walking ? strides[phase % CHIBI_STEPS] : STANDING;
    const toes = pose.toesUp && side === 1 ? 1 : 0;
    g.fill(knee - 2, knee + 1, 6, 8 + Math.max(up, 0), z0, z1, look.bottom);
    g.fill(foot - 2, foot + 1, lift + 2, lift + 5, z0, z1, look.bottom);
    g.fill(foot - 2, foot + 1, lift, lift + 1, z0, z1, look.shoes);
    g.fill(foot + 2, foot + 3, lift + toes, lift + toes + 1, z0, z1, look.shoes);
    g.fill(foot - 2, foot + 1, lift, lift, z0, z1, sole);
    g.fill(foot + 2, foot + 3, lift + toes, lift + toes, z0, z1, sole);
  };
  paintLeg(1, step ?? 0);
  paintLeg(-1, (step ?? 0) + CHIBI_STEPS / 2);

  body(-3, 2, 9, 17, -4, 4, look.top);

  const paintArm = (side: number, arm: ChibiArm | undefined, phase: number): void => {
    const z0 = side * 5;
    const z1 = side * 7;
    if (arm === undefined || arm === 'down') {
      const swing = walking && arm === undefined ? SWING[phase % CHIBI_STEPS] : 0;
      body(-1, 1, 14, 17, z0, z1, look.top);
      body(swing - 1, swing + 1, 10, 13, z0, z1, look.top);
      body(2 * swing - 1, 2 * swing + 1, 8, 9, z0, z1, look.skin);
      return;
    }
    if (arm === 'up') {
      const wave = pose.wave ?? 0;
      body(-1, 1, 16, 17, z0, z1, look.top);
      body(-1, 1, 18, 20, side * 7, side * 9, look.top);
      body(wave - 1, wave + 1, 21, 24, side * 7, side * 9, look.top);
      body(wave - 1, wave + 1, 25, 26, side * 7, side * 9, look.skin);
      return;
    }
    body(-1, 1, 13, 17, z0, z1, look.top);
    if (arm === 'bent') {
      body(2, 5, 13, 15, z0, z1, look.top);
      body(6, 7, 13, 15, z0, z1, look.skin);
    } else if (arm === 'low') {
      body(1, 3, 10, 13, z0, z1, look.top);
      body(3, 5, 9, 11, z0, z1, look.skin);
    } else {
      body(2, 3, 13, 16, z0, z1, look.top);
      body(4, 5, 16, 18, side * 4, side * 6, look.top);
      body(5, 6, 19, 20, side * 3, side * 5, look.skin);
    }
  };
  paintArm(1, pose.right, step ?? 0);
  paintArm(-1, pose.left, (step ?? 0) + CHIBI_STEPS / 2);

  fillRounded(g, -5, 5, 18 + up, 28 + up, -6, 6, look.skin);
  for (const z of [-3, 3]) body(5, 5, 23, pose.blink ? 23 : 24, z, z, P.black);
  body(5, 5, 20, 20, -1, 1, P.mouth);
  for (const z of [-2, 2]) body(5, 5, 21, 21, z, z, P.mouth);

  return up;
};
