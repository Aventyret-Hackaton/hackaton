'use client';

import { useEffect, useState } from 'react';

import { APP_TAGLINE, APP_TITLE } from '@/lib/globe/journey';

import styles from './GlobeView.module.css';
import { pixelFont } from './pixelFont';
import type { GlobeStatus } from './scene';
import { TravelDirective } from './TravelDirective';
import { VoxelGlobe } from './VoxelGlobe';
import type { KeyHint } from './VoxelGlobe';

const SCANLINE_HINT: readonly KeyHint[] = [['C', 'scanlines av / på']];

// Standalone demo of the voxel globe, running on its own clock.
export const GlobeView = (): React.JSX.Element => {
  const [legIndex, setLegIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [scanlines, setScanlines] = useState(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      if (!modified && !event.repeat && event.key.toLowerCase() === 'c') {
        setScanlines((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <main className={`${pixelFont.variable} ${styles.root} ${scanlines ? styles.scanlines : ''}`}>
      <header className={styles.header}>
        <span className={styles.stripes} aria-hidden="true" />
        <h1 className={styles.title}>{APP_TITLE}</h1>
        <span className={styles.stripes} aria-hidden="true" />
      </header>

      <TravelDirective currentLeg={finished ? null : legIndex} />

      <section className={styles.stage} aria-label="Jordklotet">
        <VoxelGlobe className={styles.globe} extraHints={SCANLINE_HINT} onLegChange={setLegIndex} onStatusChange={(status: GlobeStatus): void => setFinished(status.finished)} />
        <div className={styles.caption}>
          <span className={styles.captionRoute}>
            A <span className={styles.captionArrow}>→</span> B
          </span>
          <span>{APP_TAGLINE}</span>
        </div>
      </section>
    </main>
  );
};
