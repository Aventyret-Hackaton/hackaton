'use client';

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

import type { Place } from '@/lib/places';

type TripPlaces = {
  origin: Place | null;
  destination: Place | null;
};

type TripContextValue = TripPlaces & {
  // False until the places have been read from session storage.
  isLoaded: boolean;
  setOrigin: (place: Place | null) => void;
  setDestination: (place: Place | null) => void;
};

const STORAGE_KEY = 'trip-places';
const EMPTY_PLACES: TripPlaces = { origin: null, destination: null };

const TripContext = createContext<TripContextValue | null>(null);

const parsePlace = (value: unknown): Place | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { placeId, address, latitude, longitude } = value as Record<string, unknown>;
  const isPlace = typeof placeId === 'string' && typeof address === 'string' && typeof latitude === 'number' && typeof longitude === 'number';
  return isPlace ? { placeId, address, latitude, longitude } : null;
};

const parsePlaces = (stored: string | null | undefined): TripPlaces => {
  try {
    const { origin, destination } = (JSON.parse(stored ?? 'null') ?? {}) as Record<string, unknown>;
    return { origin: parsePlace(origin), destination: parsePlace(destination) };
  } catch {
    return EMPTY_PLACES;
  }
};

// Session storage as an external store. The cache also keeps the trip in memory when storage is unavailable.
const listeners = new Set<() => void>();
let cached: string | null | undefined;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): string | null => {
  if (cached === undefined) {
    try {
      cached = window.sessionStorage.getItem(STORAGE_KEY);
    } catch {
      cached = null;
    }
  }
  return cached;
};

// The server has no storage, undefined marks the places as not yet loaded.
const getServerSnapshot = (): undefined => undefined;

const updatePlaces = (patch: Partial<TripPlaces>): void => {
  cached = JSON.stringify({ ...parsePlaces(getSnapshot()), ...patch });
  try {
    window.sessionStorage.setItem(STORAGE_KEY, cached);
  } catch {
    // Storage can be unavailable, the trip then only lives in memory.
  }
  listeners.forEach((listener) => listener());
};

const setOrigin = (origin: Place | null): void => updatePlaces({ origin });
const setDestination = (destination: Place | null): void => updatePlaces({ destination });

export const TripProvider = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const stored = useSyncExternalStore<string | null | undefined>(subscribe, getSnapshot, getServerSnapshot);
  const value = useMemo(() => ({ ...parsePlaces(stored), isLoaded: stored !== undefined, setOrigin, setDestination }), [stored]);
  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
};

export const useTrip = (): TripContextValue => {
  const value = useContext(TripContext);
  if (!value) {
    throw new Error('useTrip must be used within a TripProvider');
  }
  return value;
};
