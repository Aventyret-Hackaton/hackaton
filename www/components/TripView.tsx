'use client';

import { useEffect, useMemo, useState } from 'react';

import { Vector3 } from 'three';

import { pixelFont } from '@/components/globe/pixelFont';
import { RouteCaption } from '@/components/globe/RouteCaption';
import { isTypingTarget } from '@/components/globe/keyboard';
import { SCANLINE_HINT, ScanlineOverlay } from '@/components/globe/ScanlineOverlay';
import { TitleBar } from '@/components/globe/TitleBar';
import { type DirectiveStep, LEG_STEPS, TravelDirective } from '@/components/globe/TravelDirective';
import { type KeyHint, VoxelGlobe } from '@/components/globe/VoxelGlobe';
import { StreetView } from '@/components/StreetView';
import { latLonToUnit } from '@/lib/globe/geo';
import { ARRIVAL_DAY, JOURNEY_SECONDS, LEGS, locateJourney, STOCKHOLM } from '@/lib/globe/journey';
import { JOURNEY_TRACKS, trackPoint } from '@/lib/globe/track';
import type { Place } from '@/lib/places';
import { estimateStreetLegs, type StreetLegs } from '@/lib/streetLegs';
import { getEffectiveSpeed, getGlobeProgress, getNextSpeed, getTimelineState, type Timeline, TRIP_SPEEDS, type TripPhase, withSpeed } from '@/lib/timeline';
import { FLAGS_MODEL } from '@/lib/voxel/models';

import type { Traveller } from './streetScene';
import styles from './TripView.module.css';

type TripViewProps = {
  origin: Place;
  destination: Place;
  onReset: () => void;
};

type TripData = {
  legs: StreetLegs;
  timeline: Timeline;
};

const STOCKHOLM_UNIT = latLonToUnit(STOCKHOLM);
const ARRIVED_TEXT = 'Framme. Nu då?';
const PHASE_TICK_MS = 200;

const fetchStreetLegs = async (origin: Place, destination: Place, signal: AbortSignal): Promise<StreetLegs> => {
  const params = new URLSearchParams({
    originLat: String(origin.latitude),
    originLng: String(origin.longitude),
    destinationLat: String(destination.latitude),
    destinationLng: String(destination.longitude)
  });
  const response = await fetch(`/api/trip?${params}`, { signal });
  if (!response.ok) {
    throw new Error('Trip lookup failed');
  }
  return (await response.json()) as StreetLegs;
};

// The street legs in Stockholm wrap around the legs on the globe.
const buildSteps = ({ exit }: StreetLegs): readonly DirectiveStep[] => [
  { id: 'street-out', model: FLAGS_MODEL, time: 'Dag 1', mode: `Lämnar Stockholm · utfart ${exit.name}`, instruction: 'Åt fel håll.' },
  { id: 'jetty', model: FLAGS_MODEL, time: 'Dag 1', mode: 'Ta dig till en brygga', instruction: 'Du behöver en båt.' },
  ...LEG_STEPS,
  { id: 'street-in', model: FLAGS_MODEL, time: `Dag ${ARRIVAL_DAY}`, mode: 'Tillbaka i Stockholm · från Slussen', instruction: 'Sista biten.' }
];

// Where the traveller is, and on what, for the street view.
const getTraveller = (timeline: Timeline): Traveller => {
  const state = getTimelineState(timeline, performance.now());
  if (state.phase !== 'globe') {
    return { modelId: 'walker', unit: STOCKHOLM_UNIT, urban: true, moving: state.phase !== 'arrived' };
  }
  const { legIndex, legProgress } = locateJourney(state.progress);
  return { modelId: LEGS[legIndex].modelId, unit: trackPoint(JOURNEY_TRACKS[legIndex], legProgress, new Vector3()), urban: false, moving: true };
};

const formatSpeed = (speed: number): string => (speed === 1 ? 'realtid' : `${speed}x`);

const usePhase = (timeline: Timeline | null): TripPhase | null => {
  const [phase, setPhase] = useState<TripPhase | null>(null);

  useEffect(() => {
    if (!timeline) {
      return;
    }
    const update = (): void => setPhase(getTimelineState(timeline, performance.now()).phase);
    update();
    const interval = setInterval(update, PHASE_TICK_MS);
    return (): void => clearInterval(interval);
  }, [timeline]);

  return timeline ? phase : null;
};

