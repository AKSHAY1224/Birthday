// Hand-written canvas fireworks: rockets rise and burst into falling, fading sparks in gold, rose and white.
// Shared by the midnight screen and later chapters:
//   fireworks.start({ durationMs: 9000, intensity: 1, onBurst })   launches rockets by itself for durationMs
//   fireworks.start({ …, band: [0.05, 0.15] })                      … and keeps the bursts in that share of the height
//   fireworks.launchAt(x, y)                                        one extra rocket that bursts at (x, y) in screen pixels
//   fireworks.stop()                                                stops and removes everything at once
//   fireworks.stop({ fadeMs: 600 })                                 no new rockets; what is in the air fades away
// The canvas sits behind the words (between the sky and the stage), is sharp up to devicePixelRatio 2,
// pauses while the tab is hidden and removes itself when the last spark is gone.
// When the phone asks for less motion there are no rockets: a soft glow breathes in and out instead.

const PALETTES = [
  ['#e8c16a', '#f6e3ae', '#fffdf8'], // gold
  ['#d9304f', '#f0667f', '#f6e3ae'], // rose
  ['#fffdf8', '#f5efe2', '#f6e3ae'], // white
  ['#e8c16a', '#f0667f', '#fffdf8'], // mixed
];
const MAX_SPARKS = 900;
const MAX_DPR = 2;
const GRAVITY = 0.00042; // px per ms²
const GLOW_MS = 2600;
const BAND = [0.14, 0.46]; // where the rockets burst, as shares of the height (top, bottom)

let canvas = null;
let pen = null;
let glow = null;
let glowTimer = 0;
let fadeTimer = 0; // runs while a stopped show fades away
let band = BAND;
let frame = 0;
let last = 0;
let width = 0;
let height = 0;
let ratio = 1;
let rockets = [];
let sparks = [];
let launchUntil = 0;
let nextLaunchAt = 0;
let rate = 1;
let burstListener = null;
let listening = false;

const prefersCalm = () => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (min, max) => min + Math.random() * (max - min);

function layer(tag, front) {
  const el = document.createElement(tag);
  el.setAttribute('aria-hidden', 'true');
  el.className = 'fx-fireworks';
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: front ? 'var(--z-fx)' : 'calc(var(--z-sky) + 1)',
  });
  return el;
}

function resize() {
  if (!canvas) return;
  ratio = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  pen.setTransform(ratio, 0, 0, ratio, 0, 0);
}

/** A show that was fading away is wanted again: the canvas stays and is fully visible at once. */
function cancelFade() {
  if (!fadeTimer) return;
  clearTimeout(fadeTimer);
  fadeTimer = 0;
  if (canvas) {
    canvas.style.transition = 'none';
    canvas.style.opacity = '1';
  }
}

function ensureCanvas(front) {
  cancelFade();
  if (canvas) return true;
  try {
    const el = layer('canvas', front);
    const context = el.getContext('2d');
    if (!context) return false;
    canvas = el;
    pen = context;
    document.body.append(canvas);
    resize();
    if (!listening) {
      listening = true;
      window.addEventListener('resize', resize);
      document.addEventListener('visibilitychange', onVisibility);
    }
    return true;
  } catch {
    canvas = null;
    pen = null;
    return false;
  }
}

function removeCanvas() {
  clearTimeout(fadeTimer);
  fadeTimer = 0;
  cancelAnimationFrame(frame);
  frame = 0;
  last = 0;
  if (listening) {
    listening = false;
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
  }
  canvas?.remove();
  canvas = null;
  pen = null;
  rockets = [];
  sparks = [];
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  } else if (canvas && !frame) {
    frame = requestAnimationFrame(loop);
  }
}

function addRocket(x, targetY, fromX = x + between(-40, 40)) {
  const flight = between(620, 900);
  rockets.push({
    x: fromX,
    y: height + 8,
    fromX,
    toX: x,
    toY: targetY,
    age: 0,
    flight,
    colours: pick(PALETTES),
  });
}

