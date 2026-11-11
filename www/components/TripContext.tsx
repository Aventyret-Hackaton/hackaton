'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { Place } from '@/lib/places';
import { SPEEDS } from '@/lib/timeline';

type TripPlaces = {
  origin: Place | null;
  destination: Place | null;
  speed: number;
};

type TripContextValue = TripPlaces & {
  // False until the places have been read from session storage.
  isLoaded: boolean;
  setOrigin: (place: Place | null) => void;
  setDestination: (place: Place | null) => void;
  setSpeed: (speed: number) => void;
};

const STORAGE_KEY = 'trip-places';
const EMPTY_PLACES: TripPlaces = { origin: null, destination: null, speed: 1 };

const TripContext = createContext<TripContextValue | null>(null);

const parsePlace = (value: unknown): Place | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { placeId, address, latitude, longitude } = value as Record<string, unknown>;
  const isPlace = typeof placeId === 'string' && typeof address === 'string' && typeof latitude === 'number' && typeof longitude === 'number';
  return isPlace ? { placeId, address, latitude, longitude } : null;
};

const readStoredPlaces = (): TripPlaces => {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    const { origin, destination, speed } = (stored ?? {}) as Record<string, unknown>;
    return {
      origin: parsePlace(origin),
      destination: parsePlace(destination),
      speed: typeof speed === 'number' && SPEEDS.includes(speed) ? speed : 1
    };
  } catch {
    return EMPTY_PLACES;
  }
};

const storePlaces = (places: TripPlaces): void => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(places));
  } catch {
    // Storage can be unavailable, the trip then only lives in memory.
  }
};

export const TripProvider = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const [places, setPlaces] = useState<TripPlaces>(EMPTY_PLACES);
  const [isLoaded, setIsLoaded] = useState(false);

  // Storage is read after mount so the server and client render the same markup.
  useEffect(() => {
    setPlaces(readStoredPlaces());
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      storePlaces(places);
    }
  }, [places, isLoaded]);

  const setOrigin = useCallback((origin: Place | null): void => setPlaces((previous) => ({ ...previous, origin })), []);
  const setDestination = useCallback((destination: Place | null): void => setPlaces((previous) => ({ ...previous, destination })), []);

  const setSpeed = useCallback((speed: number): void => setPlaces((previous) => ({ ...previous, speed })), []);

  const value = useMemo(() => ({ ...places, isLoaded, setOrigin, setDestination, setSpeed }), [places, isLoaded, setOrigin, setDestination, setSpeed]);
  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
};

export const useTrip = (): TripContextValue => {
  const value = useContext(TripContext);
  if (!value) {
    throw new Error('useTrip must be used within a TripProvider');
  }
  return value;
};
