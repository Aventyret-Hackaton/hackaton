const GLYPH_WIDTH = 3;
const GLYPH_GAP = 1;

const GLYPHS: Record<string, readonly string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  I: [".#.", "...", ".#.", ".#.", ".#."],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
};

// Calls plot for every lit pixel; row 0 is the top row of the text.
export const drawText = (
  text: string,
  plot: (column: number, row: number) => void,
): void => {
  Array.from(text).forEach((character, index) => {
    const glyph = GLYPHS[character];
    if (!glyph) return;
    glyph.forEach((line, row) => {
      Array.from(line).forEach((pixel, column) => {
        if (pixel === "#")
          plot(index * (GLYPH_WIDTH + GLYPH_GAP) + column, row);
      });
    });
  });
};
