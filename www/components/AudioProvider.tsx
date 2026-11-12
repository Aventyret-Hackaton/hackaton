'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { isTypingTarget } from '@/components/globe/keyboard';

import styles from './AudioProvider.module.css';

export type SfxName = 'hover' | 'click' | 'confirm' | 'back' | 'swap' | 'focus' | 'not-ready' | 'start' | 'pause' | 'resume';
export type ThemeName = 'slow' | 'main';

const SFX_NAMES: readonly SfxName[] = ['hover', 'click', 'confirm', 'back', 'swap', 'focus', 'not-ready', 'start', 'pause', 'resume'];

const THEME_KEYS: Record<ThemeName, string> = { slow: 'theme-slow', main: 'theme' };
const THEME_URLS: Record<string, string> = { 'theme-slow': '/audio/theme-slow.mp3', theme: '/audio/theme.mp3' };
const sfxUrl = (name: SfxName): string => `/audio/sfx/${name}.wav`;
const MUTED_KEY = 'ptb-muted';
const THEME_VOLUME = 0.42;
const SFX_VOLUME = 0.7;
const CROSSFADE = 0.6;

// The main theme only creeps up in tempo: a touch per decade of game speed.
const rateForSpeed = (speed: number): number => 1 + 0.03 * Math.log10(Math.max(1, speed));

type AudioApi = {
  playSfx: (name: SfxName) => void;
  setGameSpeed: (effectiveSpeed: number) => void;
  setTheme: (theme: ThemeName) => void;
  muted: boolean;
  toggleMuted: () => void;
};

const AudioContextValue = createContext<AudioApi | null>(null);

export const useGameAudio = (): AudioApi => {
  const value = useContext(AudioContextValue);
  if (!value) {
    throw new Error('useGameAudio must be used within an AudioProvider');
  }
  return value;
};

const getAudioCtor = (): typeof AudioContext | undefined => window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

type ActiveTheme = { source: AudioBufferSourceNode; gain: GainNode; key: string };

