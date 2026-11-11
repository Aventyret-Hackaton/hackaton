import { bearing, type Coordinates, distanceMeters, type Gateway, pickGateways } from '@/lib/geo';
import { PlacesError } from '@/lib/places';

export type StreetFrame = Coordinates & {
  heading: number;
};

export type StreetLeg = {
  // Real world driving time.
  durationSeconds: number;
  frames: StreetFrame[];
};

export type StreetLegs = {
  exit: Gateway;
  entry: Gateway;
  outbound: StreetLeg;
  inbound: StreetLeg;
};

type ComputeRoutesResponse = {
  routes?: { duration?: string; polyline?: { geoJsonLinestring?: { coordinates?: [number, number][] } } }[];
};

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FRAME_SPACING_METERS = 100;
const MAX_FRAMES_PER_LEG = 150;

const toWaypoint = ({ latitude, longitude }: Coordinates): unknown => ({
  location: { latLng: { latitude, longitude } }
});

const interpolate = (from: Coordinates, to: Coordinates, fraction: number): Coordinates => ({
  latitude: from.latitude + (to.latitude - from.latitude) * fraction,
  longitude: from.longitude + (to.longitude - from.longitude) * fraction
});

// Evenly spaced points along the path, each looking down the road ahead.
const sampleFrames = (path: Coordinates[]): StreetFrame[] => {
  const lengths = path.slice(1).map((point, index) => distanceMeters(path[index], point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const count = Math.min(Math.max(Math.ceil(total / FRAME_SPACING_METERS) + 1, 2), MAX_FRAMES_PER_LEG);
  const frames: StreetFrame[] = [];
  let segment = 0;
  let travelled = 0;

  for (let index = 0; index < count; index++) {
    const target = (total * index) / (count - 1);
    while (segment < lengths.length - 1 && travelled + lengths[segment] < target) {
      travelled += lengths[segment];
      segment++;
    }
    const fraction = lengths[segment] > 0 ? (target - travelled) / lengths[segment] : 0;
    frames.push({
      ...interpolate(path[segment], path[segment + 1], Math.min(fraction, 1)),
      heading: Math.round(bearing(path[segment], path[segment + 1]))
    });
  }
  return frames;
};

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
      'X-Goog-FieldMask': 'routes.duration,routes.polyline'
    },
    body: JSON.stringify({
      origin: toWaypoint(from),
      destination: toWaypoint(to),
      travelMode: 'DRIVE',
      polylineEncoding: 'GEO_JSON_LINESTRING'
    }),
    cache: 'no-store'
  });
  if (!response.ok) {
    console.error('Routes API error', response.status, await response.text());
    throw new PlacesError('Routes API request failed', 502);
  }
  const data = (await response.json()) as ComputeRoutesResponse;
  const route = data.routes?.[0];
  const coordinates = route?.polyline?.geoJsonLinestring?.coordinates ?? [];
  const path = coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
  // Durations are formatted as seconds with an "s" suffix.
  const durationSeconds = Number.parseFloat(route?.duration ?? '');
  if (path.length < 2 || !Number.isFinite(durationSeconds)) {
    throw new PlacesError('Routes API returned no route', 502);
  }
  return { durationSeconds, frames: sampleFrames(path) };
};

export const getStreetLegs = async (origin: Coordinates, destination: Coordinates): Promise<StreetLegs> => {
  const { exit, entry } = pickGateways(origin, destination);
  const [outbound, inbound] = await Promise.all([fetchDrivingLeg(origin, exit), fetchDrivingLeg(entry, destination)]);
  return { exit, entry, outbound, inbound };
};
