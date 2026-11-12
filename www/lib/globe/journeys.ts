import { type Journey, JOURNEY } from './journey';
import { JOURNEY_2 } from './journey2';
import { JOURNEY_3 } from './journey3';
import { buildTrack, type Track } from './track';

// A journey with everything that is worked out from its legs.
export type JourneyPlan = Journey & {
  legDays: readonly number[];
  days: number;
  seconds: number;
  tracks: readonly Track[];
};

export type JourneyLocation = { legIndex: number; legProgress: number };

const SECONDS_PER_DAY = 86400;
// Legs that start and end on the same day still take a few hours.
const MIN_LEG_DAYS = 0.25;

const buildPlan = (journey: Journey): JourneyPlan => {
  const { legs, arrivalDay } = journey;
  const legDays = legs.map((leg, index) => Math.max((legs[index + 1]?.startDay ?? arrivalDay) - leg.startDay, MIN_LEG_DAYS));
  const days = legDays.reduce((sum, legLength) => sum + legLength, 0);
  return { ...journey, legDays, days, seconds: days * SECONDS_PER_DAY, tracks: legs.map((leg) => buildTrack(leg.path)) };
};

export const JOURNEY_PLANS: readonly JourneyPlan[] = [JOURNEY, JOURNEY_2, JOURNEY_3].map(buildPlan);
export const DEFAULT_JOURNEY_PLAN = JOURNEY_PLANS[0];

// The first trip gets the first journey, the next one the second, and so on around.
export const getJourneyPlan = (tripNumber: number): JourneyPlan => JOURNEY_PLANS[(Math.max(1, Math.floor(tripNumber)) - 1) % JOURNEY_PLANS.length];

// Maps journey progress from 0 to 1 onto a leg, with every leg taking its days.
export const locateJourney = ({ legDays, days }: JourneyPlan, progress: number): JourneyLocation => {
  const travelled = Math.min(1, Math.max(0, progress)) * days;
  let legIndex = 0;
  let before = 0;
  while (legIndex < legDays.length - 1 && before + legDays[legIndex] <= travelled) {
    before += legDays[legIndex];
    legIndex += 1;
  }
  return { legIndex, legProgress: Math.min(1, (travelled - before) / legDays[legIndex]) };
};
