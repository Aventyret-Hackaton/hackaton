export type TripPhase = 'outbound' | 'globe' | 'inbound' | 'arrived';

export type Timeline = {
  // performance.now() timestamp at which anchorElapsed was measured.
  anchorTime: number;
  // Trip seconds that had passed at anchorTime.
  anchorElapsed: number;
  // Trip seconds per real second.
  speed: number;
  outboundSeconds: number;
  globeSeconds: number;
  inboundSeconds: number;
};

export type TimelineState = {
  phase: TripPhase;
  // Progress within the current phase, 0 to 1.
  progress: number;
  // Seconds left of the current phase.
  remainingSeconds: number;
};

export const SPEEDS = [1, 10, 100, 1000, 10000, 100000];

export const formatSpeed = (speed: number): string => (speed === 1 ? 'Realtid' : `${speed}x`);

// The street view is never played faster than this, whatever the chosen speed.
const MAX_STREET_SPEED = 500;

export const getStreetSpeed = ({ speed }: Timeline): number => Math.min(speed, MAX_STREET_SPEED);

// Walks the phases from the anchor, since street and globe phases can differ in speed.
const getElapsed = (timeline: Timeline, now: number): number => {
  const { anchorTime, anchorElapsed, speed, outboundSeconds, globeSeconds, inboundSeconds } = timeline;
  const streetSpeed = getStreetSpeed(timeline);
  const phases = [
    { end: outboundSeconds, speed: streetSpeed },
    { end: outboundSeconds + globeSeconds, speed },
    { end: outboundSeconds + globeSeconds + inboundSeconds, speed: streetSpeed }
  ];
  let realSeconds = Math.max((now - anchorTime) / 1000, 0);
  let elapsed = Math.max(anchorElapsed, 0);

  for (const phase of phases) {
    if (elapsed >= phase.end) {
      continue;
    }
    const realSecondsLeft = (phase.end - elapsed) / phase.speed;
    if (realSeconds < realSecondsLeft) {
      return elapsed + realSeconds * phase.speed;
    }
    realSeconds -= realSecondsLeft;
    elapsed = phase.end;
  }
  return elapsed;
};

// Changes speed without moving the current position on the trip.
export const withSpeed = (timeline: Timeline, speed: number, now: number): Timeline => ({
  ...timeline,
  anchorTime: now,
  anchorElapsed: getElapsed(timeline, now),
  speed
});

export const getTimelineState = (timeline: Timeline, now: number): TimelineState => {
  const { outboundSeconds, globeSeconds, inboundSeconds } = timeline;
  let elapsed = getElapsed(timeline, now);
  const phases: [TripPhase, number][] = [
    ['outbound', outboundSeconds],
    ['globe', globeSeconds],
    ['inbound', inboundSeconds]
  ];

  for (const [phase, seconds] of phases) {
    if (elapsed < seconds) {
      return { phase, progress: elapsed / seconds, remainingSeconds: seconds - elapsed };
    }
    elapsed -= seconds;
  }
  return { phase: 'arrived', progress: 1, remainingSeconds: 0 };
};

// Share of the long way around the globe that has been covered.
export const getGlobeProgress = ({ phase, progress }: TimelineState): number => {
  if (phase === 'outbound') {
    return 0;
  }
  return phase === 'globe' ? progress : 1;
};
