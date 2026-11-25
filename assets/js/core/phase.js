// countdown → birthday → keepsake, computed from the one clock. Keeps <html data-phase> current.
// Two rules: the countdown is left only on a trusted clock (the server has answered and the phone clock
// has not jumped since), and the unlock is one-way (only a fresh answer of the server can take it back).
import { BIRTHDAY_LENGTH_MS, TARGET_MS } from '../config.js';
import * as clock from './clock.js';

export const COUNTDOWN = 'countdown';
export const BIRTHDAY = 'birthday';
export const KEEPSAKE = 'keepsake';

const ORDER = [COUNTDOWN, BIRTHDAY, KEEPSAKE];
const CONFIRM_FRESH_MS = 30 * 1000;
const RELOCK_MARGIN_MS = 5000; // two answers of the server differ by less than this

let current = COUNTDOWN;
let started = false;
let confirming = false;
const listeners = new Set();

export const phaseAt = (ms) => (ms < TARGET_MS ? COUNTDOWN : ms < TARGET_MS + BIRTHDAY_LENGTH_MS ? BIRTHDAY : KEEPSAKE);

/** The phase right now. */
export const get = () => current;

/** Milliseconds until the unlock (negative after it). */
export const msToTarget = () => TARGET_MS - clock.now();

/** callback(newPhase, oldPhase) fires exactly when the phase changes. Returns a function that stops it. */
export function onChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function commit(next) {
  if (next === current) return;
  const previous = current;
  current = next;
  document.documentElement.dataset.phase = next;
  for (const listener of [...listeners]) {
    try {
      listener(next, previous);
    } catch {
      // a broken listener must not stop the others
    }
  }
}

function evaluate() {
  const next = phaseAt(clock.now());
  if (next === current || confirming) return;

  if (current === COUNTDOWN) {
    // Leaving the countdown is the one decision that must be right. A clock that is not trusted
    // opens nothing: clock.js keeps asking the server and ticks again when it has answered.
    if (!clock.isTrusted()) return;
    // Trusted, but not checked in the last 30 seconds: ask once more (it answers in a moment, or not
    // at all — then the last good answer still counts, so no network at midnight is no problem).
    if (!clock.isFresh(CONFIRM_FRESH_MS)) {
      confirming = true;
      clock.sync().finally(() => {
        confirming = false;
        if (clock.isTrusted()) commit(phaseAt(clock.now()));
      });
      return;
    }
    commit(next);
    return;
  }

  if (ORDER.indexOf(next) < ORDER.indexOf(current)) {
    // Backwards: only on a fresh answer of the server, and back into the countdown only if the real
    // time is clearly before the unlock (not the small difference between two answers).
    if (!clock.isTrusted() || !clock.answeredWithin(CONFIRM_FRESH_MS)) return;
    if (next === COUNTDOWN && clock.now() > TARGET_MS - RELOCK_MARGIN_MS) return;
  }
  commit(next);
}

/**
 * Works out the first phase and starts following the clock. Resolves with the first phase.
 * Without an answer of the server the first phase is always the countdown, whatever the phone says.
 */
export async function start() {
  if (started) return current;
  started = true;
  await clock.start();
  current = clock.isTrusted() ? phaseAt(clock.now()) : COUNTDOWN;
  document.documentElement.dataset.phase = current;
  clock.onTick(evaluate);
  return current;
}
