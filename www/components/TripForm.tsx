'use client';

import { useState } from 'react';

import { PlaceAutocomplete } from '@/components/PlaceAutocomplete';
import { TripView } from '@/components/TripView';
import type { Place } from '@/lib/places';

export const TripForm = (): React.JSX.Element => {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [trip, setTrip] = useState<{ origin: Place; destination: Place } | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (origin && destination) {
      setTrip({ origin, destination });
    }
  };

  const handleReset = (): void => {
    setTrip(null);
    setOrigin(null);
    setDestination(null);
  };

  if (trip) {
    return <TripView origin={trip.origin} destination={trip.destination} onReset={handleReset} />;
  }

  return (
    <>
      <h1>Vart vill du?</h1>
      <form onSubmit={handleSubmit}>
        <PlaceAutocomplete label="Från" onChange={setOrigin} />
        <PlaceAutocomplete label="Till" onChange={setDestination} />
        <button type="submit" disabled={!origin || !destination}>
          Planera resa
        </button>
      </form>
    </>
  );
};
