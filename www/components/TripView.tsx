'use client';

import { useEffect, useMemo, useState } from 'react';

import { Vector3 } from 'three';

import { ArrivalConfetti } from '@/components/globe/ArrivalConfetti';
import { pixelFont } from '@/components/globe/pixelFont';
import { RouteCaption } from '@/components/globe/RouteCaption';
import { isTypingTarget } from '@/components/globe/keyboard';
import { SCANLINE_HINT, ScanlineOverlay } from '@/components/globe/ScanlineOverlay';
import { TitleBar } from '@/components/globe/TitleBar';
import { buildLegSteps, type DirectiveStep, TravelDirective } from '@/components/globe/TravelDirective';
import type { GlobePlace, GlobeTraveller } from '@/components/globe/scene';
import { type KeyHint, VoxelGlobe } from '@/components/globe/VoxelGlobe';
import { StreetView } from '@/components/StreetView';
import { latLonToUnit } from '@/lib/globe/geo';
import { STOCKHOLM } from '@/lib/globe/journey';
import { type JourneyPlan, locateJourney } from '@/lib/globe/journeys';
import { trackPoint } from '@/lib/globe/track';
import type { Place } from '@/lib/places';
import { estimateStreetLegs, type StreetLegs } from '@/lib/streetLegs';
import {
  getEffectiveSpeed,
  getGlobeProgress,
  getNextSpeed,
  getTimelineState,
  hasStarted,
  NOT_STARTED,
  type Timeline,
  TRIP_SPEEDS,
  type TripPhase,
  withSpeed,
  withStart
} from '@/lib/timeline';
import { FLAGS_MODEL } from '@/lib/voxel/models';

import type { Traveller } from './streetScene';
import styles from './TripView.module.css';

type TripViewProps = {
  origin: Place;
  destination: Place;
  // The way around the globe this trip takes.
  journey: JourneyPlan;
  onReset: () => void;
};

type TripData = {
  legs: StreetLegs;
  timeline: Timeline;
};

const STOCKHOLM_UNIT = latLonToUnit(STOCKHOLM);
const NO_HEADING = new Vector3();
// Fraction of a leg on each side of the traveller that gives the heading.
const HEADING_SPAN = 0.002;
const ARRIVED_TEXT = 'Framme. Nu då?';
const PHASE_TICK_MS = 200;
const START_HINT: KeyHint = ['Mellanslag', 'ge dig av'];

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
const buildSteps = ({ exit }: StreetLegs, journey: JourneyPlan): readonly DirectiveStep[] => [
  { id: 'street-out', model: FLAGS_MODEL, time: 'Dag 1', mode: `Lämnar Stockholm · utfart ${exit.name}`, instruction: 'Åt fel håll.' },
  { id: 'jetty', model: FLAGS_MODEL, time: 'Dag 1', mode: 'Ta dig till en brygga', instruction: 'Du behöver en båt.' },
  ...buildLegSteps(journey),
  { id: 'street-in', model: FLAGS_MODEL, time: `Dag ${journey.arrivalDay}`, mode: 'Tillbaka i Stockholm · från Slussen', instruction: 'Sista biten.' }
];

// Where the traveller is, and on what, the given real seconds from now, for the street view.
const getTraveller = (journey: JourneyPlan, timeline: Timeline, aheadSeconds: number): Traveller => {
  const state = getTimelineState(timeline, performance.now() + aheadSeconds * 1000);
  if (state.phase !== 'globe') {
    return { modelId: 'walker', unit: STOCKHOLM_UNIT, heading: NO_HEADING, urban: true, moving: hasStarted(timeline) && state.phase !== 'arrived' };
  }
  const { legIndex, legProgress } = locateJourney(journey, state.progress);
  const track = journey.tracks[legIndex];
  const from = trackPoint(track, legProgress - HEADING_SPAN, new Vector3());
  const heading = trackPoint(track, legProgress + HEADING_SPAN, new Vector3()).sub(from);
  return { modelId: journey.legs[legIndex].modelId, unit: trackPoint(track, legProgress, from), heading, urban: false, moving: true };
};

