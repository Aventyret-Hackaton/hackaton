'use client';

import { createContext, useContext, useMemo, useState } from 'react';

import type { Place } from '@/lib/places';

export type Trip = {
  origin: Place;
  destination: Place;
};

type TripContextValue = {
  trip: Trip | null;
  setTrip: (trip: Trip | null) => void;
};

const TripContext = createContext<TripContextValue | null>(null);

export const TripProvider = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const [trip, setTrip] = useState<Trip | null>(null);
  const value = useMemo(() => ({ trip, setTrip }), [trip]);
  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
};

export const useTrip = (): TripContextValue => {
  const value = useContext(TripContext);
  if (!value) {
    throw new Error('useTrip must be used within a TripProvider');
  }
  return value;
};
