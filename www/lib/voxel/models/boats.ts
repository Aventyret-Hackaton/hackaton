import { paintMiniFigure } from "../figure";
import type { VoxelGrid } from "../grid";
import type { VoxelModelDef } from "../model";
import { P } from "../palette";

const CONTAINER_COLORS = [
  P.coral,
  P.mint,
  P.yellow,
  P.blue,
  P.ochre,
  P.cream,
  P.pink,
] as const;

// Filled rectangle on one layer with the corners stepped off.
const paintRoundedLayer = (
  g: VoxelGrid,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  cut: number,
  color: number,
): void => {
  for (let x = x0; x <= x1; x += 1) {
    for (let z = z0; z <= z1; z += 1) {
      const fromCorner = Math.min(x - x0, x1 - x) + Math.min(z - z0, z1 - z);
      if (fromCorner >= cut) g.set(x, y, z, color);
    }
  }
};

const paintCruiser = (g: VoxelGrid): void => {
  g.fill(2, 18, 0, 0, 1, 7, P.deepBlue);
  for (const y of [1, 2]) {
    g.fill(0, 18, y, y, 0, 8, P.white);
    g.fill(19, 19, y, y, 1, 7, P.white);
    g.fill(20, 20, y, y, 2, 6, P.white);
  }
  g.fill(21, 21, 2, 2, 3, 5, P.white);
  g.fill(0, 18, 2, 2, 0, 0, P.blue);
  g.fill(0, 18, 2, 2, 8, 8, P.blue);
  g.fill(0, 0, 2, 2, 0, 8, P.blue);
  g.fill(1, 8, 2, 2, 1, 7, P.wood);

  g.fill(0, 8, 3, 3, 0, 0, P.white);
  g.fill(0, 8, 3, 3, 8, 8, P.white);
  g.fill(0, 0, 3, 3, 0, 8, P.white);

  g.fill(9, 15, 3, 5, 1, 7, P.white);
  g.fill(10, 14, 4, 4, 1, 1, P.glass);
  g.fill(10, 14, 4, 4, 7, 7, P.glass);
  g.fill(15, 15, 4, 5, 2, 6, P.sky);
  g.fill(8, 16, 6, 6, 0, 8, P.cream);
  g.fill(17, 18, 3, 3, 3, 5, P.steel);

  g.fill(5, 5, 1, 2, -1, -1, P.coral);
  g.fill(12, 12, 1, 2, 9, 9, P.coral);

  g.fill(0, 0, 4, 9, 7, 7, P.steel);
  g.fill(-3, -1, 7, 9, 7, 7, P.blue);
  g.fill(-3, -1, 8, 8, 7, 7, P.yellow);
  g.fill(-2, -2, 7, 9, 7, 7, P.yellow);

  paintMiniFigure(g, 3, 3, 3, {
    skin: P.skinLight,
    hair: P.hairBlond,
    top: P.coral,
    bottom: P.deepBlue,
    shoes: P.dark,
    arms: "point",
    mouthOpen: true,
  });
  paintMiniFigure(g, 7, 3, 5, {
    skin: P.skinBrown,
    hair: P.hairDark,
    top: P.mint,
    bottom: P.khaki,
    shoes: P.dark,
    facing: -1,
    arms: "up",
    mouthOpen: true,
  });
};

