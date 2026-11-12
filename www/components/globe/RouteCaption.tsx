import { APP_TAGLINE } from '@/lib/globe/journey';

import styles from './RouteCaption.module.css';

type RouteCaptionProps = {
  // Names of the start and the goal. Without them the caption carries the tagline.
  places?: readonly [origin: string, destination: string];
};

export const RouteCaption = ({ places }: RouteCaptionProps): React.JSX.Element => (
  <div className={styles.caption}>
    {places ? (
      <>
        <span className={styles.route}>A</span>
        <span className={styles.place}>{places[0]}</span>
        <span className={styles.arrow}>→</span>
        <span className={styles.route}>B</span>
        <span className={styles.place}>{places[1]}</span>
      </>
    ) : (
      <>
        <span className={styles.route}>
          A <span className={styles.arrow}>→</span> B
        </span>
        <span>{APP_TAGLINE}</span>
      </>
    )}
  </div>
);