export const AudioProvider = ({ children }: { children: ReactNode }): React.JSX.Element => {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const sfxGainRef = useRef<GainNode | null>(null);
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const activeThemeRef = useRef<ActiveTheme | null>(null);
  const desiredThemeRef = useRef<string>(THEME_KEYS.slow);
  const rateRef = useRef(1);
  const mutedRef = useRef(false);

  const [muted, setMuted] = useState(false);

  // Start the desired theme, or cross-fade to it if another one is playing.
  const playTheme = useCallback((key: string): void => {
    desiredThemeRef.current = key;
    const ctx = ctxRef.current;
    const master = masterRef.current;
    const buffer = buffersRef.current.get(key);
    if (!ctx || !master || !buffer || mutedRef.current) {
      return;
    }
    const active = activeThemeRef.current;
    if (active && active.key === key) {
      return;
    }
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.value = active ? 0 : THEME_VOLUME;
    gain.connect(master);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = key === THEME_KEYS.main ? rateRef.current : 1;
    source.connect(gain);
    source.start(0);
    if (active) {
      gain.gain.linearRampToValueAtTime(THEME_VOLUME, now + CROSSFADE);
      active.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE);
      active.source.stop(now + CROSSFADE + 0.05);
      const retiring = active.gain;
      window.setTimeout(
        () => {
          try {
            retiring.disconnect();
          } catch {
            // Already gone.
          }
        },
        (CROSSFADE + 0.2) * 1000
      );
    }
    activeThemeRef.current = { source, gain, key };
  }, []);

  const playSfx = useCallback((name: SfxName, force = false): void => {
    const ctx = ctxRef.current;
    const sfxGain = sfxGainRef.current;
    if (!ctx || !sfxGain || (mutedRef.current && !force)) {
      return;
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const buffer = buffersRef.current.get(name);
    if (!buffer) {
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(sfxGain);
    source.start();
  }, []);

  const setGameSpeed = useCallback((effectiveSpeed: number): void => {
    const rate = rateForSpeed(effectiveSpeed);
    rateRef.current = rate;
    const ctx = ctxRef.current;
    const active = activeThemeRef.current;
    if (ctx && active && active.key === THEME_KEYS.main) {
      active.source.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.25);
    }
  }, []);

  const setTheme = useCallback(
    (theme: ThemeName): void => {
      playTheme(THEME_KEYS[theme]);
    },
    [playTheme]
  );

  const toggleMuted = useCallback((): void => {
    const ctx = ctxRef.current;
    const master = masterRef.current;
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    try {
      window.localStorage.setItem(MUTED_KEY, next ? '1' : '0');
    } catch {
      // Storage may be unavailable; the choice then lasts only this session.
    }
    if (!ctx || !master) {
      return;
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    if (next) {
      playSfx('pause', true);
      window.setTimeout(() => master.gain.setTargetAtTime(0, ctx.currentTime, 0.08), 160);
    } else {
      master.gain.setTargetAtTime(1, ctx.currentTime, 0.08);
      playTheme(desiredThemeRef.current);
      playSfx('resume', true);
    }
  }, [playSfx, playTheme]);

  useEffect(() => {
    let disposed = false;
    const stored = (() => {
      try {
        return window.localStorage.getItem(MUTED_KEY) === '1';
      } catch {
        return false;
      }
    })();
    mutedRef.current = stored;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the persisted choice after mount
    setMuted(stored);

    const Ctor = getAudioCtor();
    if (!Ctor) {
      return;
    }
    const ctx = new Ctor();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = stored ? 0 : 1;
    master.connect(ctx.destination);
    const sfxGain = ctx.createGain();
    sfxGain.gain.value = SFX_VOLUME;
    sfxGain.connect(master);
    masterRef.current = master;
    sfxGainRef.current = sfxGain;

    const load = async (key: string, url: string): Promise<void> => {
      const response = await fetch(url);
      const data = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      if (!disposed) {
        buffersRef.current.set(key, buffer);
      }
    };
    const tryStart = (): void => {
      if (!disposed && ctx.state === 'running' && !mutedRef.current && !activeThemeRef.current) {
        playTheme(desiredThemeRef.current);
      }
    };
    void load(THEME_KEYS.slow, THEME_URLS[THEME_KEYS.slow]).then(tryStart);
    void load(THEME_KEYS.main, THEME_URLS[THEME_KEYS.main]);
    for (const name of SFX_NAMES) {
      void load(name, sfxUrl(name));
    }

    const onGesture = (): void => {
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      if (!mutedRef.current) {
        playTheme(desiredThemeRef.current);
      }
    };
    const events: ReadonlyArray<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    for (const event of events) {
      window.addEventListener(event, onGesture, { passive: true });
    }

    // Nothing plays while the page is hidden or on its way out.
    const onVisibility = (): void => {
      if (document.hidden) {
        void ctx.suspend();
      } else {
        void ctx.resume();
      }
    };
    const onPageHide = (): void => void ctx.suspend();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return (): void => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      for (const event of events) {
        window.removeEventListener(event, onGesture);
      }
      activeThemeRef.current = null;
      void ctx.close();
    };
  }, [playTheme]);

  // M mutes and unmutes from anywhere outside a text field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modified = event.metaKey || event.ctrlKey || event.altKey;
      if (!modified && !event.repeat && !isTypingTarget(event.target) && event.key.toLowerCase() === 'm') {
        toggleMuted();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, [toggleMuted]);

  const api = useMemo<AudioApi>(() => ({ playSfx, setGameSpeed, setTheme, muted, toggleMuted }), [playSfx, setGameSpeed, setTheme, muted, toggleMuted]);

  return (
    <AudioContextValue.Provider value={api}>
      {children}
      <button
        type="button"
        className={styles.toggle}
        onClick={toggleMuted}
        aria-pressed={muted}
        aria-label={muted ? 'Slå på ljud' : 'Stäng av ljud'}
        title={muted ? 'Ljud av' : 'Ljud på'}
      >
        {muted ? '♪̶' : '♪'}
      </button>
    </AudioContextValue.Provider>
  );
};
