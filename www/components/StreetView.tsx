'use client';

import { useEffect, useState } from 'react';

import type { StreetFrame, StreetLegs } from '@/lib/streetRoute';
import { getStreetSpeed, getTimelineState, type Timeline, type TimelineState } from '@/lib/timeline';

import styles from './StreetView.module.css';

type StreetViewProps = {
  legs: StreetLegs | null;
  timeline: Timeline;
};

type View = {
  phase: TimelineState['phase'];
  frameIndex: number;
  remainingMinutes: number;
};

const TICK_MS = 100;
// Number of upcoming frames that are loaded ahead of time.
const PRELOAD_FRAMES = 3;
const MAX_FADE_SECONDS = 1.5;

const getFrameUrl = ({ latitude, longitude, heading }: StreetFrame): string => {
  const params = new URLSearchParams({
    lat: latitude.toFixed(6),
    lng: longitude.toFixed(6),
    heading: String(heading)
  });
  return `/api/streetview?${params}`;
};

const Avatar = (): React.JSX.Element => (
  <svg className={styles.avatar} viewBox="0 0 60 100" role="img" aria-label="Du, sedd bakifrån">
    <circle cx="30" cy="16" r="12" fill="#5b3a1e" />
    <rect x="16" y="30" width="28" height="36" rx="6" fill="#f25f4c" />
    <rect x="21" y="34" width="18" height="24" rx="4" fill="#6fe3b4" />
    <rect x="8" y="32" width="7" height="28" rx="3" fill="#f25f4c" />
    <rect x="45" y="32" width="7" height="28" rx="3" fill="#f25f4c" />
    <rect x="18" y="66" width="10" height="30" rx="3" fill="#1d2b53" />
    <rect x="32" y="66" width="10" height="30" rx="3" fill="#1d2b53" />
  </svg>
);

export const StreetView = ({ legs, timeline }: StreetViewProps): React.JSX.Element => {
  const [view, setView] = useState<View>({ phase: 'outbound', frameIndex: 0, remainingMinutes: 0 });
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());

  const outboundCount = legs?.outbound.frames.length ?? 0;
  const inboundCount = legs?.inbound.frames.length ?? 0;

  useEffect(() => {
    const update = (): void => {
      const { phase, progress, remainingSeconds } = getTimelineState(timeline, performance.now());
      const count = phase === 'outbound' ? outboundCount : inboundCount;
      const frameIndex = Math.max(Math.min(Math.floor(progress * count), count - 1), 0);
      const remainingMinutes = Math.ceil(remainingSeconds / 60);
      setView((previous) =>
        previous.phase === phase && previous.frameIndex === frameIndex && previous.remainingMinutes === remainingMinutes ? previous : { phase, frameIndex, remainingMinutes }
      );
    };
    update();
    const interval = setInterval(update, TICK_MS);
    return (): void => clearInterval(interval);
  }, [timeline, outboundCount, inboundCount]);

  if (view.phase === 'globe') {
    return (
      <div className={styles.viewport}>
        <p className={styles.message}>Det här räknas också som en resa.</p>
      </div>
    );
  }

  const isOutbound = view.phase === 'outbound';
  const leg = isOutbound ? legs?.outbound : legs?.inbound;
  const frames = leg?.frames ?? [];
  // Real seconds each frame is on screen at the current speed.
  const frameSeconds = leg && frames.length > 0 ? leg.durationSeconds / frames.length / getStreetSpeed(timeline) : 0;
  const fadeSeconds = Math.min(MAX_FADE_SECONDS, frameSeconds / 2);
  const urls = frames.map(getFrameUrl);
  // Fall back to the latest frame that has imagery.
  const visibleIndex = urls.findLastIndex((url, index) => index <= view.frameIndex && !failedUrls.has(url));

  // The previous frame stays mounted underneath while the new one fades in.
  const previousIndex = urls.findLastIndex((url, index) => index < visibleIndex && !failedUrls.has(url));

  const handleError = (url: string): void => {
    setFailedUrls((previous) => new Set(previous).add(url));
  };

  return (
    <div>
      <div className={styles.viewport}>
        {urls.map((url, index) => {
          const isShown = index === visibleIndex || index === previousIndex;
          const isPreloading = index > visibleIndex && index <= view.frameIndex + PRELOAD_FRAMES;
          if (!isShown && !isPreloading) {
            return null;
          }
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              className={`${styles.frame} ${isShown ? styles.zooming : ''} ${index === visibleIndex ? styles.visible : ''}`}
              style={{ '--frame-seconds': `${frameSeconds}s`, '--fade-seconds': `${fadeSeconds}s` } as React.CSSProperties}
              src={url}
              alt=""
              onError={() => handleError(url)}
            />
          );
        })}
        {visibleIndex === -1 && <p className={styles.message}>{legs ? 'Gatuvyn kom inte fram.' : 'Gatuvyn kom inte fram. Försök igen.'}</p>}
        <Avatar />
      </div>
      {legs && (
        <p>
          {view.phase === 'arrived' && 'Framme. Nu då?'}
          {view.phase === 'outbound' && `Lämnar Stockholm · utfart ${legs.exit.name} · ${view.remainingMinutes} min kvar`}
          {view.phase === 'inbound' && `Tillbaka i Stockholm · infart ${legs.entry.name} · ${view.remainingMinutes} min kvar`}
        </p>
      )}
    </div>
  );
};