function burst(x, y, colours) {
  const room = MAX_SPARKS - sparks.length;
  const count = Math.min(room, Math.round(between(54, 84)));
  const power = between(0.16, 0.26);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + between(-0.05, 0.05);
    const speed = power * (0.45 + Math.random() * 0.65);
    sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: between(1100, 1900),
      size: between(1.1, 2.3),
      colour: pick(colours),
      twinkle: Math.random() < 0.3,
    });
  }
  if (burstListener) {
    try {
      burstListener(x, y);
    } catch {
      // decoration only
    }
  }
}

function step(delta, time) {
  if (time < launchUntil && time >= nextLaunchAt) {
    const [top, bottom] = band;
    addRocket(between(width * 0.14, width * 0.86), between(height * top, height * bottom));
    if (rate > 1.2 && Math.random() < 0.35) addRocket(between(width * 0.14, width * 0.86), between(height * top, height * (bottom - (bottom - top) * 0.19)));
    nextLaunchAt = time + between(380, 880) / Math.max(0.2, rate);
  }

  for (const rocket of rockets) {
    rocket.age += delta;
    const t = Math.min(1, rocket.age / rocket.flight);
    const eased = 1 - (1 - t) * (1 - t);
    rocket.px = rocket.x;
    rocket.py = rocket.y;
    rocket.x = rocket.fromX + (rocket.toX - rocket.fromX) * eased;
    rocket.y = height + 8 + (rocket.toY - height - 8) * eased;
    if (t >= 1) {
      rocket.done = true;
      burst(rocket.toX, rocket.toY, rocket.colours);
    }
  }
  rockets = rockets.filter((rocket) => !rocket.done);

  const drag = Math.pow(0.9982, delta);
  for (const spark of sparks) {
    spark.age += delta;
    spark.px = spark.x;
    spark.py = spark.y;
    spark.vx *= drag;
    spark.vy = spark.vy * drag + GRAVITY * delta;
    spark.x += spark.vx * delta;
    spark.y += spark.vy * delta;
  }
  sparks = sparks.filter((spark) => spark.age < spark.life && spark.y < height + 20);
}

function draw() {
  // fade what is already there instead of clearing it: this leaves the soft trails
  pen.globalCompositeOperation = 'destination-out';
  pen.fillStyle = 'rgba(0, 0, 0, 0.2)';
  pen.fillRect(0, 0, width, height);
  pen.globalCompositeOperation = 'lighter';
  pen.lineCap = 'round';

  for (const rocket of rockets) {
    pen.globalAlpha = 0.9;
    pen.strokeStyle = rocket.colours[1];
    pen.lineWidth = 2;
    pen.beginPath();
    pen.moveTo(rocket.px ?? rocket.x, rocket.py ?? rocket.y);
    pen.lineTo(rocket.x, rocket.y);
    pen.stroke();
  }

  for (const spark of sparks) {
    const left = 1 - spark.age / spark.life;
    let alpha = left < 0.6 ? left / 0.6 : 1;
    if (spark.twinkle && left < 0.7) alpha *= 0.45 + 0.55 * Math.abs(Math.sin(spark.age * 0.03));
    pen.globalAlpha = Math.max(0, alpha);
    pen.strokeStyle = spark.colour;
    pen.lineWidth = spark.size * (0.5 + 0.5 * left);
    pen.beginPath();
    pen.moveTo(spark.px, spark.py);
    pen.lineTo(spark.x, spark.y);
    pen.stroke();
  }
  pen.globalAlpha = 1;
}

function loop(time) {
  if (!canvas) return;
  const delta = last ? Math.min(48, time - last) : 16;
  last = time;
  step(delta, time);
  draw();
  if (time >= launchUntil && rockets.length === 0 && sparks.length === 0) {
    removeCanvas(); // the show is over: leave nothing behind
    return;
  }
  frame = requestAnimationFrame(loop);
}

function run() {
  if (!frame && document.visibilityState !== 'hidden') frame = requestAnimationFrame(loop);
}

