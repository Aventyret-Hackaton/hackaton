'use client';

import { useEffect, useMemo, useState } from 'react';

import { pixelFont } from '@/components/globe/pixelFont';
import { RouteCaption } from '@/components/globe/RouteCaption';
import { SCANLINE_HINT, ScanlineOverlay } from '@/components/globe/ScanlineOverlay';
import { TitleBar } from '@/components/globe/TitleBar';
import { type DirectiveStep, LEG_STEPS, TravelDirective } from '@/components/globe/TravelDirective';
import { VoxelGlobe } from '@/components/globe/VoxelGlobe';
import { StreetView } from '@/components/StreetView';
import { ARRIVAL_DAY } from '@/lib/globe/journey';
import type { Place } from '@/lib/places';
import type { StreetLegs } from '@/lib/streetRoute';
import { getGlobeProgress, getTimelineState, type Timeline, type TripPhase } from '@/lib/timeline';
import { FLAGS_MODEL } from '@/lib/voxel/models';

import styles from './TripView.module.css';

type TripViewProps = {
  origin: Place;
  destination: Place;
  onReset: () => void;
};

type TripData = {
  legs: StreetLegs | null;
  timeline: Timeline;
};

const GLOBE_SECONDS = 60;
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
const buildSteps = (legs: StreetLegs | null): readonly DirectiveStep[] => {
  if (!legs) {
    return LEG_STEPS;
  }
  return [
    { id: 'street-out', model: FLAGS_MODEL, time: 'Dag 1', mode: `Utfart ${legs.exit.name}`, instruction: 'Lämna Stockholm. Åt fel håll.' },
    ...LEG_STEPS,
    { id: 'street-in', model: FLAGS_MODEL, time: `Dag ${ARRIVAL_DAY}`, mode: `Infart ${legs.entry.name}`, instruction: 'Tillbaka i Stockholm. Sista biten.' }
  ];
};

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
  const steps = useMemo(() => buildSteps(trip?.legs ?? null), [trip]);

  useEffect(() => {
    const controller = new AbortController();
    // The clock starts once the street legs are known, or have failed.
    const start = (legs: StreetLegs | null): void => {
      if (!controller.signal.aborted) {
        setTrip({
          legs,
          timeline: {
            startTime: performance.now(),
            outboundSeconds: legs?.outbound.durationSeconds ?? 0,
            globeSeconds: GLOBE_SECONDS,
            inboundSeconds: legs?.inbound.durationSeconds ?? 0
          }
        });
      }
    };
    fetchStreetLegs(origin, destination, controller.signal).then(start, () => start(null));
    return (): void => controller.abort();
  }, [origin, destination]);

  const streetSteps = trip?.legs ? 1 : 0;
  const stepByPhase: Record<TripPhase, number | null> = {
    outbound: streetSteps ? 0 : null,
    globe: streetSteps + legIndex,
    inbound: streetSteps ? steps.length - 1 : null,
    arrived: null
  };
  const currentStep = phase ? stepByPhase[phase] : null;
  const nextStep = currentStep === null ? undefined : steps[currentStep + 1];

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
            extraHints={SCANLINE_HINT}
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
        <div className={styles.street}>{trip && <StreetView legs={trip.legs} timeline={trip.timeline} />}</div>
        <dl className={styles.now}>
          <div>
            <dt>Nu</dt>
            <dd>{currentStep === null ? (phase === 'arrived' ? 'Framme. Nu då?' : 'Väntar på avfärd') : steps[currentStep].mode}</dd>
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
