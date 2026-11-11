import { paintBigFigure } from '../figure';
import type { VoxelGrid } from '../grid';
import type { VoxelModelDef } from '../model';
import { P } from '../palette';

const paintSwimmer = (g: VoxelGrid): void => {
  g.fill(-3, 19, 0, 0, 0, 7, P.blue);
  g.fill(-4, 20, 0, 0, 1, 6, P.blue);

  g.fill(0, 4, 2, 3, 2, 3, P.skinLight);
  g.fill(0, 4, 1, 2, 4, 5, P.skinLight);
  g.fill(5, 7, 1, 3, 2, 5, P.coral);
  g.fill(8, 12, 1, 3, 2, 5, P.skinLight);
  g.fill(13, 16, 1, 4, 2, 5, P.skinLight);
  g.fill(13, 16, 3, 4, 2, 5, P.yellow);
  g.fill(16, 16, 2, 2, 2, 5, P.black);
  g.set(16, 2, 2, P.mint);
  g.set(16, 2, 5, P.mint);

  g.fill(12, 19, 3, 3, 6, 6, P.skinLight);
  g.fill(6, 11, 2, 2, 1, 1, P.skinLight);

  const foam: readonly (readonly [number, number, number])[] = [
    [-2, 3, 2],
    [-1, 5, 3],
    [-3, 2, 4],
    [-2, 4, 5],
    [-4, 1, 3],
    [21, 4, 6],
    [22, 2, 6],
    [20, 1, 7]
  ];
  for (const [x, y, z] of foam) g.set(x, y, z, P.foam);

  g.fill(-9, -7, 1, 2, 3, 4, P.orange);
  g.fill(-6, -4, 1, 1, 3, 3, P.cream);
};

const paintWalker = (g: VoxelGrid): void => {
  paintBigFigure(g, {
    skin: P.skinSunburnt,
    hair: P.hairDark,
    top: P.white,
    bottom: P.khaki,
    shoes: P.ochre,
    shades: true
  });
  g.fill(-4, 4, 18, 18, -4, 4, P.straw);
  g.fill(-2, 2, 19, 20, -2, 2, P.straw);
  g.fill(-2, 2, 19, 19, -2, 2, P.coral);

  g.fill(-5, -2, 7, 13, -2, 2, P.coral);
  g.fill(-5, -2, 14, 15, -3, 3, P.mint);
  g.fill(-6, -6, 8, 10, -1, 1, P.darkRed);

  g.fill(2, 2, 0, 11, 4, 4, P.darkWood);
  g.set(4, 17, -3, P.sky);
  g.set(4, 15, 3, P.sky);
};

const paintMoonwalker = (g: VoxelGrid): void => {
  paintBigFigure(g, {
    skin: P.skinBrown,
    hair: P.black,
    top: P.black,
    bottom: P.black,
    shoes: P.black,
    socks: P.white,
    glove: P.white,
    facing: -1
  });
  g.fill(-1, -1, 9, 12, 0, 0, P.white);
  g.fill(-3, 3, 18, 18, -3, 3, P.black);
  g.fill(-2, 2, 19, 20, -2, 2, P.black);
  g.fill(-2, 2, 19, 19, -2, 2, P.white);

  g.set(-4, 9, 4, P.yellow);
  g.set(-3, 5, 5, P.yellow);
  g.set(-5, 7, 3, P.yellow);
};

export const PEOPLE_MODELS = {
  swimmer: { id: 'swimmer', label: 'Simmare', paint: paintSwimmer },
  walker: { id: 'walker', label: 'Sahara-vandrare', paint: paintWalker },
  moonwalker: {
    id: 'moonwalker',
    label: 'Moonwalkare',
    paint: paintMoonwalker
  }
} satisfies Record<string, VoxelModelDef>;
