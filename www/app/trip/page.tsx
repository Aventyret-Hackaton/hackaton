'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

import { useTrip } from '@/components/TripContext';
import { TripView } from '@/components/TripView';
import { getJourneyPlan } from '@/lib/globe/journeys';

export default function TripPage(): React.JSX.Element | null {
  const router = useRouter();
  const { origin, destination, tripNumber, isLoaded } = useTrip();
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
      <TripView origin={origin} destination={destination} journey={getJourneyPlan(tripNumber)} onReset={() => router.push('/')} />
    </main>
  );
}
