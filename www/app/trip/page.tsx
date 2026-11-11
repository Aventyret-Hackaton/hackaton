'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

import { useTrip } from '@/components/TripContext';
import { TripView } from '@/components/TripView';

export default function TripPage(): React.JSX.Element | null {
  const router = useRouter();
  const { origin, destination, isLoaded } = useTrip();
  const isMissingPlaces = isLoaded && (!origin || !destination);

  useEffect(() => {
    if (isMissingPlaces) {
      router.replace('/');
    }
  }, [isMissingPlaces, router]);

  if (!origin || !destination) {
    return null;
  }

  return (
    <main>
      <TripView origin={origin} destination={destination} onReset={() => router.push('/')} />
    </main>
  );
}
