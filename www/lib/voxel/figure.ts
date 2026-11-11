import type { VoxelGrid } from './grid';
import { P } from './palette';

export type Facing = 1 | -1;

export type FigureLook = {
  skin: number;
  hair: number;
  top: number;
  bottom: number;
  shoes: number;
};

export type MiniArms = 'down' | 'up' | 'forward' | 'point';

export type MiniFigureOptions = FigureLook & {
  facing?: Facing;
  seated?: boolean;
  arms?: MiniArms;
  hat?: number;
  shades?: boolean;
  mouthOpen?: boolean;
};

// Small passenger, eight voxels tall, centred on (cx, cz) with feet at y.
export const paintMiniFigure = (g: VoxelGrid, cx: number, y: number, cz: number, options: MiniFigureOptions): void => {
  const f = options.facing ?? 1;
  const arms = options.arms ?? 'down';
  const torsoY = options.seated ? y + 1 : y + 2;
  const headY = torsoY + 3;

  if (options.seated) {
    g.fill(cx, cx + 2 * f, y, y, cz - 1, cz + 1, options.bottom);
    g.fill(cx + 3 * f, cx + 3 * f, y, y, cz - 1, cz + 1, options.shoes);
  } else {
    g.fill(cx - f, cx, y, y + 1, cz - 1, cz + 1, options.bottom);
    g.fill(cx - f, cx + f, y, y, cz - 1, cz + 1, options.shoes);
    g.clear(cx - f, cx + f, y, y, cz, cz);
  }

  g.fill(cx - f, cx, torsoY, torsoY + 2, cz - 1, cz + 1, options.top);
  g.fill(cx - 1, cx + 1, headY, headY + 2, cz - 1, cz + 1, options.skin);
  g.fill(cx - f, cx - f, headY, headY + 2, cz - 1, cz + 1, options.hair);
  g.fill(cx - 1, cx + 1, headY + 2, headY + 2, cz - 1, cz + 1, options.hat ?? options.hair);
  if (options.hat !== undefined) {
    g.fill(cx + 2 * f, cx + 2 * f, headY + 2, headY + 2, cz - 1, cz + 1, options.hat);
  }

  if (options.shades) {
    g.fill(cx + f, cx + f, headY + 1, headY + 1, cz - 1, cz + 1, P.black);
  } else {
    g.set(cx + f, headY + 1, cz - 1, P.black);
    g.set(cx + f, headY + 1, cz + 1, P.black);
  }
  if (options.mouthOpen) g.set(cx + f, headY, cz, P.mouth);

  const paintArm = (side: number, pose: MiniArms): void => {
    if (pose === 'up') {
      g.fill(cx, cx, torsoY + 2, torsoY + 4, side, side, options.top);
      g.set(cx, torsoY + 5, side, options.skin);
    } else if (pose === 'forward') {
      g.fill(cx, cx + 2 * f, torsoY + 2, torsoY + 2, side, side, options.top);
      g.set(cx + 3 * f, torsoY + 2, side, options.skin);
    } else {
      g.fill(cx, cx, torsoY + 1, torsoY + 2, side, side, options.top);
      g.set(cx, torsoY, side, options.skin);
    }
  };
  paintArm(cz - 2, arms === 'point' ? 'down' : arms);
  paintArm(cz + 2, arms === 'point' ? 'forward' : arms);
};

export type BigFigureOptions = FigureLook & {
  facing?: Facing;
  socks?: number;
  glove?: number;
  shades?: boolean;
  // Step of the walk, below WALK_STEPS. In step 0 the right foot reaches forward.
  step?: number;
  // The foot that swings forward stays on its toes, and the body never rises.
  glide?: boolean;
};

export const WALK_STEPS = 8;

// One leg through the walk: how far ahead of the hip the knee and the foot are, and how high the foot is.
const WALK_LEG: readonly (readonly [knee: number, foot: number, lift: number])[] = [
  [1, 2, 0],
  [1, 1, 0],
  [0, 0, 0],
  [0, -1, 0],
  [-1, -2, 0],
  [0, -2, 1],
  [1, 0, 2],
  [1, 2, 1]
];
// The right arm swings against the right leg: behind, hanging or ahead.
const WALK_ARM = [-1, -1, 0, 1, 1, 1, 0, -1];
// The body rides a voxel higher while a leg stands straight under it.
const WALK_RISE = [0, 0, 1, 1, 0, 0, 1, 1];

export const walkRise = (step: number): number => WALK_RISE[step % WALK_STEPS];

// Where the left hand is in a step: behind, beside or ahead of the body.
export const walkLeftSwing = (step: number): number => WALK_ARM[(step + WALK_STEPS / 2) % WALK_STEPS];

// Standalone walker, eighteen voxels tall, centred on the origin.
export const paintBigFigure = (g: VoxelGrid, options: BigFigureOptions): void => {
  const f = options.facing ?? 1;
  const step = options.step ?? 0;
  const rise = options.glide ? 0 : walkRise(step);
  const box = (dx0: number, dx1: number, y0: number, y1: number, z0: number, z1: number, color: number): void => g.fill(dx0 * f, dx1 * f, y0, y1, z0, z1, color);
  const body = (dx0: number, dx1: number, y0: number, y1: number, z0: number, z1: number, color: number): void => box(dx0, dx1, y0 + rise, y1 + rise, z0, z1, color);
  const lowerLeg = options.socks ?? options.bottom;

  const paintLeg = (z0: number, z1: number, phase: number): void => {
    const [knee, foot, lift] = WALK_LEG[phase % WALK_STEPS];
    const onToes = lift > 0 && options.glide === true;
    const height = onToes ? 1 : lift;
    const hang = lift > 0 ? rise : 0;
    box(-1, 0, 5, 6 + rise, z0, z1, options.bottom);
    box(knee - 1, knee, 3 + hang, 4 + hang, z0, z1, options.bottom);
    box(foot - 1, foot, height + 1, height + 2, z0, z1, lowerLeg);
    box(foot - 1, onToes ? foot : foot + 1, height, height, z0, z1, options.shoes);
    if (onToes) box(foot + 1, foot + 1, 0, 0, z0, z1, options.shoes);
  };
  paintLeg(-2, -1, step);
  paintLeg(1, 2, step + WALK_STEPS / 2);

  body(-1, 1, 8, 12, -2, 2, options.top);
  body(-1, 1, 7, 7, -2, 2, options.bottom);

  const paintArm = (z: number, phase: number, hand: number): void => {
    const swing = WALK_ARM[phase % WALK_STEPS];
    const reach = Math.max(swing, 0);
    body(-1, 0, 10, 12, z, z, options.top);
    body(swing - 1, swing, 8, 9, z, z, options.top);
    body(swing - 1 + reach, swing + reach, 7, 7, z, z, hand);
  };
  paintArm(-3, step, options.skin);
  paintArm(3, step + WALK_STEPS / 2, options.glove ?? options.skin);

  body(-2, 2, 13, 17, -2, 2, options.skin);
  body(-2, 2, 17, 17, -2, 2, options.hair);
  body(-2, -2, 14, 17, -2, 2, options.hair);
  body(-2, 0, 16, 16, -2, -2, options.hair);
  body(-2, 0, 16, 16, 2, 2, options.hair);

  if (options.shades) {
    body(2, 2, 15, 15, -2, 2, P.black);
  } else {
    body(2, 2, 15, 15, -1, -1, P.black);
    body(2, 2, 15, 15, 1, 1, P.black);
  }
  body(2, 2, 13, 13, -1, 0, P.mouth);
  body(3, 3, 14, 14, 0, 0, options.skin);
};
