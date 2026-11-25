// Vibration is a bonus: phones without it (or with it switched off) simply feel nothing.

function buzz(pattern) {
  try {
    if (typeof navigator.vibrate === 'function') return navigator.vibrate(pattern);
  } catch {
    // not allowed here: ignore
  }
  return false;
}

export const haptics = {
  /** A light touch, for buttons. */
  tap: () => buzz(12),
  /** Two short pulses, for something that worked. */
  success: () => buzz([18, 60, 28]),
  /** lub-dub */
  heartbeat: () => buzz([40, 110, 60]),
  /** Any pattern: a number of milliseconds or [on, off, on, …]. */
  buzz,
  stop: () => buzz(0),
};
