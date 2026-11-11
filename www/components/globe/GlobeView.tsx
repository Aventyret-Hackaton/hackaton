'use client';

import { useState } from 'react';

import styles from './GlobeView.module.css';
import { pixelFont } from './pixelFont';
import { RouteCaption } from './RouteCaption';
import { SCANLINE_HINT, ScanlineOverlay } from './ScanlineOverlay';
import type { GlobeStatus } from './scene';
import { TitleBar } from './TitleBar';
import { LEG_STEPS, TravelDirective } from './TravelDirective';
import { VoxelGlobe } from './VoxelGlobe';

// Standalone demo of the voxel globe, running on its own clock.
export const GlobeView = (): React.JSX.Element => {
  const [legIndex, setLegIndex] = useState(0);
  const [finished, setFinished] = useState(false);

  return (
    <main className={`${pixelFont.variable} ${styles.root}`}>
      <TitleBar />
      <TravelDirective steps={LEG_STEPS} currentStep={finished ? null : legIndex} />
      <section className={styles.stage} aria-label="Jordklotet">
        <VoxelGlobe className={styles.globe} extraHints={SCANLINE_HINT} onLegChange={setLegIndex} onStatusChange={(status: GlobeStatus): void => setFinished(status.finished)} />
        <RouteCaption />
      </section>
      <ScanlineOverlay />
    </main>
  );
};
