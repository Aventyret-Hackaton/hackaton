'use client';

import { useEffect, useRef, useState } from 'react';

import { LEGS } from '@/lib/globe/journey';
import { VEHICLE_MODELS } from '@/lib/voxel/models';

import { pixelFont } from './pixelFont';
import { renderModelThumbnails } from './thumbnails';
import styles from './TravelDirective.module.css';

type TravelDirectiveProps = {
  // Index of the leg being travelled, or null when none should be marked.
  currentLeg: number | null;
  className?: string;
};

const ICON_SIZE = 64;

export const TravelDirective = ({ currentLeg, className }: TravelDirectiveProps): React.JSX.Element => {
  const currentStepRef = useRef<HTMLLIElement>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});

  useEffect(() => {
    setIcons(renderModelThumbnails(Object.values(VEHICLE_MODELS), ICON_SIZE));
  }, []);

  useEffect(() => {
    currentStepRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentLeg]);

  return (
    <section className={`${pixelFont.variable} ${styles.panel} ${className ?? ''}`} aria-label="Resedirektiv">
      <h2 className={styles.title}>Resedirektiv</h2>
      <ol className={styles.steps}>
        {LEGS.map((step, index) => {
          const current = index === currentLeg;
          return (
            <li
              key={step.id}
              ref={current ? currentStepRef : undefined}
              className={`${styles.step} ${current ? styles.stepCurrent : ''}`}
              aria-current={current ? 'step' : undefined}
            >
              {icons[step.modelId] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.icon} src={icons[step.modelId]} alt="" width={ICON_SIZE} height={ICON_SIZE} />
              ) : (
                <span className={styles.icon} />
              )}
              <div className={styles.stepText}>
                <span className={styles.day}>Dag {step.startDay}</span>
                <span className={styles.mode}>{step.mode}</span>
                <span className={styles.instruction}>{step.instruction}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <p className={styles.footer}>Hålltider · resdag</p>
    </section>
  );
};