// The globe shows the same traveller as the street view, and nobody once the trip is over.
const getGlobeTraveller = (journey: JourneyPlan, timeline: Timeline): GlobeTraveller | null => {
  if (getTimelineState(timeline, performance.now()).phase === 'arrived') {
    return null;
  }
  const { modelId, moving } = getTraveller(journey, timeline, 0);
  return { modelId, moving };
};

// The flag on the globe is named after the first part of the address.
const toGlobePlace = ({ address, latitude, longitude }: Place): GlobePlace => ({ name: address.split(',')[0], position: [latitude, longitude] });

// Thousands are separated by spaces, as in Swedish.
const formatSpeed = (speed: number): string => (speed === 1 ? 'realtid' : `${speed.toLocaleString('sv-SE')}x`);

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

export const TripView = ({ origin, destination, journey, onReset }: TripViewProps): React.JSX.Element => {
  const [trip, setTrip] = useState<TripData | null>(null);
  const [legIndex, setLegIndex] = useState(0);
  const phase = usePhase(trip?.timeline ?? null);
  const steps = useMemo(() => (trip ? buildSteps(trip.legs, journey) : buildLegSteps(journey)), [trip, journey]);
  const places = useMemo(() => ({ origin: toGlobePlace(origin), destination: toGlobePlace(destination) }), [origin, destination]);

  useEffect(() => {
    const controller = new AbortController();
    // The trip is ready once the street legs are known, or have been estimated. Space sets it off.
    const start = (legs: StreetLegs): void => {
      if (!controller.signal.aborted) {
        setTrip({
          legs,
          timeline: {
            startTime: NOT_STARTED,
            elapsedSeconds: 0,
            speed: TRIP_SPEEDS[0],
            outboundSeconds: legs.outbound.durationSeconds,
            jettySeconds: legs.jetty.durationSeconds,
            globeSeconds: journey.seconds,
            inboundSeconds: legs.inbound.durationSeconds
          }
        });
      }
    };
    fetchStreetLegs(origin, destination, controller.signal).then(start, () => start(estimateStreetLegs(origin, destination)));
    return (): void => controller.abort();
  }, [origin, destination, journey]);

  // Space sets the trip off. S steps the speed up one notch, and back to real time after the fastest allowed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      const key = event.key.toLowerCase();
      if (modified || event.repeat || isTypingTarget(event.target) || (key !== 's' && key !== ' ')) {
        return;
      }
      event.preventDefault();
      const now = performance.now();
      setTrip((previous) => {
        if (!previous) {
          return previous;
        }
        const { timeline } = previous;
        if (key === ' ') {
          return { ...previous, timeline: withStart(timeline, now) };
        }
        return { ...previous, timeline: withSpeed(timeline, getNextSpeed(timeline, getTimelineState(timeline, now).phase), now) };
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const started = trip !== null && hasStarted(trip.timeline);
  const speedHint: KeyHint = ['S', `snabbare · nu ${formatSpeed(trip ? getEffectiveSpeed(trip.timeline, phase) : TRIP_SPEEDS[0])}`];
  const hints: readonly KeyHint[] = [...(started ? [] : [START_HINT]), speedHint, ...SCANLINE_HINT];
  const stepByPhase: Record<TripPhase, number | null> = {
    outbound: 0,
    jetty: 1,
    globe: 2 + legIndex,
    inbound: steps.length - 1,
    arrived: null
  };
  const currentStep = phase && started ? stepByPhase[phase] : null;
  const step = currentStep === null ? undefined : steps[currentStep];
  const nextStep = currentStep === null ? undefined : steps[currentStep + 1];
  const idleText = phase === 'arrived' ? ARRIVED_TEXT : 'Väntar på avfärd';
  // On the street legs in Stockholm the globe has no leg of its own to name.
  const globeCaption = step && phase !== 'globe' ? `Nu: ${step.mode}` : undefined;

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
            places={places}
            journey={journey}
            underWay={started}
            getTraveller={(): GlobeTraveller | null => getGlobeTraveller(journey, trip.timeline)}
            caption={globeCaption}
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
          {trip && (
            <StreetView
              title={step?.mode ?? idleText}
              detail={step?.instruction}
              getTraveller={(aheadSeconds: number): Traveller => getTraveller(journey, trip.timeline, aheadSeconds)}
            />
          )}
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

      <ArrivalConfetti active={phase === 'arrived'} />
      <ScanlineOverlay />
    </div>
  );
};
