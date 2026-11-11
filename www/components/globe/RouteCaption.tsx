import { APP_TAGLINE } from '@/lib/globe/journey';

import styles from './RouteCaption.module.css';

type RouteCaptionProps = {
  // Optional line under the caption, such as the chosen addresses.
  detail?: string;
};

export const RouteCaption = ({ detail }: RouteCaptionProps): React.JSX.Element => (
  <div className={styles.wrap}>
    <div className={styles.caption}>
      <span className={styles.route}>
        A <span className={styles.arrow}>→</span> B
      </span>
      <span>{APP_TAGLINE}</span>
    </div>
    {detail && <p className={styles.detail}>{detail}</p>}
  </div>
);
