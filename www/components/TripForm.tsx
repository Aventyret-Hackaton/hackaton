'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { useGameAudio } from '@/components/AudioProvider';
import { PlaceAutocomplete } from '@/components/PlaceAutocomplete';
import { StartScene } from '@/components/StartScene';
import { useTrip } from '@/components/TripContext';

import styles from './StartScene.module.css';

export const TripForm = (): React.JSX.Element => {
  const router = useRouter();
  const audio = useGameAudio();
  const { origin, destination, isLoaded, setOrigin, setDestination, startTrip } = useTrip();
  // Bumped on swap so both fields remount with their new place.
  const [swapNonce, setSwapNonce] = useState(0);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (origin && destination) {
      startTrip();
      audio.playSfx('start');
      router.push('/trip');
    }
  };

  const handleSwap = (): void => {
    const previousOrigin = origin;
    setOrigin(destination);
    setDestination(previousOrigin);
    setSwapNonce((nonce) => nonce + 1);
    audio.playSfx('swap');
  };

  return (
    <StartScene>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <span className={styles.tick} aria-hidden="true" />
          Planera din omväg
          <span className={styles.tick} aria-hidden="true" />
        </div>

        {/* The fields mount once stored places are known, so they start prefilled. */}
        {isLoaded && (
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.fieldRow}>
              <div className={styles.labelRow}>
                <span className={`${styles.badge} ${styles.badgeA}`} aria-hidden="true">
                  A
                </span>
                <span className={styles.fieldLabel}>Start</span>
              </div>
              <PlaceAutocomplete key={`start-${swapNonce}`} tone="dark" label="Start" placeholder="Var börjar resan?" initialPlace={origin} onChange={setOrigin} />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.labelRow}>
                <span className={`${styles.badge} ${styles.badgeB}`} aria-hidden="true">
                  B
                </span>
                <span className={styles.fieldLabel}>Mål</span>
                <button type="button" className={styles.swap} onClick={handleSwap} aria-label="Byt start och mål">
                  ⇅
                </button>
              </div>
              <PlaceAutocomplete key={`goal-${swapNonce}`} tone="dark" label="Mål" placeholder="Vart vill du komma?" initialPlace={destination} onChange={setDestination} />
            </div>

            <button
              className={styles.startBtn}
              type="submit"
              disabled={!origin || !destination}
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') {
                  audio.playSfx('hover');
                }
              }}
            >
              Starta omvägen
              <span className={styles.arrow} aria-hidden="true">
                ▶
              </span>
            </button>
          </form>
        )}
      </div>
    </StartScene>
  );
};