export const TripView = ({ origin, destination, onReset }: TripViewProps): React.JSX.Element => {
  const [trip, setTrip] = useState<TripData | null>(null);
  const [legIndex, setLegIndex] = useState(0);
  const phase = usePhase(trip?.timeline ?? null);
  const steps = useMemo(() => (trip ? buildSteps(trip.legs) : LEG_STEPS), [trip]);

  useEffect(() => {
    const controller = new AbortController();
    // The clock starts once the street legs are known, or have been estimated.
    const start = (legs: StreetLegs): void => {
      if (!controller.signal.aborted) {
        setTrip({
          legs,
          timeline: {
            startTime: performance.now(),
            elapsedSeconds: 0,
            speed: TRIP_SPEEDS[0],
            outboundSeconds: legs.outbound.durationSeconds,
            jettySeconds: legs.jetty.durationSeconds,
            globeSeconds: JOURNEY_SECONDS,
            inboundSeconds: legs.inbound.durationSeconds
          }
        });
      }
    };
    fetchStreetLegs(origin, destination, controller.signal).then(start, () => start(estimateStreetLegs(origin, destination)));
    return (): void => controller.abort();
  }, [origin, destination]);

  // S steps the speed up one notch, and back to real time after the fastest allowed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      if (modified || event.repeat || isTypingTarget(event.target) || event.key.toLowerCase() !== 's') {
        return;
      }
      const now = performance.now();
      setTrip((previous) => {
        if (!previous) {
          return previous;
        }
        const { timeline } = previous;
        return { ...previous, timeline: withSpeed(timeline, getNextSpeed(timeline, getTimelineState(timeline, now).phase), now) };
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const hints: readonly KeyHint[] = [['S', `snabbare · nu ${formatSpeed(trip ? getEffectiveSpeed(trip.timeline, phase) : TRIP_SPEEDS[0])}`], ...SCANLINE_HINT];
  const stepByPhase: Record<TripPhase, number | null> = {
    outbound: 0,
    jetty: 1,
    globe: 2 + legIndex,
    inbound: steps.length - 1,
    arrived: null
  };
  const currentStep = phase ? stepByPhase[phase] : null;
  const step = currentStep === null ? undefined : steps[currentStep];
  const nextStep = currentStep === null ? undefined : steps[currentStep + 1];
  const idleText = phase === 'arrived' ? ARRIVED_TEXT : 'Väntar på avfärd';

  return (
    <div className={`${pixelFont.variable} ${styles.root}`}>
      <TitleBar />

      <div className={styles.directive}>
        <TravelDirective steps={steps} currentStep={currentStep} />
      </div>

      <section className={styles.stage} aria-label="Jordklotet">
        {trip ? (
          <VoxelGlobe
            className={styles.globe}
            extraHints={hints}
            onLegChange={setLegIndex}
            getProgress={(): number => getGlobeProgress(getTimelineState(trip.timeline, performance.now()))}
          />
        ) : (
          <p className={styles.loading}>Alla har en teori. Ingen är framme.</p>
        )}
        <h2 className={styles.detour}>En liten omväg</h2>
        <RouteCaption detail={`${origin.address} → ${destination.address}`} />
      </section>

      <section className={styles.here} aria-label="Här är du">
        <h2 className={styles.hereTitle}>Här är du</h2>
        <div className={styles.street}>
          {trip && <StreetView title={step?.mode ?? idleText} detail={step?.instruction} getTraveller={(): Traveller => getTraveller(trip.timeline)} />}
        </div>
        <dl className={styles.now}>
          <div>
            <dt>Nu</dt>
            <dd>{step?.mode ?? idleText}</dd>
          </div>
          {nextStep && (
            <div>
              <dt>Nästa byte</dt>
              <dd>{nextStep.mode}</dd>
            </div>
          )}
        </dl>
        <button type="button" className={styles.reset} onClick={onReset}>
          En gång till. Av oklara skäl.
        </button>
      </section>

      <ScanlineOverlay />
    </div>
  );
};
