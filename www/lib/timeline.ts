export type TripPhase = 'outbound' | 'jetty' | 'globe' | 'inbound' | 'arrived';

// Trip seconds per real second, 1 is real time.
export const TRIP_SPEEDS = [1, 100, 1000, 10000, 100000, 1000000, 10000000] as const;
// The last leg, from Slussen, never plays faster than this.
const INBOUND_MAX_SPEED = 300;

export type Timeline = {
  // performance.now() timestamp of when the current speed was set.
  startTime: number;
  // Trip seconds that had been travelled at that time.
  elapsedSeconds: number;
  speed: number;
  outboundSeconds: number;
  jettySeconds: number;
  globeSeconds: number;
  inboundSeconds: number;
};

export type TimelineState = {
  phase: TripPhase;
  // Progress within the current phase, 0 to 1.
  progress: number;
};

const getElapsedSeconds = ({ startTime, elapsedSeconds, speed, outboundSeconds, jettySeconds, globeSeconds }: Timeline, now: number): number => {
  const realSeconds = Math.max((now - startTime) / 1000, 0);
  const inboundStart = outboundSeconds + jettySeconds + globeSeconds;
  const inboundSpeed = Math.min(speed, INBOUND_MAX_SPEED);
  if (elapsedSeconds >= inboundStart) {
    return elapsedSeconds + realSeconds * inboundSpeed;
  }
  const elapsed = elapsedSeconds + realSeconds * speed;
  if (elapsed <= inboundStart) {
    return elapsed;
  }
  // Past Slussen the capped speed applies to the rest of the real time.
  return inboundStart + (realSeconds - (inboundStart - elapsedSeconds) / speed) * inboundSpeed;
};

// The speed the trip actually plays at in the given phase.
export const getEffectiveSpeed = ({ speed }: Timeline, phase: TripPhase | null): number => (phase === 'inbound' ? Math.min(speed, INBOUND_MAX_SPEED) : speed);

// The next speed up from the current one, starting over after the fastest allowed.
export const getNextSpeed = (timeline: Timeline, phase: TripPhase | null): number => {
  const current = getEffectiveSpeed(timeline, phase);
  if (phase === 'inbound' && current >= INBOUND_MAX_SPEED) return TRIP_SPEEDS[0];
  return TRIP_SPEEDS.find((speed) => speed > current) ?? TRIP_SPEEDS[0];
};

// The same trip continuing from where it is, at another speed.
export const withSpeed = (timeline: Timeline, speed: number, now: number): Timeline => ({
  ...timeline,
  startTime: now,
  elapsedSeconds: getElapsedSeconds(timeline, now),
  speed
});

export const getTimelineState = (timeline: Timeline, now: number): TimelineState => {
  const { outboundSeconds, jettySeconds, globeSeconds, inboundSeconds } = timeline;
  let elapsed = getElapsedSeconds(timeline, now);
  const phases: [TripPhase, number][] = [
    ['outbound', outboundSeconds],
    ['jetty', jettySeconds],
    ['globe', globeSeconds],
    ['inbound', inboundSeconds]
  ];

  for (const [phase, seconds] of phases) {
    if (elapsed < seconds) {
      return { phase, progress: elapsed / seconds };
    }
    elapsed -= seconds;
  }
  return { phase: 'arrived', progress: 1 };
};

// Share of the long way around the globe that has been covered.
export const getGlobeProgress = ({ phase, progress }: TimelineState): number => {
  if (phase === 'outbound' || phase === 'jetty') {
    return 0;
  }
  return phase === 'globe' ? progress : 1;
};
