import type { Coordinates } from '@/lib/geo';

// Generous box around Stockholm that covers all street level legs.
const BOUNDS = {
  minLatitude: 59,
  maxLatitude: 59.7,
  minLongitude: 17.4,
  maxLongitude: 18.7
};

export const parseStockholmCoordinates = (latitude: string | null, longitude: string | null): Coordinates | null => {
  const coordinates = { latitude: Number(latitude), longitude: Number(longitude) };
  const isValid =
    latitude !== null &&
    longitude !== null &&
    coordinates.latitude >= BOUNDS.minLatitude &&
    coordinates.latitude <= BOUNDS.maxLatitude &&
    coordinates.longitude >= BOUNDS.minLongitude &&
    coordinates.longitude <= BOUNDS.maxLongitude;
  return isValid ? coordinates : null;
};
