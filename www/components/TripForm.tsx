'use client';

import { useRouter } from 'next/navigation';

import { PlaceAutocomplete } from '@/components/PlaceAutocomplete';
import { useTrip } from '@/components/TripContext';

export const TripForm = (): React.JSX.Element => {
  const router = useRouter();
  const { origin, destination, isLoaded, setOrigin, setDestination } = useTrip();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (origin && destination) {
      router.push('/trip');
    }
  };

  return (
    <>
      <h1>Vart vill du?</h1>
      {/* The fields mount once stored places are known, so they start prefilled. */}
      {isLoaded && (
        <form onSubmit={handleSubmit}>
          <PlaceAutocomplete label="Från" initialPlace={origin} onChange={setOrigin} />
          <PlaceAutocomplete label="Till" initialPlace={destination} onChange={setDestination} />
          <button type="submit" disabled={!origin || !destination}>
            Planera resa
          </button>
        </form>
      )}
    </>
  );
};
