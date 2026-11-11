import type { VoxelGrid } from '@/lib/voxel/grid';
import type { VoxelModelDef } from '@/lib/voxel/model';
import { P } from '@/lib/voxel/palette';

import { CHIBI_STEPS, type ChibiLook, paintChibi, raised } from './chibi';
import { fillRounded, speckled } from './shapes';

const GOLD = 0xf2c230;
const HOODIE = 0x74d6a4;
const HOODIE_DARK = 0x57b98a;
const CAP = 0x8be0b2;
const CAP_DARK = 0x5fc392;
const DECK = 0x24304d;
const WHEEL = 0xf08fb4;
const COAT = 0xe3c088;
const COAT_DARK = 0xc9a56c;
const BEANIE = 0xcf3d38;
const BEANIE_DARK = 0xa92f2c;
const HEADPHONES = 0x3a3f4a;
const PURPLE = 0x9a6ad6;
const PURPLE_DARK = 0x8257bf;
const PACK = 0x7a5a3a;
const PACK_DARK = 0x5c432b;

const SKATER: ChibiLook = { skin: 0xb26f40, top: HOODIE, bottom: 0x35333d, shoes: P.white, sole: 0xc9ced6 };
const ELDER: ChibiLook = { skin: 0xd9a066, top: COAT, bottom: 0x6a4a3a, shoes: 0x4a342a };
const COMMUTER: ChibiLook = { skin: 0xf2c9a2, top: 0x2e3a5c, bottom: 0x4b4b55, shoes: 0x2b2b33 };
const SUPPORTER: ChibiLook = { skin: 0xf2c9a2, top: P.blue, bottom: 0x6b4a2f, shoes: 0x3a2a20, sole: 0x2a1d17 };
const HIKER: ChibiLook = { skin: 0xf2c9a2, top: 0x8f2f3d, bottom: 0x2f3340, shoes: 0x3b2f2a };

const SKATER_FRAMES = 16;
const COMMUTER_FRAMES = 24;
const SUPPORTER_FRAMES = 16;

// Stands on its tail beside the right leg, underside out, with a truck and two wheels at each end.
const paintSkateboard = (g: VoxelGrid): void => {
  g.fill(1, 1, 1, 14, 7, 13, P.yellow);
  g.fill(1, 1, 0, 15, 8, 12, P.yellow);
  g.fill(1, 1, 1, 14, 8, 12, DECK);
  g.fill(1, 1, 7, 7, 9, 11, P.yellow);
  g.set(1, 8, 9, P.yellow);
  g.set(1, 8, 11, P.yellow);
  for (const y of [2, 12]) {
    g.fill(2, 2, y, y + 1, 8, 12, P.steel);
    for (const z of [6, 13]) {
      g.fill(2, 3, y, y + 1, z, z + 1, WHEEL);
      g.set(3, y, z, P.pinkLight);
    }
  }
};

const paintSkater = (g: VoxelGrid, frame: number): void => {
  const up = paintChibi(g, SKATER, { lift: Math.floor(frame / 4) % 2, blink: frame === 9, toesUp: frame === 5 || frame === 7 });
  const body = raised(g, up);
  const curls = speckled(0x3b2318, 0x52301f, 0.3);

  body(-4, -4, 14, 18, -3, 3, HOODIE_DARK);
  body(2, 2, 10, 12, -3, 3, HOODIE_DARK);
  for (const z of [-1, 1]) body(2, 2, 13, 16, z, z, P.white);

  fillRounded(g, -7, -2, 15 + up, 28 + up, -8, 8, curls);
  for (const side of [-1, 1]) {
    fillRounded(g, -3, 2, 16 + up, 26 + up, Math.min(side * 6, side * 9), Math.max(side * 6, side * 9), curls);
    body(3, 3, 19, 21, side * 7, side * 7, GOLD);
  }

  fillRounded(g, -6, 5, 27 + up, 31 + up, -6, 6, CAP);
  body(6, 9, 27, 27, -5, 5, CAP_DARK);
  body(5, 5, 28, 28, -2, 2, P.white);
  for (const z of [-2, 0, 2]) body(5, 5, 29, 29, z, z, P.white);

  paintSkateboard(g);
};

