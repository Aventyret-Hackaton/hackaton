import { type Coordinates, distanceMeters, type Gateway, nearestJetty, pickExit, SLUSSEN } from '@/lib/geo';

export type StreetLeg = {
  // Real world driving time.
  durationSeconds: number;
};

export type StreetLegs = {
  exit: Gateway;
  // From the origin to the exit.
  outbound: StreetLeg;
  // From the exit to the nearest jetty.
  jetty: StreetLeg;
  // From Slussen to the destination.
  inbound: StreetLeg;
};

type Stretch = readonly [from: Coordinates, to: Coordinates];

// The stretches driven in Stockholm, before and after the globe.
export const planStreetLegs = (origin: Coordinates, destination: Coordinates): { exit: Gateway; outbound: Stretch; jetty: Stretch; inbound: Stretch } => {
  const exit = pickExit(origin, destination);
  return { exit, outbound: [origin, exit], jetty: [exit, nearestJetty(exit)], inbound: [SLUSSEN, destination] };
};

const FALLBACK_METERS_PER_SECOND = 30 / 3.6;

const estimateLeg = ([from, to]: Stretch): StreetLeg => ({
  durationSeconds: distanceMeters(from, to) / FALLBACK_METERS_PER_SECOND
});

// Used when the driving times cannot be looked up.
export const estimateStreetLegs = (origin: Coordinates, destination: Coordinates): StreetLegs => {
  const { exit, outbound, jetty, inbound } = planStreetLegs(origin, destination);
  return { exit, outbound: estimateLeg(outbound), jetty: estimateLeg(jetty), inbound: estimateLeg(inbound) };
};
