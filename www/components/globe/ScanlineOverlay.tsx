'use client';

import { useEffect, useState } from 'react';

import { isTypingTarget } from './keyboard';
import styles from './ScanlineOverlay.module.css';
import type { KeyHint } from './VoxelGlobe';

export const SCANLINE_HINT: readonly KeyHint[] = [['C', 'scanlines av / på']];

// Very faint CRT lines over the whole screen, switched off and on with C.
export const ScanlineOverlay = (): React.JSX.Element | null => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      if (!modified && !event.repeat && !isTypingTarget(event.target) && event.key.toLowerCase() === 'c') {
        setVisible((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return visible ? <div className={styles.overlay} aria-hidden="true" /> : null;
};
