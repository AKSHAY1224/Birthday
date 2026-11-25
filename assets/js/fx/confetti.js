// Confetti in our own colours, on top of the vendored canvas-confetti (global `confetti`).
// Used only at the three big moments. Does nothing when the phone asks for less motion,
// or when the library did not load.

const GOLD = ['#e8c16a', '#f6e3ae', '#b8893a', '#fffdf8'];
const ROSE = ['#d9304f', '#f0667f', '#a51f3a', '#f6e3ae'];
const HEART_PATH = 'M167 72c19-38 37-56 75-56 42 0 76 33 76 75 0 76-76 151-151 227C91 243 15 167 15 91c0-42 34-75 76-75 38 0 57 18 76 56z';
const PETAL_PATH = 'M50 0C80 30 90 70 50 100 10 70 20 30 50 0z';

let fire = null;
let shapes = null;
let disabled = false;
let rainTimer = 0;

function ready() {
  if (disabled) return false;
  if (fire) return true;
  try {
    const library = window.confetti;
    const canvas = document.querySelector('.fx-confetti');
    if (typeof library !== 'function' || !canvas) return false;
    fire = library.create(canvas, { resize: true, useWorker: false, disableForReducedMotion: true });
    shapes = {
      heart: library.shapeFromPath({ path: HEART_PATH }),
      petal: library.shapeFromPath({ path: PETAL_PATH }),
    };
    return true;
  } catch {
    fire = null;
    return false;
  }
}

function options(preset) {
  if (preset === 'hearts') return { colors: ROSE, shapes: [shapes.heart], scalar: 1.5, gravity: 0.7, ticks: 220 };
  if (preset === 'petals') return { colors: ROSE, shapes: [shapes.petal], scalar: 1.7, gravity: 0.45, drift: 0.6, ticks: 320 };
  return { colors: GOLD, shapes: ['circle', 'square'], scalar: 0.9, gravity: 0.9, ticks: 200 };
}

export const confetti = {
  /** Call once at start-up. */
  init({ reducedMotion = false } = {}) {
    disabled = reducedMotion;
  },

  /** One burst from the point (x, y) in screen pixels. preset: 'gold' | 'hearts' | 'petals'. */
  burst(x, y, { preset = 'gold', count = 70, spread = 75 } = {}) {
    if (!ready()) return;
    try {
      fire({
        ...options(preset),
        particleCount: count,
        spread,
        startVelocity: 34,
        origin: { x: x / Math.max(1, window.innerWidth), y: y / Math.max(1, window.innerHeight) },
      });
    } catch {
      // decoration only
    }
  },

  /** A soft fall from the top for durationMs. Returns a function that stops it early. */
  rain(durationMs = 4000, preset = 'gold') {
    if (!ready()) return () => {};
    clearInterval(rainTimer);
    const endAt = performance.now() + durationMs;
    const drop = () => {
      if (performance.now() > endAt || document.visibilityState === 'hidden') {
        if (performance.now() > endAt) clearInterval(timer);
        return;
      }
      try {
        fire({ ...options(preset), particleCount: 5, spread: 100, startVelocity: 12, angle: 270, origin: { x: Math.random(), y: -0.05 } });
      } catch {
        clearInterval(timer);
      }
    };
    const timer = setInterval(drop, 160);
    rainTimer = timer;
    return () => clearInterval(timer);
  },

  /** Removes every piece at once (call it in exit()). */
  clear() {
    clearInterval(rainTimer);
    try {
      fire?.reset();
    } catch {
      // nothing to clear
    }
  },
};
