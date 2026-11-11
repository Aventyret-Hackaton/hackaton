export type TripPhase = 'outbound' | 'globe' | 'inbound' | 'arrived';

// Trip seconds per real second, 1 is real time.
export const TRIP_SPEEDS = [1, 100, 10000, 100000, 1000000, 10000000] as const;

export type Timeline = {
  // performance.now() timestamp of when the current speed was set.
  startTime: number;
  // Trip seconds that had been travelled at that time.
  elapsedSeconds: number;
  speed: number;
  outboundSeconds: number;
  globeSeconds: number;
  inboundSeconds: number;
};

export type TimelineState = {
  phase: TripPhase;
  // Progress within the current phase, 0 to 1.
  progress: number;
};

const getElapsedSeconds = ({ startTime, elapsedSeconds, speed }: Timeline, now: number): number => elapsedSeconds + Math.max((now - startTime) / 1000, 0) * speed;

// The same trip continuing from where it is, at another speed.
export const withSpeed = (timeline: Timeline, speed: number, now: number): Timeline => ({
  ...timeline,
  startTime: now,
  elapsedSeconds: getElapsedSeconds(timeline, now),
  speed
});

export const getTimelineState = (timeline: Timeline, now: number): TimelineState => {
  const { outboundSeconds, globeSeconds, inboundSeconds } = timeline;
  let elapsed = getElapsedSeconds(timeline, now);
  const phases: [TripPhase, number][] = [
    ['outbound', outboundSeconds],
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
  if (phase === 'outbound') {
    return 0;
  }
  return phase === 'globe' ? progress : 1;
};
