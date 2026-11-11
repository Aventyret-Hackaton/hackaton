// True when the key press belongs to a form field rather than the globe.
export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
