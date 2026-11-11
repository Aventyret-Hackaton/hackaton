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
};

// Standalone walker, eighteen voxels tall, centred on the origin mid-stride.
export const paintBigFigure = (g: VoxelGrid, options: BigFigureOptions): void => {
  const f = options.facing ?? 1;
  const box = (dx0: number, dx1: number, y0: number, y1: number, z0: number, z1: number, color: number): void => g.fill(dx0 * f, dx1 * f, y0, y1, z0, z1, color);
  const lowerLeg = options.socks ?? options.bottom;

  box(-1, 0, 5, 6, -2, -1, options.bottom);
  box(0, 1, 3, 4, -2, -1, options.bottom);
  box(1, 2, 1, 2, -2, -1, lowerLeg);
  box(1, 3, 0, 0, -2, -1, options.shoes);

  box(-1, 0, 5, 6, 1, 2, options.bottom);
  box(-2, -1, 3, 4, 1, 2, options.bottom);
  box(-3, -2, 1, 2, 1, 2, lowerLeg);
  box(-4, -2, 0, 0, 1, 2, options.shoes);

  box(-1, 1, 8, 12, -2, 2, options.top);
  box(-1, 1, 7, 7, -2, 2, options.bottom);

  box(-1, 0, 10, 12, -3, -3, options.top);
  box(-2, -1, 8, 9, -3, -3, options.top);
  box(-2, -1, 7, 7, -3, -3, options.skin);

  box(-1, 0, 10, 12, 3, 3, options.top);
  box(0, 1, 8, 9, 3, 3, options.top);
  box(1, 2, 7, 7, 3, 3, options.glove ?? options.skin);

  box(-2, 2, 13, 17, -2, 2, options.skin);
  box(-2, 2, 17, 17, -2, 2, options.hair);
  box(-2, -2, 14, 17, -2, 2, options.hair);
  box(-2, 0, 16, 16, -2, -2, options.hair);
  box(-2, 0, 16, 16, 2, 2, options.hair);

  if (options.shades) {
    box(2, 2, 15, 15, -2, 2, P.black);
  } else {
    box(2, 2, 15, 15, -1, -1, P.black);
    box(2, 2, 15, 15, 1, 1, P.black);
  }
  box(2, 2, 13, 13, -1, 0, P.mouth);
  box(3, 3, 14, 14, 0, 0, options.skin);
};