const paintRaft = (g: VoxelGrid): void => {
  for (let log = 0; log < 5; log += 1) {
    const start = log % 2 === 0 ? 0 : -1;
    const end = log % 3 === 0 ? 15 : 16;
    const z = log * 2;
    g.fill(start, end, 0, 1, z, z + 1, log % 2 === 0 ? P.wood : P.darkWood);
    g.fill(start, start, 0, 1, z, z + 1, P.straw);
    g.fill(end, end, 0, 1, z, z + 1, P.straw);
  }
  g.fill(2, 2, 2, 2, 0, 9, P.darkWood);
  g.fill(13, 13, 2, 2, 0, 9, P.darkWood);

  g.fill(9, 9, 2, 14, 5, 5, P.darkWood);
  g.fill(9, 9, 13, 13, 0, 9, P.wood);
  g.fill(10, 10, 5, 12, 1, 8, P.cream);
  g.fill(11, 11, 7, 10, 3, 6, P.cream);
  g.fill(10, 10, 6, 7, 2, 3, P.coral);
  g.fill(10, 10, 10, 11, 6, 7, P.ochre);
  g.fill(7, 8, 14, 14, 5, 5, P.coral);

  g.fill(12, 14, 2, 3, 1, 3, P.ochre);
  g.fill(12, 14, 4, 4, 1, 3, P.darkWood);

  g.set(1, 2, 8, P.dark);
  g.set(0, 3, 8, P.dark);
  g.set(-1, 4, 8, P.dark);
  g.set(-2, 5, 8, P.dark);
  g.fill(-3, -3, 1, 4, 8, 8, P.cream);

  paintMiniFigure(g, 5, 2, 4, {
    skin: P.skinTan,
    hair: P.hairRed,
    top: P.white,
    bottom: P.blue,
    shoes: P.skinTan,
    seated: true,
    hat: P.straw,
  });
};

const paintSwan = (g: VoxelGrid): void => {
  paintRoundedLayer(g, 1, 12, 1, 9, 0, 2, P.shade);
  for (const y of [1, 2, 3]) paintRoundedLayer(g, 0, 13, 0, 10, y, 3, P.white);
  paintRoundedLayer(g, 0, 13, 0, 10, 4, 3, P.white);
  g.clear(3, 10, 2, 4, 3, 7);
  g.fill(3, 4, 2, 2, 3, 7, P.coral);
  g.fill(3, 3, 3, 4, 3, 7, P.coral);

  for (const z of [-1, 11]) {
    g.fill(2, 9, 2, 4, z, z, P.shade);
    g.fill(2, 6, 5, 5, z, z, P.white);
    g.fill(2, 3, 6, 6, z, z, P.white);
  }

  g.fill(-1, 0, 3, 5, 4, 6, P.white);
  g.fill(-2, -1, 5, 6, 4, 6, P.white);
  g.set(-2, 7, 5, P.white);

  g.fill(10, 12, 4, 6, 4, 6, P.white);
  g.fill(11, 12, 7, 10, 4, 6, P.white);
  g.fill(12, 13, 11, 12, 4, 6, P.white);
  g.fill(12, 15, 13, 15, 4, 6, P.white);
  g.fill(15, 15, 14, 14, 4, 6, P.black);
  g.set(14, 14, 4, P.black);
  g.set(14, 14, 6, P.black);
  g.fill(16, 16, 13, 14, 4, 6, P.orange);
  g.set(17, 13, 5, P.orange);

  paintMiniFigure(g, 5, 2, 5, {
    skin: P.skinBrown,
    hair: P.hairDark,
    top: P.yellow,
    bottom: P.blue,
    shoes: P.dark,
    seated: true,
    shades: true,
  });
};

const paintFlamingo = (g: VoxelGrid): void => {
  paintRoundedLayer(g, 1, 11, 1, 11, 0, 2, P.pinkDark);
  paintRoundedLayer(g, 0, 12, 0, 12, 1, 3, P.pink);
  paintRoundedLayer(g, 0, 12, 0, 12, 2, 3, P.pink);
  paintRoundedLayer(g, 1, 11, 1, 11, 3, 2, P.pinkLight);
  g.clear(4, 8, 0, 3, 4, 8);
  g.fill(4, 8, 0, 0, 4, 8, P.sky);

  for (const z of [0, 11]) {
    g.fill(3, 8, 4, 5, z, z + 1, P.pinkDark);
    g.fill(3, 5, 6, 6, z, z + 1, P.pinkDark);
  }
  g.fill(-1, 0, 2, 4, 5, 7, P.pinkLight);
  g.fill(-2, -1, 4, 5, 6, 6, P.pinkLight);

  g.fill(10, 12, 4, 6, 5, 7, P.pink);
  g.fill(11, 13, 7, 10, 5, 7, P.pink);
  g.fill(12, 14, 11, 12, 5, 7, P.pink);
  g.fill(12, 15, 13, 15, 5, 7, P.pinkLight);
  g.set(14, 14, 5, P.black);
  g.set(14, 14, 7, P.black);
  g.fill(16, 16, 13, 14, 5, 7, P.cream);
  g.fill(16, 17, 11, 12, 6, 6, P.black);

  paintMiniFigure(g, 5, 1, 6, {
    skin: P.skinLight,
    hair: P.hairRed,
    top: P.mint,
    bottom: P.coral,
    shoes: P.skinLight,
    seated: true,
    shades: true,
  });
  g.fill(7, 10, 4, 4, 5, 5, P.skinLight);
  g.fill(7, 10, 4, 4, 7, 7, P.skinLight);
  g.fill(5, 5, 4, 5, 10, 10, P.yellow);
  g.set(5, 6, 10, P.coral);
};

