'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

import { useTrip } from '@/components/TripContext';
import { TripView } from '@/components/TripView';

export default function TripPage(): React.JSX.Element | null {
  const router = useRouter();
  const { trip } = useTrip();

  // The trip only lives in memory, so a reload sends the user back to the form.
  useEffect(() => {
    if (!trip) {
      router.replace('/');
    }
  }, [trip, router]);

  if (!trip) {
    return null;
  }

  return (
    <main>
      <TripView origin={trip.origin} destination={trip.destination} onReset={() => router.push('/')} />
    </main>
  );
}
