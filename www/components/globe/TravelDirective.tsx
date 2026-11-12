'use client';

import { useEffect, useRef } from 'react';

import { LEGS } from '@/lib/globe/journey';
import type { VoxelModelDef } from '@/lib/voxel/model';
import { VEHICLE_MODELS } from '@/lib/voxel/models';

import styles from './TravelDirective.module.css';
import { useModelThumbnails } from './useModelThumbnails';

export type DirectiveStep = {
  id: string;
  model: VoxelModelDef;
  time: string;
  mode: string;
  instruction: string;
};

type TravelDirectiveProps = {
  steps: readonly DirectiveStep[];
  // Index of the step being travelled, or null when none should be marked.
  currentStep: number | null;
};

const ICON_SIZE = 64;
const SCROLL_MARGIN = 6;

// The legs around the globe, in the shape the directive list wants.
export const LEG_STEPS: readonly DirectiveStep[] = LEGS.map((leg) => ({
  id: leg.id,
  model: VEHICLE_MODELS[leg.modelId],
  time: `Dag ${leg.startDay}`,
  mode: leg.mode,
  instruction: leg.instruction
}));

export const TravelDirective = ({ steps, currentStep }: TravelDirectiveProps): React.JSX.Element => {
  const listRef = useRef<HTMLOListElement>(null);
  const currentStepRef = useRef<HTMLLIElement>(null);
  const icons = useModelThumbnails(
    steps.map((step) => step.model),
    ICON_SIZE
  );

  // Scrolls the list itself, never the page around it.
  useEffect(() => {
    const list = listRef.current;
    const item = currentStepRef.current;
    if (!list || !item) {
      return;
    }
    const top = item.offsetTop - SCROLL_MARGIN;
    const bottom = item.offsetTop + item.offsetHeight + SCROLL_MARGIN;
    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [currentStep]);

  return (
    <section className={styles.panel} aria-label="Resedirektiv">
      <h2 className={styles.title}>Resedirektiv</h2>
      <ol ref={listRef} className={styles.steps}>
        {steps.map((step, index) => {
          const current = index === currentStep;
          return (
            <li
              key={step.id}
              ref={current ? currentStepRef : undefined}
              className={`${styles.step} ${current ? styles.stepCurrent : ''}`}
              aria-current={current ? 'step' : undefined}
            >
              {icons[step.model.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.icon} src={icons[step.model.id]} alt="" width={ICON_SIZE} height={ICON_SIZE} />
              ) : (
                <span className={styles.icon} />
              )}
              <div className={styles.stepText}>
                <span className={styles.day}>{step.time}</span>
                <span className={styles.mode}>{step.mode}</span>
                <span className={styles.instruction}>{step.instruction}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
