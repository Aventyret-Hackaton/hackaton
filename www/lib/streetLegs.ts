import { type Coordinates, distanceMeters, type Gateway, pickGateways } from '@/lib/geo';

export type StreetLeg = {
  // Real world driving time.
  durationSeconds: number;
};

export type StreetLegs = {
  exit: Gateway;
  entry: Gateway;
  outbound: StreetLeg;
  inbound: StreetLeg;
};

const FALLBACK_METERS_PER_SECOND = 30 / 3.6;

const estimateLeg = (from: Coordinates, to: Coordinates): StreetLeg => ({
  durationSeconds: distanceMeters(from, to) / FALLBACK_METERS_PER_SECOND
});

// Used when the driving times cannot be looked up.
export const estimateStreetLegs = (origin: Coordinates, destination: Coordinates): StreetLegs => {
  const { exit, entry } = pickGateways(origin, destination);
  return { exit, entry, outbound: estimateLeg(origin, exit), inbound: estimateLeg(entry, destination) };
};