function showGlow(durationMs, front) {
  try {
    clearTimeout(glowTimer);
    glow?.remove();
    glow = layer('div', front);
    glow.style.background =
      'radial-gradient(70% 46% at 50% 30%, rgba(232, 193, 106, 0.34) 0%, rgba(240, 102, 127, 0.12) 46%, rgba(232, 193, 106, 0) 76%)';
    glow.style.opacity = '0';
    glow.style.transition = 'opacity 900ms linear';
    document.body.append(glow);
    void glow.offsetWidth;
    glow.style.opacity = '1';
    const el = glow;
    glowTimer = setTimeout(
      () => {
        el.style.opacity = '0';
        glowTimer = setTimeout(() => {
          el.remove();
          if (glow === el) glow = null;
        }, 950);
      },
      Math.max(GLOW_MS, Math.min(durationMs, 6000)),
    );
  } catch {
    glow = null;
  }
}

export const fireworks = {
  /**
   * Starts a show. durationMs: how long new rockets are launched. intensity: about rockets per second (0.5 calm … 2 grand).
   * onBurst(x, y): called on every burst (for a sound or a vibration). front: true draws above the words.
   * reducedMotion: pass ctx.reducedMotion; when true (or when the phone asks for it) only a soft glow is shown.
   * band: [top, bottom] as shares of the height (default 0.14 to 0.46) — where the rockets burst, for a scene
   * whose centre must stay readable.
   */
  start({ durationMs = 8000, intensity = 1, onBurst = null, front = false, reducedMotion = false, band: wanted = null } = {}) {
    burstListener = typeof onBurst === 'function' ? onBurst : null;
    const [top, bottom] = Array.isArray(wanted) ? wanted.map(Number) : BAND;
    band = top >= 0 && bottom > top && bottom <= 1 ? [top, bottom] : BAND;
    if (reducedMotion || prefersCalm()) {
      showGlow(durationMs, front);
      return;
    }
    if (!ensureCanvas(front)) return;
    const time = performance.now();
    rate = Math.max(0.2, Math.min(3, Number(intensity) || 1));
    launchUntil = time + Math.max(0, durationMs);
    nextLaunchAt = time;
    // an opening salvo, so the sky answers at once (at 24 %, 36 % and 33 % of the height in the usual band)
    const at = (share) => height * (band[0] + (band[1] - band[0]) * share);
    addRocket(width * 0.5, at(0.31), width * 0.5);
    addRocket(width * 0.22, at(0.69));
    addRocket(width * 0.78, at(0.59));
    run();
  },

  /** One extra rocket that bursts at (x, y) in screen pixels — for taps. Does nothing in calm mode. */
  launchAt(x, y) {
    if (prefersCalm() || glow) return;
    if (!ensureCanvas(false)) return;
    if (rockets.length > 14) return;
    const px = Math.max(12, Math.min(width - 12, Number(x) || width / 2));
    const py = Math.max(12, Math.min(height * 0.9, Number(y) || height / 3));
    addRocket(px, py, px + between(-24, 24));
    run();
  },

  /** True while rockets or sparks are on screen. */
  isRunning: () => Boolean(canvas),

  /**
   * Stops the show and removes the canvas (and the calm-mode glow). Safe to call any time.
   * fadeMs: no new rockets and no more burst sounds, and what is in the air fades away over that time —
   * for a screen that is left, or a button tapped, in the middle of a show. Without it everything is gone at once.
   */
  stop({ fadeMs = 0 } = {}) {
    burstListener = null;
    launchUntil = 0;
    const ms = Math.max(0, Number(fadeMs) || 0);
    clearTimeout(glowTimer);
    if (ms === 0 || document.visibilityState === 'hidden') {
      removeCanvas();
      glow?.remove();
      glow = null;
      return;
    }
    if (canvas && !fadeTimer) {
      rockets = []; // nothing new bursts while the rest fades
      canvas.style.transition = `opacity ${ms}ms linear`;
      canvas.style.opacity = '0';
      fadeTimer = setTimeout(removeCanvas, ms);
    }
    if (glow) {
      const el = glow;
      glow = null;
      el.style.transition = `opacity ${ms}ms linear`;
      el.style.opacity = '0';
      setTimeout(() => el.remove(), ms);
    }
  },
};

export default fireworks;
