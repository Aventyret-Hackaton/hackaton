'use client';

import { useState } from 'react';

import { PlaceAutocomplete } from '@/components/PlaceAutocomplete';
import { TripGlobe } from '@/components/TripGlobe';
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
    return (
      <>
        <button type="button" onClick={handleReset}>
          Ny resa
        </button>
        <TripGlobe origin={trip.origin} destination={trip.destination} />
      </>
    );
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