const containerStackHeight = (bay: number, row: number): number =>
  2 + ((bay * 3 + row * 5 + bay * row) % 3);

const paintShip = (g: VoxelGrid): void => {
  g.fill(1, 32, 0, 1, 1, 8, P.darkRed);
  for (const y of [2, 3, 4]) {
    g.fill(0, 32, y, y, 0, 9, P.deepBlue);
    g.fill(33, 33, y, y, 1, 8, P.deepBlue);
    g.fill(34, 34, y, y, 2, 7, P.deepBlue);
  }
  g.fill(35, 35, 3, 4, 3, 6, P.deepBlue);
  g.fill(1, 31, 4, 4, 1, 8, P.steel);
  g.fill(30, 32, 5, 5, 1, 8, P.deepBlue);
  g.fill(33, 34, 5, 5, 2, 7, P.deepBlue);

  g.fill(1, 2, 5, 9, 3, 6, P.coral);
  g.fill(1, 2, 10, 10, 3, 6, P.black);
  g.fill(3, 8, 5, 10, 1, 8, P.white);
  g.fill(8, 8, 9, 9, 1, 8, P.glass);
  for (const z of [1, 8]) {
    g.fill(4, 7, 7, 7, z, z, P.glass);
    g.fill(4, 7, 9, 9, z, z, P.glass);
  }
  g.fill(5, 8, 11, 11, 0, 9, P.white);
  g.fill(6, 6, 12, 14, 4, 5, P.steel);
  g.fill(5, 7, 13, 13, 4, 5, P.steel);

  for (let bay = 0; bay < 4; bay += 1) {
    for (let row = 0; row < 4; row += 1) {
      const x = 10 + bay * 5;
      const z = 1 + row * 2;
      const height = containerStackHeight(bay, row);
      for (let level = 0; level < height; level += 1) {
        const color =
          CONTAINER_COLORS[
            (bay * 4 + row + level * 3) % CONTAINER_COLORS.length
          ];
        g.fill(x, x + 3, 5 + level * 2, 6 + level * 2, z, z + 1, color);
      }
    }
  }

  const hitcherY = 5 + containerStackHeight(3, 1) * 2;
  g.fill(25, 28, hitcherY - 2, hitcherY - 1, 2, 5, P.mint);
  g.fill(24, 24, hitcherY, hitcherY + 2, 3, 5, P.coral);
  paintMiniFigure(g, 26, hitcherY, 4, {
    skin: P.skinTan,
    hair: P.hairDark,
    top: P.yellow,
    bottom: P.dark,
    shoes: P.dark,
    seated: true,
    arms: "point",
  });
};

export const BOAT_MODELS = {
  cruiser: {
    id: "cruiser",
    label: "Fritidsbåt med grälande par",
    paint: paintCruiser,
  },
  raft: { id: "raft", label: "Flotte", paint: paintRaft },
  swan: { id: "swan", label: "Svantrampbåt", paint: paintSwan },
  flamingo: { id: "flamingo", label: "Badflamingo", paint: paintFlamingo },
  ship: { id: "ship", label: "Containerfartyg", paint: paintShip },
} satisfies Record<string, VoxelModelDef>;
