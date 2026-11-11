'use client';

import { useRouter } from 'next/navigation';

import { PlaceAutocomplete } from '@/components/PlaceAutocomplete';
import { StartScene } from '@/components/StartScene';
import { useTrip } from '@/components/TripContext';

import styles from './StartScene.module.css';

export const TripForm = (): React.JSX.Element => {
  const router = useRouter();
  const { origin, destination, isLoaded, setOrigin, setDestination } = useTrip();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (origin && destination) {
      router.push('/trip');
    }
  };

  return (
    <StartScene>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Stockholm · den långa vägen</p>
        <h1 className={styles.title}>Vart vill du?</h1>
        <p className={styles.subtitle}>Två punkter i stan. En onödigt lång väg runt jorden.</p>
        {/* The fields mount once stored places are known, so they start prefilled. */}
        {isLoaded && (
          <form className={styles.form} onSubmit={handleSubmit}>
            <PlaceAutocomplete label="Från" initialPlace={origin} onChange={setOrigin} />
            <PlaceAutocomplete label="Till" initialPlace={destination} onChange={setDestination} />
            <button className={styles.submit} type="submit" disabled={!origin || !destination}>
              Planera resa
            </button>
          </form>
        )}
      </div>
    </StartScene>
  );
};
