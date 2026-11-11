'use client';

import { useEffect, useState } from 'react';

import { StreetView } from '@/components/StreetView';
import { TripGlobe } from '@/components/TripGlobe';
import type { Place } from '@/lib/places';
import type { StreetLegs } from '@/lib/streetRoute';
import type { Timeline } from '@/lib/timeline';

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
  const [trip, setTrip] = useState<TripData | null>(null);

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

  return (
    <div className={styles.trip}>
      <header className={styles.header}>
        <h1>Pointless Travel Battle</h1>
        <button type="button" onClick={onReset}>
          En gång till. Av oklara skäl.
        </button>
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
