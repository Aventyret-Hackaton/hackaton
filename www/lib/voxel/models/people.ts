import { paintBigFigure, WALK_STEPS, walkLeftSwing, walkRise } from '../figure';
import type { VoxelGrid } from '../grid';
import type { VoxelModelDef } from '../model';
import { P } from '../palette';

type Box = readonly [x0: number, x1: number, y0: number, y1: number];
type Spot = readonly [x: number, y: number, z: number];

const SWIM_FRAMES = 8;
// One arm through a crawl stroke, from reaching ahead to going back in, seen from the side.
const STROKE: readonly (readonly Box[])[] = [
  [[12, 19, 3, 3]],
  [[12, 18, 2, 2]],
  [[12, 15, 1, 1]],
  [[9, 12, 1, 1]],
  [[6, 11, 2, 2]],
  [
    [9, 12, 4, 4],
    [8, 8, 3, 3]
  ],
  [
    [12, 12, 4, 4],
    [11, 14, 5, 5],
    [15, 15, 4, 4]
  ],
  [
    [12, 17, 4, 4],
    [18, 18, 3, 3]
  ]
];
// Splashes where a hand goes in, by the step of that arm's stroke.
const HAND_SPLASH: Record<number, readonly (readonly [x: number, y: number, out: number])[]> = {
  0: [
    [21, 4, 0],
    [22, 2, 0],
    [20, 1, 1]
  ],
  7: [
    [19, 5, 0],
    [20, 4, 1]
  ]
};
const KICK_SPLASH: readonly (readonly Spot[])[] = [
  [
    [-2, 3, 2],
    [-1, 5, 3],
    [-3, 2, 4],
    [-2, 4, 5],
    [-4, 1, 3]
  ],
  [
    [-1, 4, 2],
    [-3, 3, 3],
    [-2, 5, 4],
    [-4, 2, 5],
    [-2, 1, 4]
  ]
];

const paintSwimmer = (g: VoxelGrid, frame: number): void => {
  const kick = Math.floor(frame / 2) % 2;
  g.fill(-3, 19, 0, 0, 0, 7, P.blue);
  g.fill(-4, 20, 0, 0, 1, 6, P.blue);

  g.fill(0, 4, 2 - kick, 3 - kick, 2, 3, P.skinLight);
  g.fill(0, 4, 1 + kick, 2 + kick, 4, 5, P.skinLight);
  g.fill(5, 7, 1, 3, 2, 5, P.coral);
  g.fill(8, 12, 1, 3, 2, 5, P.skinLight);
  g.fill(13, 16, 1, 4, 2, 5, P.skinLight);
  g.fill(13, 16, 3, 4, 2, 5, P.yellow);
  g.fill(16, 16, 2, 2, 2, 5, P.black);
  g.set(16, 2, 2, P.mint);
  g.set(16, 2, 5, P.mint);

  // The arms are half a stroke apart. Side is the way out from the body.
  const paintArm = (z: number, side: number, stroke: number): void => {
    for (const [x0, x1, y0, y1] of STROKE[stroke]) g.fill(x0, x1, y0, y1, z, z, P.skinLight);
    for (const [x, y, out] of HAND_SPLASH[stroke] ?? []) g.set(x, y, z + out * side, P.foam);
  };
  paintArm(6, 1, frame % SWIM_FRAMES);
  paintArm(1, -1, (frame + SWIM_FRAMES / 2) % SWIM_FRAMES);

  for (const [x, y, z] of KICK_SPLASH[kick]) g.set(x, y, z, P.foam);

  // The tow float rides the swell behind the swimmer.
  const swell = frame % SWIM_FRAMES < SWIM_FRAMES / 2 ? 0 : 1;
  g.fill(-9, -7, 1 - swell, 2 - swell, 3, 4, P.orange);
  g.fill(-6, -4, 1, 1, 3, 3, P.cream);
};

const paintWalker = (g: VoxelGrid, step: number): void => {
  const rise = walkRise(step);
  paintBigFigure(g, {
    skin: P.skinSunburnt,
    hair: P.hairDark,
    top: P.white,
    bottom: P.khaki,
    shoes: P.ochre,
    shades: true,
    step
  });
  g.fill(-4, 4, 18 + rise, 18 + rise, -4, 4, P.straw);
  g.fill(-2, 2, 19 + rise, 20 + rise, -2, 2, P.straw);
  g.fill(-2, 2, 19 + rise, 19 + rise, -2, 2, P.coral);

  g.fill(-5, -2, 7 + rise, 13 + rise, -2, 2, P.coral);
  g.fill(-5, -2, 14 + rise, 15 + rise, -3, 3, P.mint);
  g.fill(-6, -6, 8 + rise, 10 + rise, -1, 1, P.darkRed);

  // The stick stands on the ground while the hand passes it, and is carried forward again.
  const carried = step % WALK_STEPS >= WALK_STEPS / 2;
  const stickX = walkLeftSwing(step) * 2;
  g.fill(stickX, stickX, carried ? 2 : 0, carried ? 12 : 11, 4, 4, P.darkWood);

  // Sweat runs down both sides of the face, out of step.
  g.set(4, 17 - (step % 4), -3, P.sky);
  g.set(4, 17 - ((step + 2) % 4), 3, P.sky);
};

const GLITTER: readonly (readonly Spot[])[] = [
  [
    [-2, 9, 4],
    [-1, 5, 5],
    [-3, 7, 3]
  ],
  [
    [-3, 8, 5],
    [-1, 10, 4],
    [-2, 4, 4]
  ]
];

const paintMoonwalker = (g: VoxelGrid, step: number): void => {
  paintBigFigure(g, {
    skin: P.skinBrown,
    hair: P.black,
    top: P.black,
    bottom: P.black,
    shoes: P.black,
    socks: P.white,
    glove: P.white,
    facing: -1,
    step,
    glide: true
  });
  g.fill(-1, -1, 9, 12, 0, 0, P.white);
  g.fill(-3, 3, 18, 18, -3, 3, P.black);
  g.fill(-2, 2, 19, 20, -2, 2, P.black);
  g.fill(-2, 2, 19, 19, -2, 2, P.white);

  // The glitter follows the gloved hand and twinkles.
  const hand = -2 * walkLeftSwing(step);
  for (const [x, y, z] of GLITTER[Math.floor(step / 2) % 2]) g.set(hand + x, y, z, P.yellow);
};

export const PEOPLE_MODELS = {
  swimmer: {
    id: 'swimmer',
    label: 'Simmare',
    paint: (g): void => paintSwimmer(g, 0),
    sequence: { frames: SWIM_FRAMES, framesPerSecond: 8, paint: paintSwimmer }
  },
  walker: {
    id: 'walker',
    label: 'Sahara-vandrare',
    paint: (g): void => paintWalker(g, 0),
    sequence: { frames: WALK_STEPS, framesPerSecond: 10, paint: paintWalker }
  },
  moonwalker: {
    id: 'moonwalker',
    label: 'Moonwalkare',
    paint: (g): void => paintMoonwalker(g, 0),
    sequence: { frames: WALK_STEPS, framesPerSecond: 8, paint: paintMoonwalker }
  }
} satisfies Record<string, VoxelModelDef>;
