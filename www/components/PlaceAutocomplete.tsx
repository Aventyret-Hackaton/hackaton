'use client';

import { useEffect, useId, useRef, useState } from 'react';

import type { Place, PlaceSuggestion } from '@/lib/places';

import styles from './PlaceAutocomplete.module.css';

type PlaceAutocompleteProps = {
  label: string;
  initialPlace?: Place | null;
  placeholder?: string;
  tone?: 'light' | 'dark';
  onChange: (place: Place | null) => void;
};

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

export const PlaceAutocomplete = ({ label, initialPlace, placeholder, tone = 'light', onChange }: PlaceAutocompleteProps): React.JSX.Element => {
  const id = useId();
  const [query, setQuery] = useState(initialPlace?.address ?? '');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  // Suggestions are only fetched while the user is typing, not after a selection.
  const [isSearching, setIsSearching] = useState(false);
  const sessionToken = useRef<string>('');

  useEffect(() => {
    const input = query.trim();
    if (!isSearching || input.length < MIN_QUERY_LENGTH) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      sessionToken.current ||= crypto.randomUUID();
      const params = new URLSearchParams({ input, sessionToken: sessionToken.current });
      try {
        const response = await fetch(`/api/places/autocomplete?${params}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error('Autocomplete failed');
        }
        const data = (await response.json()) as { suggestions: PlaceSuggestion[] };
        setSuggestions(data.suggestions);
        setActiveIndex(-1);
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setError('Kunde inte hämta förslag.');
        }
      }
    }, DEBOUNCE_MS);

    return (): void => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, isSearching]);

  const handleInput = (value: string): void => {
    setQuery(value);
    setIsSearching(true);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
    }
    setError(null);
    onChange(null);
  };

  const handleSelect = async ({ placeId, text }: PlaceSuggestion): Promise<void> => {
    setQuery(text);
    setIsSearching(false);
    setSuggestions([]);

    const params = new URLSearchParams({ sessionToken: sessionToken.current });
    // A session ends when place details are fetched.
    sessionToken.current = '';
    try {
      const response = await fetch(`/api/places/${encodeURIComponent(placeId)}?${params}`);
      if (response.status === 422) {
        setError('Platsen måste ligga i Stockholm.');
        return;
      }
      if (!response.ok) {
        throw new Error('Place lookup failed');
      }
      const data = (await response.json()) as { place: Place };
      onChange(data.place);
    } catch {
      setError('Kunde inte hämta platsen.');
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (suggestions.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      void handleSelect(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      setSuggestions([]);
    }
  };

  const isOpen = suggestions.length > 0;

  return (
    <div className={`${styles.field}${tone === 'dark' ? ` ${styles.dark}` : ''}${isOpen ? ` ${styles.open}` : ''}`}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        className={styles.input}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={isOpen}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        placeholder={placeholder}
        value={query}
        onChange={(event) => handleInput(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <ul className={styles.list} id={`${id}-list`} role="listbox" hidden={!isOpen}>
        {suggestions.map((suggestion, index) => (
          <li
            key={suggestion.placeId}
            className={`${styles.option}${index === activeIndex ? ` ${styles.active}` : ''}`}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            onClick={() => void handleSelect(suggestion)}
          >
            {suggestion.text}
          </li>
        ))}
      </ul>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
