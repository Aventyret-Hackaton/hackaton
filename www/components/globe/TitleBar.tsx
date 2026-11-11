import { APP_TITLE } from '@/lib/globe/journey';

import styles from './TitleBar.module.css';

export const TitleBar = (): React.JSX.Element => (
  <header className={styles.header}>
    <span className={styles.stripes} aria-hidden="true" />
    <h1 className={styles.title}>{APP_TITLE}</h1>
    <span className={styles.stripes} aria-hidden="true" />
  </header>
);
