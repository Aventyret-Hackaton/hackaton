'use client';

import { useEffect, useRef } from 'react';

import { createStreetScene, type Traveller } from './streetScene';
import styles from './StreetView.module.css';

type StreetViewProps = {
  title: string;
  detail?: string;
  getTraveller: () => Traveller;
};

export const StreetView = ({ title, detail, getTraveller }: StreetViewProps): React.JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const getTravellerRef = useRef(getTraveller);

  useEffect(() => {
    getTravellerRef.current = getTraveller;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const scene = createStreetScene({
      canvas,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      getTraveller: (): Traveller => getTravellerRef.current()
    });
    return (): void => scene.dispose();
  }, []);

  return (
    <div>
      <div className={styles.viewport}>
        <canvas ref={canvasRef} className={styles.canvas} aria-label="Påhittad gatuvy i voxelstil, sedd bakom resenären" />
      </div>
      <p className={styles.caption}>
        <span className={styles.title}>{title}</span>
        {detail && <span>{detail}</span>}
      </p>
    </div>
  );
};
