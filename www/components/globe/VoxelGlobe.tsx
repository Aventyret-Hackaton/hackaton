'use client';

import { useEffect, useRef, useState } from 'react';

import { DEFAULT_JOURNEY_PLAN, type JourneyPlan } from '@/lib/globe/journeys';

import { isTypingTarget } from './keyboard';
import { pixelFont } from './pixelFont';
import { createGlobeScene } from './scene';
import type { GlobePlaces, GlobeSceneHandle, GlobeStatus, GlobeTraveller } from './scene';
import styles from './VoxelGlobe.module.css';

export type KeyHint = readonly [keys: string, action: string];

type VoxelGlobeProps = {
  // Journey progress from 0 to 1. Without it the globe runs on its own clock.
  getProgress?: () => number;
  onLegChange?: (index: number) => void;
  onStatusChange?: (status: GlobeStatus) => void;
  // The two addresses in Stockholm. Without them the globe uses a pair of its own.
  places?: GlobePlaces;
  // The way around the globe. Without it the globe shows the first journey.
  journey?: JourneyPlan;
  // Whether a trip on an outside clock has set off. The globe leaves the close-up when it has.
  underWay?: boolean;
  // Who the globe shows travelling, or null for nobody. Without it the leg decides.
  getTraveller?: () => GlobeTraveller | null;
  // Replaces the line at the foot of the globe that says what is going on. Null leaves it out.
  caption?: string | null;
  extraHints?: readonly KeyHint[];
  className?: string;
};

const SPIN_KEYS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1]
};

const JOURNEY_HINTS: readonly KeyHint[] = [
  ['Mellanslag', 'starta / pausa'],
  ['N B', 'nästa / förra etappen'],
  ['R', 'börja om']
];

const VIEW_HINTS: readonly KeyHint[] = [
  ['← → ↑ ↓', 'snurra jordklotet'],
  ['+ −', 'zooma'],
  ['F', 'följ resenären']
];

const INITIAL_STATUS: GlobeStatus = {
  running: false,
  started: false,
  finished: false,
  follow: true
};

export const VoxelGlobe = ({
  getProgress,
  onLegChange,
  onStatusChange,
  places,
  journey = DEFAULT_JOURNEY_PLAN,
  underWay = true,
  getTraveller,
  caption,
  extraHints = [],
  className
}: VoxelGlobeProps): React.JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlobeSceneHandle | null>(null);
  const callbacksRef = useRef({ getProgress, onLegChange, onStatusChange, underWay, getTraveller });
  const placesRef = useRef(places);
  // The scene is rebuilt when the addresses change, not when the object does.
  const placesKey = JSON.stringify(places ?? null);
  const [legIndex, setLegIndex] = useState(0);
  const [status, setStatus] = useState<GlobeStatus>(INITIAL_STATUS);
  const driven = getProgress !== undefined;
  const hasTraveller = getTraveller !== undefined;

  useEffect(() => {
    callbacksRef.current = { getProgress, onLegChange, onStatusChange, underWay, getTraveller };
    placesRef.current = places;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const labelLayer = labelLayerRef.current;
    if (!canvas || !labelLayer) {
      return;
    }
    const scene = createGlobeScene({
      canvas,
      labelLayer,
      sightLabelClassName: styles.sightLabel,
      hereLabelClassName: `${styles.sightLabel} ${styles.hereLabel}`,
      hereLabelText: 'Här är du',
      placeLabelClassName: styles.sightLabel,
      districtLabelClassName: styles.districtLabel,
      places: placesRef.current,
      journey,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      getProgress: driven ? (): number => callbacksRef.current.getProgress?.() ?? 0 : undefined,
      isUnderWay: driven ? (): boolean => callbacksRef.current.underWay : undefined,
      getTraveller: hasTraveller ? (): GlobeTraveller | null => callbacksRef.current.getTraveller?.() ?? null : undefined,
      onLegChange: (index): void => {
        setLegIndex(index);
        callbacksRef.current.onLegChange?.(index);
      },
      onStatusChange: (next): void => {
        setStatus(next);
        callbacksRef.current.onStatusChange?.(next);
      }
    });
    sceneRef.current = scene;
    return (): void => {
      sceneRef.current = null;
      scene.dispose();
    };
  }, [driven, hasTraveller, placesKey, journey]);

  useEffect(() => {
    const pressed = new Set<string>();
    const applySpin = (): void => {
      let x = 0;
      let y = 0;
      pressed.forEach((key) => {
        x += SPIN_KEYS[key][0];
        y += SPIN_KEYS[key][1];
      });
      sceneRef.current?.setSpin(x, y);
    };

    // Returns true when the key belongs to the journey controls.
    const handleJourneyKey = (scene: GlobeSceneHandle, key: string): boolean => {
      if (key === ' ') {
        scene.toggleRunning();
      } else if (key === 'n') {
        scene.stepLeg(1);
      } else if (key === 'b') {
        scene.stepLeg(-1);
      } else if (key === 'r') {
        scene.restart();
      } else {
        return false;
      }
      return true;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const scene = sceneRef.current;
      if (!scene || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (event.key in SPIN_KEYS) {
        pressed.add(event.key);
        applySpin();
      } else if (key === '+' || key === '=') {
        scene.zoom(-1);
      } else if (key === '-') {
        scene.zoom(1);
      } else if (event.repeat) {
        return;
      } else if (key === 'f') {
        scene.toggleFollow();
      } else if (driven || !handleJourneyKey(scene, key)) {
        return;
      }
      event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (pressed.delete(event.key)) {
        applySpin();
      }
    };

    const onBlur = (): void => {
      pressed.clear();
      applySpin();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return (): void => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [driven]);

  const leg = journey.legs[Math.min(legIndex, journey.legs.length - 1)];
  const waitingText = driven && underWay ? 'Tillfälligt stillastående.' : 'Tryck på mellanslag för att ge dig av.';
  const ownText = status.finished ? `Dag ${journey.arrivalDay}. Framme. Nu då?` : status.started ? `Nu: ${leg.mode} · ${leg.from} → ${leg.to}` : waitingText;
  const statusText = caption === undefined ? ownText : caption;
  const hints = [...(driven ? [] : JOURNEY_HINTS), ...VIEW_HINTS, ...extraHints];

  return (
    <div className={`${pixelFont.variable} ${styles.stage} ${className ?? ''}`}>
      <canvas ref={canvasRef} className={styles.canvas} aria-label="Voxeljordklot med resvägen från Slussen till Slussen" />
      <div ref={labelLayerRef} className={styles.labels} />
      <ul className={styles.hints}>
        {hints.map(([keys, action]) => (
          <li key={keys}>
            <kbd>{keys}</kbd> {action}
          </li>
        ))}
      </ul>
      {statusText && (
        <p className={styles.status} aria-live="polite">
          {statusText}
        </p>
      )}
    </div>
  );
};
