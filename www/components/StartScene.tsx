'use client';

import { useEffect, useState, type ReactNode } from 'react';

import styles from './StartScene.module.css';

// --- Line-art sprites, each drawn centred on its own (0,0) ---

const Walker = (): React.JSX.Element => (
  <g>
    <circle className={`${styles.ink} ${styles.fillPaper}`} cx={0} cy={-13} r={3.4} />
    <path className={styles.ink} d="M0 -9 V1" />
    <path className={styles.ink} d="M-6 -5 L0 -7 L6 -4" />
    <path className={styles.ink} d="M-5 9 L0 1 L5 8" />
  </g>
);

const Cyclist = (): React.JSX.Element => (
  <g>
    <circle className={`${styles.ink} ${styles.fillPaper}`} cx={-9} cy={7} r={5.5} />
    <circle className={`${styles.ink} ${styles.fillPaper}`} cx={9} cy={7} r={5.5} />
    <path className={styles.rust} d="M-9 7 L0 1 L9 7 M0 1 L-4 -3 L4 -3 M9 7 L5 -3" />
    <circle className={`${styles.ink} ${styles.fillPaper}`} cx={-1} cy={-8} r={3} />
    <path className={styles.ink} d="M-1 -5 L0 1 M-1 -4 L5 -3" />
  </g>
);

const Car = (): React.JSX.Element => (
  <g>
    <path className={`${styles.ink} ${styles.fillPaper}`} d="M-15 5 L-12 -2 Q-10 -6 -5 -6 L5 -6 Q9 -6 11 -2 L14 5 Z" />
    <path className={styles.rust} d="M-11 1 L11 1" />
    <circle className={`${styles.ink} ${styles.fillPaper}`} cx={-8} cy={6} r={3.2} />
    <circle className={`${styles.ink} ${styles.fillPaper}`} cx={8} cy={6} r={3.2} />
  </g>
);

const Tram = (): React.JSX.Element => (
  <g>
    <rect className={`${styles.ink} ${styles.fillPaper}`} x={-14} y={-9} width={28} height={20} rx={3} />
    <rect className={styles.ink} x={-10} y={-5} width={5} height={5} />
    <rect className={styles.ink} x={-2.5} y={-5} width={5} height={5} />
    <rect className={styles.ink} x={5} y={-5} width={5} height={5} />
    <path className={styles.rust} d="M-14 4 H14" />
    <path className={styles.ink} d="M0 -9 L0 -16 L9 -18" />
    <circle className={`${styles.ink} ${styles.fillPaper}`} cx={-8} cy={13} r={2.4} />
    <circle className={`${styles.ink} ${styles.fillPaper}`} cx={8} cy={13} r={2.4} />
  </g>
);

const Boat = (): React.JSX.Element => (
  <g>
    <path className={`${styles.ink} ${styles.fillPaper}`} d="M-13 5 Q0 13 13 5 L11 2 L-11 2 Z" />
    <path className={styles.ink} d="M0 2 V-15" />
    <path className={`${styles.rust} ${styles.fillPaper}`} d="M1 -14 L10 1 L1 1 Z" />
  </g>
);

const Plane = (): React.JSX.Element => (
  <g>
    <path className={`${styles.ink} ${styles.fillPaper}`} d="M16 0 L2 -3 L-8 -3 L-14 -8 L-6 -2 L-15 -2 L-16 0 L-15 2 L-6 2 L-14 8 L-8 3 L2 3 Z" />
  </g>
);

const Balloon = (): React.JSX.Element => (
  <g>
    <path className={`${styles.rust} ${styles.fillPaper}`} d="M0 -20 C9 -20 11 -8 5 1 L-5 1 C-11 -8 -9 -20 0 -20 Z" />
    <path className={styles.rust} d="M0 -20 V1 M-4 -18 Q-7 -9 -3 1 M4 -18 Q7 -9 3 1" />
    <rect className={`${styles.ink} ${styles.fillPaper}`} x={-3} y={6} width={6} height={5} />
    <path className={styles.ink} d="M-4 1 L-3 6 M4 1 L3 6" />
  </g>
);

type TravelerProps = {
  sprite: ReactNode;
  path: string;
  dur: string;
  begin: string;
  rotate: 'auto' | '0';
  rest: [number, number];
  animate: boolean;
};

const Traveler = ({ sprite, path, dur, begin, rotate, rest, animate }: TravelerProps): React.JSX.Element => {
  if (!animate) {
    return (
      <g transform={`translate(${rest[0]} ${rest[1]})`}>
        <g transform="scale(1.5)">{sprite}</g>
      </g>
    );
  }
  return (
    <g>
      <g transform="scale(1.5)">{sprite}</g>
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" rotate={rotate}>
        <mpath href={path} xlinkHref={path} />
      </animateMotion>
    </g>
  );
};

const ROUTE = 'M150 400 C150 210 360 150 600 160 C840 170 1050 220 1050 400 C1050 560 840 640 600 645 C360 650 150 590 150 400 Z';
const SEA = 'M-60 735 q70 -26 140 0 t140 0 t140 0 t140 0 t140 0 t140 0 t140 0';
const SKY = 'M-80 160 Q600 40 1280 170';
const BALLOON_PATH = 'M1000 720 C1030 520 950 360 1000 150';

const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
};

type StartSceneProps = {
  children: ReactNode;
};

export const StartScene = ({ children }: StartSceneProps): React.JSX.Element => {
  const animate = !useReducedMotion();

  return (
    <div className={styles.scene}>
      <svg className={styles.map} viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path id="route" className={styles.route} d={ROUTE} />
        <path id="sea" className={styles.trailSea} d={SEA} />
        <path id="sky" d={SKY} fill="none" stroke="none" />
        <path id="balloon" d={BALLOON_PATH} fill="none" stroke="none" />

        <circle className={styles.ring} cx={320} cy={250} r={34} />
        <circle className={styles.ring} cx={300} cy={250} r={20} />
        <circle className={styles.ring} cx={930} cy={560} r={30} />

        <text className={styles.label} x={600} y={70} textAnchor="middle">
          Terra incognita
        </text>

        <Traveler sprite={<Car />} path="#route" dur="34s" begin="0s" rotate="0" rest={[600, 645]} animate={animate} />
        <Traveler sprite={<Tram />} path="#route" dur="46s" begin="-16s" rotate="0" rest={[1050, 400]} animate={animate} />
        <Traveler sprite={<Cyclist />} path="#route" dur="40s" begin="-28s" rotate="0" rest={[600, 160]} animate={animate} />
        <Traveler sprite={<Walker />} path="#route" dur="58s" begin="-9s" rotate="0" rest={[150, 400]} animate={animate} />
        <Traveler sprite={<Plane />} path="#sky" dur="24s" begin="-6s" rotate="auto" rest={[600, 95]} animate={animate} />
        <Traveler sprite={<Boat />} path="#sea" dur="50s" begin="-20s" rotate="0" rest={[220, 722]} animate={animate} />
        <Traveler sprite={<Balloon />} path="#balloon" dur="70s" begin="-30s" rotate="0" rest={[1000, 160]} animate={animate} />
      </svg>

      {children}
    </div>
  );
};
