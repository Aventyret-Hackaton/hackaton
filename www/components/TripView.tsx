'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Vector3 } from 'three';

import { useGameAudio } from '@/components/AudioProvider';
import { ArrivalConfetti } from '@/components/globe/ArrivalConfetti';
import { pixelFont } from '@/components/globe/pixelFont';
import { RouteCaption } from '@/components/globe/RouteCaption';
import { isTypingTarget } from '@/components/globe/keyboard';
// NOTE: We do not show scanline hint for now
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
  getPreviousSpeed,
  getTimelineState,
  hasStarted,
  NOT_STARTED,
  type Timeline,
  TRIP_SPEEDS,
  type TripPhase,
  withSpeed,
  withToggledRun
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
const SLOWER_HINT: KeyHint = ['Shift+S', 'långsammare'];
const MUTE_HINT: KeyHint = ['M', 'ljud av / på'];

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
    return { modelId: 'walker', unit: STOCKHOLM_UNIT, heading: NO_HEADING, urban: true, moving: hasStarted(timeline) && !timeline.paused && state.phase !== 'arrived' };
  }
  const { legIndex, legProgress } = locateJourney(journey, state.progress);
  const track = journey.tracks[legIndex];
  const from = trackPoint(track, legProgress - HEADING_SPAN, new Vector3());
  const heading = trackPoint(track, legProgress + HEADING_SPAN, new Vector3()).sub(from);
  return { modelId: journey.legs[legIndex].modelId, unit: trackPoint(track, legProgress, from), heading, urban: false, moving: !timeline.paused };
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
  const audio = useGameAudio();
  const speedTouched = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    // The trip is ready once the street legs are known, or have been estimated. Space sets it off.
    const start = (legs: StreetLegs): void => {
      if (!controller.signal.aborted) {
        setTrip({
          legs,
          timeline: {
            startTime: NOT_STARTED,
            paused: false,
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

  // Space sets the trip off, then pauses and resumes it. S steps the speed up one notch, wrapping to real time, and Shift+S steps it down.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      const key = event.key.toLowerCase();
      if (modified || event.repeat || isTypingTarget(event.target) || (key !== 's' && key !== ' ')) {
        return;
      }
      event.preventDefault();
      const slower = event.shiftKey;
      const now = performance.now();
      setTrip((previous) => {
        if (!previous) {
          return previous;
        }
        const { timeline } = previous;
        const { phase } = getTimelineState(timeline, now);
        if (key === ' ') {
          // There is nothing left to pause once the trip is over.
          return phase === 'arrived' ? previous : { ...previous, timeline: withToggledRun(timeline, now) };
        }
        const speed = slower ? getPreviousSpeed(timeline, phase) : getNextSpeed(timeline, phase);
        return { ...previous, timeline: withSpeed(timeline, speed, now) };
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const started = trip !== null && hasStarted(trip.timeline);
  const speedHint: KeyHint = ['S', `snabbare · nu ${formatSpeed(trip ? getEffectiveSpeed(trip.timeline, phase) : TRIP_SPEEDS[0])}`];
  const paused = trip !== null && trip.timeline.paused;
  const underWay = started && !paused && phase !== 'arrived';
  const runHint: KeyHint = started ? ['Mellanslag', paused ? 'fortsätt' : 'pausa'] : START_HINT;
  const hints: readonly KeyHint[] = [...(phase === 'arrived' ? [] : [runHint]), speedHint, SLOWER_HINT, MUTE_HINT];
  const stepByPhase: Record<TripPhase, number | null> = {
    outbound: 0,
    jetty: 1,
    globe: 2 + legIndex,
    inbound: steps.length - 1,
    arrived: null
  };
  const currentStep = phase && started ? stepByPhase[phase] : null;
  const step = currentStep === null ? undefined : steps[currentStep];
  const idleText = phase === 'arrived' ? ARRIVED_TEXT : 'Väntar på avfärd';

  // The theme tempo follows the game speed, and the UI cues follow the journey.
  const effectiveSpeed = trip ? getEffectiveSpeed(trip.timeline, phase) : TRIP_SPEEDS[0];
  useEffect(() => {
    audio.setGameSpeed(effectiveSpeed);
    if (speedTouched.current) {
      audio.playSfx('click');
    }
    speedTouched.current = true;
  }, [audio, effectiveSpeed]);
  useEffect(() => {
    // The main theme only while the trip is moving, the slow one before, while paused and after.
    audio.setTheme(underWay ? 'main' : 'slow');
  }, [audio, underWay]);
  useEffect(() => {
    if (started) {
      audio.playSfx('confirm');
    }
  }, [audio, started]);
  useEffect(() => {
    if (phase === 'arrived') {
      audio.playSfx('confirm');
    }
  }, [audio, phase]);
  useEffect(
    () => (): void => {
      audio.setGameSpeed(1);
      audio.setTheme('slow');
    },
    [audio]
  );

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
            caption={started ? null : undefined}
            getProgress={(): number => getGlobeProgress(getTimelineState(trip.timeline, performance.now()))}
          />
        ) : (
          <p className={styles.loading}>Alla har en teori. Ingen är framme.</p>
        )}
        <RouteCaption places={[places.origin.name, places.destination.name]} />
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
        <button
          type="button"
          className={styles.reset}
          onClick={() => {
            audio.playSfx('back');
            onReset();
          }}
        >
          En gång till. Av oklara skäl.
        </button>
      </section>

      <ArrivalConfetti active={phase === 'arrived'} />
      <ScanlineOverlay />
    </div>
  );
};
