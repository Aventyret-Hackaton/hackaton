'use client';

import { useEffect, useRef, useState } from 'react';

import { StreetView } from '@/components/StreetView';
import { useTrip } from '@/components/TripContext';
import { TripGlobe } from '@/components/TripGlobe';
import type { Place } from '@/lib/places';
import { createLongRoute } from '@/lib/route';
import type { StreetLegs } from '@/lib/streetRoute';
import { formatSpeed, SPEEDS, type Timeline, withSpeed } from '@/lib/timeline';

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

// Assumed driving speed for the long way around the globe.
const GLOBE_SPEED_KMH = 80;

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

export const TripView = ({ origin, destination, onReset }: TripViewProps): React.JSX.Element => {
  const { speed, setSpeed } = useTrip();
  const [trip, setTrip] = useState<TripData | null>(null);
  // Lets the trip start at the stored speed without restarting when it changes.
  const speedRef = useRef(speed);

  useEffect(() => {
    const controller = new AbortController();
    const globeSeconds = (createLongRoute(origin, destination).distanceKm / GLOBE_SPEED_KMH) * 3600;
    // The clock starts once the street legs are known, or have failed.
    const start = (legs: StreetLegs | null): void => {
      if (!controller.signal.aborted) {
        setTrip({
          legs,
          timeline: {
            anchorTime: performance.now(),
            anchorElapsed: 0,
            speed: speedRef.current,
            outboundSeconds: legs?.outbound.durationSeconds ?? 0,
            globeSeconds,
            inboundSeconds: legs?.inbound.durationSeconds ?? 0
          }
        });
      }
    };
    fetchStreetLegs(origin, destination, controller.signal).then(start, () => start(null));
    return (): void => controller.abort();
  }, [origin, destination]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      const nextSpeed = SPEEDS[SPEEDS.indexOf(speedRef.current) + step];
      if (step === 0 || nextSpeed === undefined) {
        return;
      }
      event.preventDefault();
      speedRef.current = nextSpeed;
      setSpeed(nextSpeed);
      setTrip((previous) => previous && { ...previous, timeline: withSpeed(previous.timeline, nextSpeed, performance.now()) });
    };
    window.addEventListener('keydown', handleKeyDown);
    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [setSpeed]);

  return (
    <div className={styles.trip}>
      <header className={styles.header}>
        <h1>Pointless Travel Battle</h1>
        <button type="button" onClick={onReset}>
          En gång till. Av oklara skäl.
        </button>
        <p>Hastighet: {formatSpeed(speed)} (ändra med vänster- och högerpil)</p>
      </header>

      <section className={styles.panel}>
        <h2>Resedirektiv</h2>
        <ol>
          <li>Vägbeskrivningen kommer snart.</li>
        </ol>
        <p>Hålltider · lokal tid</p>
      </section>

      <section className={styles.panel}>
        {trip ? <TripGlobe origin={origin} destination={destination} timeline={trip.timeline} className={styles.globe} /> : <p>Alla har en teori. Ingen är framme.</p>}
        <h2>En liten omväg</h2>
      </section>

      <section className={styles.panel}>
        <h2>Här är du</h2>
        {trip && <StreetView legs={trip.legs} timeline={trip.timeline} />}
      </section>

      <footer className={styles.footer}>
        <p>
          A → B · Den långa vägen hem
          <br />
          {origin.address} → {destination.address}
        </p>
      </footer>
    </div>
  );
};
