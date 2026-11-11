'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { PlaceAutocomplete } from '@/components/PlaceAutocomplete';
import { useTrip } from '@/components/TripContext';
import type { Place } from '@/lib/places';

export const TripForm = (): React.JSX.Element => {
  const router = useRouter();
  const { setTrip } = useTrip();
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (origin && destination) {
      setTrip({ origin, destination });
      router.push('/trip');
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
      </form>
    </>
  );
};
