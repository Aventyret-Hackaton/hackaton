export type TripPhase = 'outbound' | 'globe' | 'inbound' | 'arrived';

export type Timeline = {
  // performance.now() timestamp of departure.
  startTime: number;
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

export const getTimelineState = ({ startTime, outboundSeconds, globeSeconds, inboundSeconds }: Timeline, now: number): TimelineState => {
  let elapsed = Math.max((now - startTime) / 1000, 0);
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
