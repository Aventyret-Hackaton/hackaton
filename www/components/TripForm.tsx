'use client';

import { useState } from 'react';

import { PlaceAutocomplete } from '@/components/PlaceAutocomplete';
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

  return (
    <>
      <h1>Vart vill du?</h1>
      <form onSubmit={handleSubmit}>
        <PlaceAutocomplete label="Från" onChange={setOrigin} />
        <PlaceAutocomplete label="Till" onChange={setDestination} />
        <button type="submit" disabled={!origin || !destination}>
          Planera resa
        </button>
        {trip && <pre>{JSON.stringify(trip, null, 2)}</pre>}
      </form>
    </>
  );
};