const paintElder = (g: VoxelGrid, step: number): void => {
  const up = paintChibi(g, ELDER, { step, shuffle: true, right: 'low', blink: step % 4 === 3 });
  const body = raised(g, up);
  const perm = speckled(0xc9c9cf, 0xe2e2e6, 0.35);

  body(-3, 2, 6, 8, -4, 4, COAT);
  body(2, 2, 7, 15, 0, 0, COAT_DARK);
  body(-4, 3, 16, 17, -5, 5, P.red);
  body(3, 3, 12, 15, 1, 2, P.red);

  fillRounded(g, -6, 5, 26 + up, 31 + up, -7, 7, perm);
  fillRounded(g, -7, -3, 18 + up, 28 + up, -7, 7, perm);
  for (const side of [-1, 1]) {
    fillRounded(g, -4, 1, 21 + up, 27 + up, Math.min(side * 6, side * 8), Math.max(side * 6, side * 8), perm);
    body(2, 2, 20, 21, side * 7, side * 7, GOLD);
  }

  // The cane leans ahead while the hand passes it.
  const lean = step % CHIBI_STEPS < CHIBI_STEPS / 2 ? 1 : 0;
  g.fill(4 + lean, 4 + lean, 0, 4, 6, 6, P.darkWood);
  g.fill(4, 4, 5, 8, 6, 6, P.darkWood);
  g.fill(3, 5, 12, 12, 6, 6, P.darkWood);
};

const paintCommuter = (g: VoxelGrid, frame: number): void => {
  const sipping = frame >= 13 && frame <= 17;
  const up = paintChibi(g, COMMUTER, { right: sipping ? 'sip' : 'bent', blink: frame === 5 || frame === 21 });
  const body = raised(g, up);

  body(2, 2, 10, 17, -1, 1, P.white);
  body(-4, -4, 16, 18, -4, 4, HEADPHONES);
  for (const side of [-1, 1]) {
    body(2, 3, 15, 18, Math.min(side * 3, side * 5), Math.max(side * 3, side * 5), HEADPHONES);
    body(-3, 1, 18, 18, side * 5, side * 5, HEADPHONES);
    body(-4, 1, 22, 25, side * 6, side * 6, P.hairDark);

    // Glasses, one voxel in front of the face.
    const inner = side;
    const outer = side * 5;
    body(6, 6, 25, 25, Math.min(inner, outer), Math.max(inner, outer), P.black);
    body(6, 6, 21, 21, Math.min(inner, outer), Math.max(inner, outer), P.black);
    body(6, 6, 22, 24, inner, inner, P.black);
    body(6, 6, 22, 24, outer, outer, P.black);
  }
  body(6, 6, 24, 24, 0, 0, P.black);
  body(-5, -5, 20, 25, -5, 5, P.hairDark);

  fillRounded(g, -6, 6, 26 + up, 31 + up, -7, 7, BEANIE);
  body(-6, 6, 26, 27, -7, 7, BEANIE_DARK);
  body(-1, 1, 32, 33, -1, 1, 0xe3524c);

  // Tote bag with a crown on it, hanging in front of the left hip.
  body(3, 4, 5, 13, -9, -3, P.cream);
  body(4, 4, 8, 9, -7, -5, P.blue);
  for (const z of [-7, -5]) body(4, 4, 10, 10, z, z, P.blue);
  for (const z of [-7, -4]) body(2, 3, 14, 17, z, z, P.cream);

  const [x, y, z] = sipping ? [7, 19, 1] : [6, 16, 5];
  body(x, x + 2, y, y + 4, z, z + 2, P.white);
  body(x, x + 2, y + 1, y + 2, z, z + 2, P.wood);
  if (sipping) return;
  for (let puff = 0; puff < 3; puff += 1) {
    const age = (frame + puff * 2) % 6;
    const drift = x + 1 + ((age + puff) % 2);
    body(drift, drift, y + 6 + age, y + 6 + age, z + 1, z + 1, P.white);
  }
};

