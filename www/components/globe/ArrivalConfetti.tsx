'use client';

import { useEffect, useRef } from 'react';

import styles from './ArrivalConfetti.module.css';

type ArrivalConfettiProps = {
  // One burst is fired each time this turns true.
  active: boolean;
};

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  swayPhase: number;
  flipPhase: number;
  flipSpeed: number;
};

const COLORS = ['#ffe45c', '#f46b59', '#73edb5', '#ec8db4', '#fff0c2', '#8fd4ee'];
// One canvas pixel covers this many CSS pixels, for chunky confetti.
const PIXEL = 2;
const PIECES_PER_SHOT = 60;
// Seconds after arrival at which the two corners fire.
const SHOTS = [0, 0.25, 0.6];
// Gravity and launch speed are in screen heights, so every window gets the same arc.
const GRAVITY = 1.4;
const DRAG = 1.8;
const LAUNCH_MIN = 1.6;
const LAUNCH_MAX = 2.9;
const SWAY = 0.05;
const MAX_SECONDS = 8;
const FLIP_WIDTHS = [1, 0.67, 0.34, 0.67];

const between = (min: number, max: number): number => min + Math.random() * (max - min);

// Pieces leave a bottom corner aimed up and towards the middle.
const shoot = (width: number, height: number, fromLeft: boolean): Piece[] =>
  Array.from({ length: PIECES_PER_SHOT }, () => {
    const angle = between(50, 82) * (Math.PI / 180);
    const speed = between(LAUNCH_MIN, LAUNCH_MAX) * height;
    return {
      x: fromLeft ? width * 0.06 : width * 0.94,
      y: height,
      vx: Math.cos(angle) * speed * (fromLeft ? 1 : -1),
      vy: -Math.sin(angle) * speed,
      size: Math.round(between(3, 5)),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      swayPhase: between(0, Math.PI * 2),
      flipPhase: between(0, FLIP_WIDTHS.length),
      flipSpeed: between(5, 11)
    };
  });

// Square, pixel-sized confetti over the whole window when the traveller arrives.
export const ArrivalConfetti = ({ active }: ArrivalConfettiProps): React.JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!active || !canvas || !context || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const width = Math.ceil(window.innerWidth / PIXEL);
    const height = Math.ceil(window.innerHeight / PIXEL);
    canvas.width = width;
    canvas.height = height;

    let pieces: Piece[] = [];
    let fired = 0;
    let elapsed = 0;
    let previous = performance.now();
    let frame = 0;

    const tick = (now: number): void => {
      const delta = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      elapsed += delta;
      while (fired < SHOTS.length && elapsed >= SHOTS[fired]) {
        pieces = [...pieces, ...shoot(width, height, true), ...shoot(width, height, false)];
        fired += 1;
      }

      context.clearRect(0, 0, width, height);
      for (const piece of pieces) {
        piece.vx -= piece.vx * DRAG * delta;
        piece.vy += (GRAVITY * height - piece.vy * DRAG) * delta;
        piece.x += (piece.vx + Math.sin(piece.swayPhase + elapsed * 4) * SWAY * height) * delta;
        piece.y += piece.vy * delta;
        const flip = FLIP_WIDTHS[Math.floor(piece.flipPhase + elapsed * piece.flipSpeed) % FLIP_WIDTHS.length];
        const pieceWidth = Math.max(1, Math.round(piece.size * flip));
        context.fillStyle = piece.color;
        context.fillRect(Math.round(piece.x - pieceWidth / 2), Math.round(piece.y), pieceWidth, piece.size);
      }
      pieces = pieces.filter((piece) => piece.y < height + piece.size);

      const done = (fired === SHOTS.length && pieces.length === 0) || elapsed > MAX_SECONDS;
      if (done) {
        context.clearRect(0, 0, width, height);
      } else {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);

    return (): void => {
      cancelAnimationFrame(frame);
      context.clearRect(0, 0, width, height);
    };
  }, [active]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
};
