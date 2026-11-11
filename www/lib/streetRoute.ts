import { type Coordinates, pickGateways } from '@/lib/geo';
import { PlacesError } from '@/lib/places';
import type { StreetLeg, StreetLegs } from '@/lib/streetLegs';

type ComputeRoutesResponse = {
  routes?: { duration?: string }[];
};

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const toWaypoint = ({ latitude, longitude }: Coordinates): unknown => ({
  location: { latLng: { latitude, longitude } }
});

const fetchDrivingLeg = async (from: Coordinates, to: Coordinates): Promise<StreetLeg> => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new PlacesError('GOOGLE_MAPS_API_KEY is not set', 500);
  }
  const response = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.duration'
    },
    body: JSON.stringify({
      origin: toWaypoint(from),
      destination: toWaypoint(to),
      travelMode: 'DRIVE'
    }),
    cache: 'no-store'
  });
  if (!response.ok) {
    console.error('Routes API error', response.status, await response.text());
    throw new PlacesError('Routes API request failed', 502);
  }
  const data = (await response.json()) as ComputeRoutesResponse;
  // Durations are formatted as seconds with an "s" suffix.
  const durationSeconds = Number.parseFloat(data.routes?.[0]?.duration ?? '');
  if (!Number.isFinite(durationSeconds)) {
    throw new PlacesError('Routes API returned no route', 502);
  }
  return { durationSeconds };
};

export const getStreetLegs = async (origin: Coordinates, destination: Coordinates): Promise<StreetLegs> => {
  const { exit, entry } = pickGateways(origin, destination);
  const [outbound, inbound] = await Promise.all([fetchDrivingLeg(origin, exit), fetchDrivingLeg(entry, destination)]);
  return { exit, entry, outbound, inbound };
};