const paintSupporter = (g: VoxelGrid, frame: number): void => {
  const waving = frame >= 8 && frame < 14;
  const up = paintChibi(g, SUPPORTER, {
    seated: true,
    lift: frame % 8 < 4 ? 0 : 1,
    right: 'low',
    left: waving ? 'up' : 'low',
    wave: frame % 2 === 0 ? -1 : 1,
    blink: frame === 3
  });
  const body = raised(g, up);

  body(-7, -4, 9, 17, -4, 4, 0x24478f);
  body(-8, -8, 10, 14, -2, 2, P.deepBlue);
  for (let z = -5; z <= 5; z += 1) body(-4, 3, 16, 17, z, z, Math.floor((z + 5) / 2) % 2 === 0 ? P.blue : P.yellow);
  for (let y = 10; y <= 15; y += 1) body(3, 3, y, y, 1, 3, Math.floor(y / 2) % 2 === 0 ? P.yellow : P.blue);

  body(-5, -5, 20, 26, -5, 5, P.hairBlond);
  for (const z of [-6, 6]) body(-4, 1, 22, 26, z, z, P.hairBlond);
  fillRounded(g, -6, 5, 27 + up, 31 + up, -6, 6, P.blue);
  body(6, 9, 27, 27, -5, 5, P.deepBlue);
  body(5, 5, 28, 29, -1, 1, P.yellow);
};

const paintHiker = (g: VoxelGrid, step: number): void => {
  const up = paintChibi(g, HIKER, { step });
  const body = raised(g, up);
  const bob = speckled(PURPLE, PURPLE_DARK, 0.25);

  fillRounded(g, -6, 5, 26 + up, 30 + up, -7, 7, bob);
  fillRounded(g, -7, -3, 17 + up, 28 + up, -7, 7, bob);
  for (const z of [-7, 7]) body(-3, 2, 19, 27, z, z, PURPLE);
  body(5, 5, 26, 26, -5, 5, PURPLE);
  body(5, 5, 25, 25, 2, 5, PURPLE);

  body(-7, -4, 9, 17, -3, 3, PACK);
  body(-8, -8, 10, 13, -2, 2, PACK_DARK);
  for (const z of [-3, 3]) body(2, 2, 12, 17, z, z, PACK_DARK);
};

export const START_PEOPLE = {
  skater: {
    id: 'start-skater',
    label: 'Skejtare',
    paint: (g): void => paintSkater(g, 0),
    sequence: { frames: SKATER_FRAMES, framesPerSecond: 4, paint: paintSkater }
  },
  elder: {
    id: 'start-elder',
    label: 'Dam med käpp',
    paint: (g): void => paintElder(g, 2),
    sequence: { frames: CHIBI_STEPS, framesPerSecond: 5, paint: paintElder }
  },
  commuter: {
    id: 'start-commuter',
    label: 'Pendlare med kaffe',
    paint: (g): void => paintCommuter(g, 0),
    sequence: { frames: COMMUTER_FRAMES, framesPerSecond: 4, paint: paintCommuter }
  },
  supporter: {
    id: 'start-supporter',
    label: 'Supporter',
    paint: (g): void => paintSupporter(g, 0),
    sequence: { frames: SUPPORTER_FRAMES, framesPerSecond: 4, paint: paintSupporter }
  },
  hiker: {
    id: 'start-hiker',
    label: 'Vandrare',
    paint: (g): void => paintHiker(g, 2),
    sequence: { frames: CHIBI_STEPS, framesPerSecond: 10, paint: paintHiker }
  }
} satisfies Record<string, VoxelModelDef>;
