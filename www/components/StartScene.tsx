import type { ReactNode } from 'react';

import styles from './StartScene.module.css';

type StartSceneProps = {
  children: ReactNode;
};

// The game backdrop is a fixed-aspect stage so the UI panel stays locked over
// the baked-in art regardless of viewport size.
export const StartScene = ({ children }: StartSceneProps): React.JSX.Element => (
  <div className={styles.stage}>
    <div className={styles.board}>{children}</div>
  </div>
);
