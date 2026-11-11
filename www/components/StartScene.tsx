'use client';

import { type ReactNode, useEffect, useRef } from 'react';

import { APP_TITLE } from '@/lib/globe/journey';

import { createStartBackdrop } from './startBackdrop';
import styles from './StartScene.module.css';

type StartSceneProps = {
  children: ReactNode;
};

// The scene fills the window. The board keeps the proportions of the picture
// that the scene recreates, so the panel stays in its place over it.
export const StartScene = ({ children }: StartSceneProps): React.JSX.Element => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) {
      return;
    }
    try {
      const backdrop = createStartBackdrop({ canvas, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches });
      return (): void => backdrop.dispose();
    } catch {
      // Without WebGL the stage shows a plain sky and the name as text.
      stage.dataset.flat = '';
    }
  }, []);

  return (
    <div ref={stageRef} className={styles.stage}>
      <canvas ref={canvasRef} className={styles.backdrop} aria-hidden="true" />
      <div className={styles.board}>
        <h1 className={styles.name}>{APP_TITLE}</h1>
        {children}
      </div>
    </div>
  );
};
