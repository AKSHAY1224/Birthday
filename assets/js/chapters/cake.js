// Chapter "cake" (The cake) — the signature of the site once more: Vartika means the wick of a
// lamp, so one flame never goes out.
// 1. The lights are low, seven candles burn, a music box plays "Happy Birthday"; she makes a wish.
// 2. She taps the button: the instruction appears and the microphone is asked for (inside that tap).
// 3. She blows: the flames bend and go out one by one from the outside in; if she stops, the rest
//    recover. A tap on a flame always works too.
// 4. No microphone (refused, missing, broken, or nothing heard for a while): the "no mic" line and a
//    quiet button with its own words that blows for her; tapping the flames works as before.
//    While the microphone listens the candles go out without their "puff" sound (all but the last):
//    the phone's own speaker must not be heard as a breath.
// 5. The gold flame in the middle bends, flickers and comes back — it can never be put out.
// 6. One flame and one line in the dark; then the celebration and the button to go on.
// Interface: mount builds the DOM once, enter resets and starts, exit stops everything (timers,
// listeners, the loop, the microphone, the audio nodes), complete finishes at once (safe to call twice).
import { buildScreen, h, scope, svg, touched } from '../core/dom.js';
import { create as createFlame } from '../fx/flame.js';
import { fireworks } from '../fx/fireworks.js';

// ───────────── the cake, in numbers (a 300 x 280 drawing) ─────────────

const VIEW_W = 300;
const VIEW_H = 280;
const MIDDLE = 3; // the gold candle
const ORDER = [0, 6, 1, 5, 2, 4]; // the six go out from the outside in
const CANDLE_X = [81, 104, 127, 150, 173, 196, 219];
const CANDLE_BASE = [100.5, 102, 103.5, 104.5, 103.5, 102, 100.5];
const STICK = { width: 6.4, height: 30 };
const GOLD_STICK = { width: 8.4, height: 41 };
const WICK = 4.5;
const HEART = 'M12 20.6C5.6 15.9 2.5 12.4 2.5 8.6 2.5 5.8 4.6 3.8 7.2 3.8c1.9 0 3.5 1 4.8 2.9 1.3-1.9 2.9-2.9 4.8-2.9 2.6 0 4.7 2 4.7 4.8 0 3.8-3.1 7.3-9.5 12z';
const DECOR = { 'aria-hidden': 'true' };

// ───────────── the ritual, in numbers ─────────────

const WISH_AT_MS = 500; // the wish line, after the cake has appeared
const TUNE_AFTER_MS = 1300; // the music box starts when the background music has faded
const TUNE_REST_MS = 2600; // silence before the music box plays once more
const TAP_REACH = 58; // px: a tap this close to a flame counts for that flame
const NO_BLOW_AFTER_MS = 10000; // nothing heard for this long: offer the taps (she needs a moment to read, laugh and lean in)
const NO_ANSWER_AFTER_MS = 12000; // the permission question left open for this long: offer the taps
const FIRST_NEED_MS = 420; // steady blowing until the first candle goes out …
const NEXT_NEED_MS = 300; // … and for each one after it
const STAYS_AT_MS = 1100; // the six are out → the line of the one that stays
const PARTY_AT_MS = 4000; // … → the celebration
const BUTTON_AFTER_MS = 2400; // … → the button
const QUICK_STAYS_AT_MS = 700; // the same three after "blow for me"
const QUICK_PARTY_AT_MS = 2500;
const SKIP_STEP_MS = 110; // "blow for me": one candle after the other
const PARTY_GUARD_MS = 900; // the tap that brought the celebration must not run on through it
const FIREWORKS_MS = 6500;
const FIREWORKS_OUT_MS = 600; // leaving mid-show: the sparks fade with the screen
const PETALS_MS = 2400;

// ───────────── hearing a breath (no speech recognition, only loudness) ─────────────

const FRAME = 1024; // samples looked at per frame
const LOW_HZ = 400; // a breath on a microphone is mostly a low rumble; a phone speaker has none
const FULL_PENALTY_DB = 10; // any loud sound counts too, but 10 dB less
const SETTLE_MS = 120; // the microphone clicks when it starts
const CALIBRATE_MS = 500; // then the room is measured
const FLOOR_MIN_DB = -70;
const FLOOR_MAX_DB = -42;
const OVER_FLOOR_DB = 18; // a breath is this much louder than the room …
const ON_MIN_DB = -36; // … but the line is never lower than this
const ON_MAX_DB = -22; // … and never higher than this (a loud room must not make it impossible)
const OFF_GAP_DB = 6; // it ends when the level falls this far below the line
const ATTACK_MS = 140; // above the line for this long = she is blowing (a click or a beep is not)
const RELEASE_MS = 160; // below it for this long = she stopped

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const decibel = (rms) => 20 * Math.log10(rms + 1e-7);

/**
 * Decides from raw microphone samples whether somebody is blowing.
 *   const detector = createBlowDetector(sampleRate);
 *   detector.push(float32Samples, timeMs) → { blowing, strength (0 to 1), level (dB), ready }
 * The level is the louder of: the low band (below about 400 Hz), and everything minus 10 dB.
 * The first half second measures the room; the line is 18 dB above it, kept between -36 and -22 dB.
 * Pure arithmetic: no DOM and no audio nodes, so it can be tested with made-up buffers.
 */
export function createBlowDetector(sampleRate = 48000) {
  const alpha = 1 - Math.exp((-2 * Math.PI * LOW_HZ) / Math.max(8000, sampleRate));
  const room = [];
  let startedAt = null;
  let floorDb = null;
  let onDb = ON_MIN_DB;
  let overSince = null;
  let underSince = null;
  let blowing = false;

  function measure(samples) {
    const count = samples.length;
    if (count === 0) return decibel(0);
    let mean = 0;
    for (let i = 0; i < count; i++) mean += samples[i];
    mean /= count;
    const skip = Math.min(128, count >> 2); // the low-pass needs a moment
    let first = 0;
    let second = 0;
    let full = 0;
    let low = 0;
    for (let i = 0; i < count; i++) {
      const x = samples[i] - mean;
      first += alpha * (x - first);
      second += alpha * (first - second);
      if (i < skip) continue;
      full += x * x;
      low += second * second;
    }
    const used = count - skip;
    return Math.max(decibel(Math.sqrt(low / used)), decibel(Math.sqrt(full / used)) - FULL_PENALTY_DB);
  }

  function push(samples, time) {
    const level = measure(samples);
    if (startedAt === null) startedAt = time;
    if (floorDb === null) {
      const age = time - startedAt;
      if (age >= SETTLE_MS) room.push(level);
      if (age < CALIBRATE_MS || room.length < 3) return { blowing: false, strength: 0, level, ready: false };
      room.sort((a, b) => a - b);
      floorDb = clamp(room[room.length >> 1], FLOOR_MIN_DB, FLOOR_MAX_DB);
      onDb = clamp(floorDb + OVER_FLOOR_DB, ON_MIN_DB, ON_MAX_DB);
    }
    const offDb = onDb - OFF_GAP_DB;
    if (!blowing) {
      if (level >= onDb) {
        overSince ??= time;
        if (time - overSince >= ATTACK_MS) {
          blowing = true;
          underSince = null;
        }
      } else {
        overSince = null;
        if (level < offDb) {
          // the room may get a little louder or quieter: follow it slowly
          floorDb = clamp(floorDb + (level - floorDb) * 0.01, FLOOR_MIN_DB, FLOOR_MAX_DB);
          onDb = clamp(floorDb + OVER_FLOOR_DB, ON_MIN_DB, ON_MAX_DB);
        }
      }
    } else if (level < offDb) {
      underSince ??= time;
      if (time - underSince >= RELEASE_MS) {
        blowing = false;
        overSince = null;
      }
    } else {
      underSince = null;
    }
    return { blowing, strength: blowing ? clamp(0.35 + (level - onDb) / 24, 0.35, 1) : 0, level, ready: true };
  }

  return { push, threshold: () => onDb };
}

// ───────────── the music box ─────────────

const NOTES = { G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, F6: 1396.91, G6: 1567.98 };
const BEAT_S = 0.58;
const TUNE_GAIN = 0.2;
// "Happy Birthday to You" (public domain): note and length in beats
const TUNE = [
  ['G5', 0.75], ['G5', 0.25], ['A5', 1], ['G5', 1], ['C6', 1], ['B5', 2],
  ['G5', 0.75], ['G5', 0.25], ['A5', 1], ['G5', 1], ['D6', 1], ['C6', 2],
  ['G5', 0.75], ['G5', 0.25], ['G6', 1], ['E6', 1], ['C6', 1], ['B5', 1], ['A5', 2],
  ['F6', 0.75], ['F6', 0.25], ['E6', 1], ['C6', 1], ['D6', 1], ['C6', 3],
];
// one tine of a music box: the note, its octave and a short bright "tink" — [pitch ratio, loudness, ring in seconds]
const TINE = [
  [1, 1, 1.5],
  [2, 0.26, 0.7],
  [5.4, 0.06, 0.2],
];

const bag = scope(); // listeners and timers of one visit
const steps = scope(); // the timed parts of the ritual
const ears = scope(); // the listening loop and its timers
const tunes = scope(); // timers of the music box

let els = null;
let ctx = null;
let state = null;
let micSerial = 0; // a late answer of the microphone must not reach a later visit
const sound = { context: null, out: null, tune: null };

const freshState = () => ({
  stage: 'wish', // wish → listen → dark → party
  mic: null,
  pressure: 0, // how long she has been blowing at the next candle (ms)
  wind: 0, // 0 to 1: how far the flames lean right now
  bent: false,
  heard: false, // a breath was heard at least once
  fallback: false, // the "no mic" line and its button are shown
  skipped: false, // she let the button blow for her
  partyAt: -Infinity, // when the celebration began
});

// ───────────── drawing ─────────────

const n = (value) => String(Math.round(value * 10) / 10);

/** A gradient whose colours come from CSS classes (tokens only). stops: [[offset, class], …] */
function gradient(type, id, attrs, stops) {
  return svg(type, { id, ...attrs }, ...stops.map(([offset, name]) => svg('stop', { offset: String(offset), class: `cake-art__stop cake-art__stop--${name}` })));
}

/** Points on the front half of an ellipse, from its left end to its right end. */
function frontArc(cx, cy, rx, ry, count) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.PI - (Math.PI * i) / (count - 1);
    points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  return points;
}

const dots = (points, r, name) => points.map(([x, y]) => svg('circle', { cx: n(x), cy: n(y), r: String(r), class: name }));

const stickOf = (index) => (index === MIDDLE ? GOLD_STICK : STICK);
/** Where the flame of a candle stands: the tip of its wick, in the drawing. */
const tipOf = (index) => ({ x: CANDLE_X[index], y: CANDLE_BASE[index] - stickOf(index).height - WICK });

function drawStick(index) {
  const gold = index === MIDDLE;
  const { width, height } = stickOf(index);
  const x = CANDLE_X[index];
  const base = CANDLE_BASE[index];
  const box = { x: n(x - width / 2), y: n(base - height), width: String(width), height: String(height), rx: n(width / 2.6) };
  return svg(
    'g',
    {},
    svg('ellipse', { cx: String(x), cy: n(base), rx: n(width * 0.85), ry: '1.9', class: 'cake-art__holder' }),
    svg('rect', { ...box, fill: gold ? 'url(#cake-gold)' : 'url(#cake-stripe)' }),
    svg('rect', { ...box, fill: 'url(#cake-round)' }),
    svg('path', { d: `M${x} ${n(base - height + 0.6)} q1 -2.4 0.3 -${WICK}`, class: 'cake-art__wick' }),
  );
}

/** The cake: a gold stand, a deep rose tier with cream piping, a cream tier with gold swags, seven candles. */
function drawCake() {
  const LOW = 'M38 164 L38 222 A112 13 0 0 0 262 222 L262 164 Z';
  const TOP = 'M70 102 L70 152 A80 10 0 0 0 230 152 L230 102 Z';
  const STEM = 'M134 240 C134 254 126 262 104 268 L196 268 C174 262 166 254 166 240 Z';

  // gold swags around the cream tier: six, evenly spaced around the front of the cylinder
  const anchors = [-90, -60, -30, 0, 30, 60, 90].map((degrees) => {
    const angle = (degrees * Math.PI) / 180;
    return [150 + 80 * Math.sin(angle), 113 + 10 * Math.cos(angle)];
  });
  let swag = `M${n(anchors[0][0])} ${n(anchors[0][1])}`;
  for (let i = 1; i < anchors.length; i++) {
    const [fromX, fromY] = anchors[i - 1];
    const [x, y] = anchors[i];
    const drop = 4 + 9 * Math.min(1, (x - fromX) / 40);
    swag += ` Q${n((fromX + x) / 2)} ${n((fromY + y) / 2 + drop)} ${n(x)} ${n(y)}`;
  }
  const knots = anchors.slice(1, -1);

  return svg(
    'svg',
    { class: 'cake__art', viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, focusable: 'false', ...DECOR },
    svg(
      'defs',
      {},
      gradient('linearGradient', 'cake-rose', { x1: '0', y1: '0', x2: '1', y2: '0' }, [
        [0, 'rose-edge'],
        [0.2, 'rose'],
        [0.37, 'rose-hi'],
        [0.6, 'rose'],
        [1, 'rose-edge'],
      ]),
      gradient('linearGradient', 'cake-cream', { x1: '0', y1: '0', x2: '1', y2: '0' }, [
        [0, 'cream-edge'],
        [0.22, 'cream'],
        [0.4, 'cream-hi'],
        [0.66, 'cream'],
        [1, 'cream-edge'],
      ]),
      gradient('linearGradient', 'cake-depth', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        [0.15, 'clear'],
        [1, 'shade'],
      ]),
      gradient('linearGradient', 'cake-gold', { x1: '0', y1: '0', x2: '1', y2: '0' }, [
        [0, 'gold-edge'],
        [0.34, 'gold-hi'],
        [0.6, 'gold'],
        [1, 'gold-edge'],
      ]),
      gradient('linearGradient', 'cake-plate', { x1: '0', y1: '0', x2: '1', y2: '0' }, [
        [0, 'gold-edge'],
        [0.3, 'plate-hi'],
        [0.62, 'plate'],
        [1, 'gold-edge'],
      ]),
      gradient('linearGradient', 'cake-stripe', { gradientUnits: 'userSpaceOnUse', x1: '0', y1: '0', x2: '4.6', y2: '4.6', spreadMethod: 'repeat' }, [
        [0, 'stick'],
        [0.5, 'stick'],
        [0.5, 'stripe'],
        [1, 'stripe'],
      ]),
      gradient('linearGradient', 'cake-round', { x1: '0', y1: '0', x2: '1', y2: '0' }, [
        [0, 'round-a'],
        [0.36, 'round-0'],
        [1, 'round-b'],
      ]),
      gradient('radialGradient', 'cake-warm', { cx: '0.5', cy: '0.5', r: '0.5' }, [
        [0, 'warm-1'],
        [1, 'warm-0'],
      ]),
    ),
    // the stand
    svg('ellipse', { cx: '150', cy: '268', rx: '50', ry: '7.5', class: 'cake-art__foot' }),
    svg('path', { d: STEM, fill: 'url(#cake-gold)' }),
    svg('ellipse', { cx: '150', cy: '236.5', rx: '128', ry: '13', class: 'cake-art__plate-under' }),
    svg('ellipse', { cx: '150', cy: '232', rx: '128', ry: '13', fill: 'url(#cake-plate)' }),
    svg('path', { d: 'M22 232 A128 13 0 0 0 278 232', class: 'cake-art__plate-rim' }),
    // the rose tier
    svg('path', { d: LOW, fill: 'url(#cake-rose)' }),
    svg('path', { d: LOW, fill: 'url(#cake-depth)' }),
    svg('path', { d: 'M38 207 A112 13 0 0 0 262 207', class: 'cake-art__band' }),
    svg('path', { d: HEART, transform: 'translate(141 189) scale(0.75)', class: 'cake-art__heart' }),
    ...dots(frontArc(150, 222, 112, 13, 29), 2.3, 'cake-art__pearl'),
    svg('ellipse', { cx: '150', cy: '164', rx: '112', ry: '13', class: 'cake-art__face cake-art__face--rose' }),
    ...dots(frontArc(150, 164, 112, 13, 23), 5.2, 'cake-art__pipe cake-art__pipe--cream'),
    // the cream tier
    svg('path', { d: TOP, fill: 'url(#cake-cream)' }),
    svg('path', { d: TOP, fill: 'url(#cake-depth)' }),
    svg('path', { d: swag, class: 'cake-art__swag' }),
    ...dots(knots, 2.4, 'cake-art__knot'),
    ...dots(
      knots.map(([x, y]) => [x, y + 5.8]),
      1.6,
      'cake-art__knot',
    ),
    ...dots(frontArc(150, 152, 80, 10, 23), 2, 'cake-art__pearl'),
    svg('ellipse', { cx: '150', cy: '102', rx: '80', ry: '10', class: 'cake-art__face cake-art__face--cream' }),
    svg('ellipse', { cx: '150', cy: '102', rx: '80', ry: '10', fill: 'url(#cake-warm)', class: 'cake-art__warm' }),
    ...dots(frontArc(150, 102, 80, 10, 19), 4.2, 'cake-art__pipe cake-art__pipe--rose'),
    // six candles, then the shade that falls on everything when they go out, then the gold candle that keeps its light
    ...ORDER.map(drawStick),
    svg(
      'g',
      { class: 'cake-art__shade' },
      svg('ellipse', { cx: '150', cy: '268', rx: '50', ry: '7.5' }),
      svg('path', { d: STEM }),
      svg('ellipse', { cx: '150', cy: '236.5', rx: '128', ry: '13' }),
      svg('ellipse', { cx: '150', cy: '232', rx: '128', ry: '13' }),
      svg('path', { d: LOW }),
      svg('ellipse', { cx: '150', cy: '164', rx: '112', ry: '13' }),
      svg('path', { d: 'M38 164 A112 13 0 0 0 262 164', class: 'cake-art__shade-line cake-art__shade-line--wide' }),
      svg('path', { d: TOP }),
      svg('ellipse', { cx: '150', cy: '102', rx: '80', ry: '10' }),
      svg('path', { d: 'M70 102 A80 10 0 0 0 230 102', class: 'cake-art__shade-line' }),
      svg('path', { d: 'M38 222 A112 13 0 0 0 262 222', class: 'cake-art__shade-line cake-art__shade-line--thin' }),
      svg('path', { d: 'M70 152 A80 10 0 0 0 230 152', class: 'cake-art__shade-line cake-art__shade-line--thin' }),
      ...ORDER.map((index) =>
        svg('rect', { x: n(CANDLE_X[index] - STICK.width / 2), y: n(CANDLE_BASE[index] - STICK.height), width: String(STICK.width), height: String(STICK.height), rx: n(STICK.width / 2.6) }),
      ),
    ),
    drawStick(MIDDLE),
  );
}

/** One candle of the HTML layer: the flame on the wick tip, its small light, the smoke. */
function buildCandle(index, reducedMotion) {
  const eternal = index === MIDDLE;
  const tip = tipOf(index);
  const flame = createFlame({ lit: true, halo: eternal, reducedMotion });
  const bend = h('span', { class: 'cake__bend' }, flame);
  const spot = h('span', { class: 'cake__spot' }, eternal ? null : h('span', { class: 'cake__halo' }), bend);
  const smoke = h('span', { class: 'cake__puff' }, h('i', { class: 'cake__wisp' }), h('i', { class: 'cake__wisp' }), h('i', { class: 'cake__wisp' }), h('i', { class: 'cake__ember' }));
  const el = h('span', { class: `cake__candle${eternal ? ' cake__candle--gold' : ''}` }, spot, smoke);
  el.style.setProperty('--x', `${((tip.x / VIEW_W) * 100).toFixed(2)}%`);
  el.style.setProperty('--y', `${((tip.y / VIEW_H) * 100).toFixed(2)}%`);
  return { index, eternal, el, spot, bend, flame, lit: true };
}

/** "A. B. C." → the first sentence large, the others small below it. */
function twoLevels(text, className) {
  const [first = '', ...rest] = String(text ?? '')
    .split(/(?<=[.!?…])\s+/)
    .filter(Boolean);
  const small = h('span', { class: 'cake__small' });
  rest.forEach((sentence, index) => small.append(index > 0 ? ' ' : '', h('span', { class: 'cake__sentence', text: sentence })));
  return h('p', { class: className }, h('span', { class: 'cake__big', text: first }), rest.length > 0 ? small : null);
}

/** Each sentence stays together on its line when it fits. */
function bySentence(text, className) {
  const line = h('p', { class: className });
  String(text ?? '')
    .split(/(?<=[.!?…])\s+/)
    .filter(Boolean)
    .forEach((sentence, index) => line.append(index > 0 ? ' ' : '', h('span', { class: 'cake__sentence', text: sentence })));
  return line;
}

/** The birthday line: its last word is her name, written in the gold script. */
function doneLine(text) {
  const words = String(text ?? '').trim();
  const cut = words.lastIndexOf(' ');
  const line = h('h2', { class: 'cake__done cake-step' });
  if (cut > 0) line.append(h('span', { class: 'cake__greeting', text: words.slice(0, cut) }), ' ');
  line.append(h('span', { class: 'cake__name name-script', text: words.slice(cut + 1) }));
  return line;
}

// ───────────── small helpers ─────────────

const reflow = (el) => el.getBoundingClientRect();
const show = (el) => el.classList.add('is-on');
const hide = (el) => el.classList.remove('is-on');
const ordinary = () => els.candles.filter((candle) => !candle.eternal);
const burning = () => ordinary().filter((candle) => candle.lit);

function setStage(stage) {
  state.stage = stage;
  els.root.dataset.cake = stage;
}

/** Tells the CSS how many of the six still burn: the glow, the light on the icing and the shade follow. */
function updateLight() {
  els.root.style.setProperty('--cake-lit', (burning().length / ORDER.length).toFixed(3));
}

/** Puts the middle of the glow on the gold flame, whatever the screen size. */
function aimGlow() {
  if (!els) return;
  const box = els.root.getBoundingClientRect();
  const at = els.candles[MIDDLE].spot.getBoundingClientRect();
  if (!box.width || !box.height || !at.width) return;
  els.root.style.setProperty('--cake-x', `${(((at.left + at.width / 2 - box.left) / box.width) * 100).toFixed(2)}%`);
  els.root.style.setProperty('--cake-y', `${(((at.top + at.height * 0.7 - box.top) / box.height) * 100).toFixed(2)}%`);
}

// ───────────── sound: one small audio context for the music box and the microphone ─────────────

function openAudio() {
  if (sound.context) return sound.context;
  try {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return null;
    const context = new Context();
    const out = context.createGain();
    out.gain.value = ctx.audio.isMuted() ? 0 : 1;
    out.connect(context.destination);
    sound.context = context;
    sound.out = out;
    context.resume().catch(() => {});
    return context;
  } catch {
    sound.context = null;
    sound.out = null;
    return null;
  }
}

function closeAudio() {
  const { context, out } = sound;
  sound.context = null;
  sound.out = null;
  sound.tune = null;
  if (!context) return;
  try {
    out.disconnect();
    context.close().catch(() => {});
  } catch {
    // already closed
  }
}

/** One bell-like note of the music box. */
function tine(context, out, pitch, at, beats) {
  for (const [ratio, loudness, ring] of TINE) {
    const length = ratio === 1 ? Math.min(2.4, ring + beats * 0.35) : ring;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = pitch * ratio;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(loudness, at + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);
    oscillator.connect(envelope).connect(out);
    oscillator.start(at);
    oscillator.stop(at + length + 0.05);
  }
}

function playTune(context) {
  try {
    const gain = context.createGain();
    gain.gain.value = TUNE_GAIN;
    gain.connect(sound.out);
    sound.tune = gain;
    let at = context.currentTime + 0.12;
    TUNE.forEach(([name, beats], index) => {
      tine(context, gain, NOTES[name], at, beats);
      at += beats * BEAT_S * (index >= TUNE.length - 4 ? 1.14 : 1); // the last bar slows down a little
    });
    // once more after a rest, for as long as she is still wishing
    tunes.timeout(
      () => {
        if (sound.tune === gain) sound.tune = null;
        try {
          gain.disconnect();
        } catch {
          // already gone
        }
        startTune();
      },
      (at - context.currentTime) * 1000 + TUNE_REST_MS,
    );
  } catch {
    sound.tune = null;
  }
}

/** The music box. Silent if sound was never unlocked; the mute button is obeyed through sound.out. */
function startTune() {
  if (!state || state.stage !== 'wish' || sound.tune || document.hidden || !ctx.audio.isUnlocked()) return;
  const context = openAudio();
  if (!context) return;
  const begin = () => {
    if (state && state.stage === 'wish' && sound.context === context && !sound.tune && !document.hidden) playTune(context);
  };
  if (context.state === 'running') begin();
  else context.resume().then(begin, () => {});
}

function stopTune(fadeMs = 600) {
  tunes.dispose();
  const gain = sound.tune;
  const { context } = sound;
  sound.tune = null;
  if (!gain || !context) return;
  try {
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
    tunes.timeout(() => {
      try {
        gain.disconnect();
      } catch {
        // already gone
      }
    }, fadeMs + 80);
  } catch {
    // the context is closed: nothing sounds any more
  }
}

// ───────────── the microphone ─────────────

function stopStream(stream) {
  try {
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // nothing to release
  }
}

function straighten() {
  if (!els) return;
  for (const candle of els.candles) candle.bend.style.transform = '';
  if (state) state.bent = false;
}

/** Lets the microphone go at once (all tracks stopped) and ends the listening. Safe to call any time. */
function stopMic() {
  micSerial += 1;
  ears.dispose();
  const mic = state?.mic;
  if (state) {
    state.mic = null;
    state.pressure = 0;
    state.wind = 0;
  }
  straighten();
  if (!mic) return;
  for (const track of mic.stream.getTracks()) track.removeEventListener('ended', onMicLost);
  stopStream(mic.stream);
  for (const node of [mic.source, mic.analyser, mic.silent]) {
    try {
      node.disconnect();
    } catch {
      // already gone
    }
  }
}

function onMicLost() {
  stopMic();
  offerTap();
}

/** The "no mic" line and the quiet button that blows for her. Tapping flames worked all along. */
function offerTap() {
  if (!state || state.fallback || state.stage !== 'listen') return;
  state.fallback = true;
  show(els.hint);
  els.next.textContent = els.text.blowForMe ?? els.text.next;
  els.next.classList.add('btn--ghost');
  els.next.hidden = false;
  reflow(els.nextSlot);
  show(els.nextSlot);
}

/** The flames lean with her breath; each one flutters a little differently. */
function bendFlames(time) {
  const { wind } = state;
  if (wind < 0.01 || ctx.reducedMotion) {
    if (state.bent) straighten();
    return;
  }
  state.bent = true;
  for (const candle of els.candles) {
    if (!candle.lit) continue;
    const flutter = Math.sin(time / 31 + candle.index * 1.9) * 7 * wind;
    const lean = (candle.eternal ? 30 : 24) * wind + flutter;
    const tall = 1 - (candle.eternal ? 0.3 : 0.38) * wind;
    candle.bend.style.transform = `rotate(${lean.toFixed(1)}deg) scale(${(1 - 0.1 * wind).toFixed(3)}, ${tall.toFixed(3)})`;
  }
}

/** One frame of listening. */
function hear(time, delta) {
  const mic = state?.mic;
  if (!mic) return;
  mic.analyser.getFloatTimeDomainData(mic.samples);
  const heard = mic.detector.push(mic.samples, time);
  if (heard.blowing) {
    state.heard = true;
    state.wind += (heard.strength - state.wind) * Math.min(1, delta / 90);
    state.pressure += delta * (0.55 + 0.6 * heard.strength); // a strong breath works about 1.5 times as fast as a weak one
    const need = burning().length === ORDER.length ? FIRST_NEED_MS : NEXT_NEED_MS;
    if (state.pressure >= need) {
      state.pressure -= need;
      const next = ORDER.map((index) => els.candles[index]).find((candle) => candle.lit);
      if (next) putOut(next);
    }
  } else {
    // she stopped: the ones that are left recover
    state.wind += (0 - state.wind) * Math.min(1, delta / 240);
    state.pressure = Math.max(0, state.pressure - delta * 1.5);
  }
  if (state?.mic) bendFlames(time);
}

function listenTo(stream) {
  const context = openAudio();
  if (!context) {
    stopStream(stream);
    offerTap();
    return;
  }
  try {
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = FRAME;
    analyser.smoothingTimeConstant = 0;
    const silent = context.createGain(); // keeps the graph running; nothing she says is ever played back
    silent.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silent);
    silent.connect(context.destination);
    state.mic = { stream, source, analyser, silent, samples: new Float32Array(FRAME), detector: createBlowDetector(context.sampleRate) };
  } catch {
    stopStream(stream);
    offerTap();
    return;
  }
  for (const track of stream.getTracks()) track.addEventListener('ended', onMicLost);
  ears.raf(hear);
  ears.timeout(() => {
    if (state && !state.heard) offerTap();
  }, NO_BLOW_AFTER_MS);
}

/** Asks for the microphone. Must be called inside her tap. A "no" of any kind only leads to the taps. */
function askMic() {
  const devices = navigator.mediaDevices;
  if (!devices || typeof devices.getUserMedia !== 'function') {
    offerTap();
    return;
  }
  micSerial += 1;
  const serial = micSerial;
  let request = null;
  try {
    request = devices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
  } catch {
    offerTap();
    return;
  }
  ears.timeout(() => {
    if (state && !state.mic) offerTap();
  }, NO_ANSWER_AFTER_MS);
  const wanted = () => Boolean(state) && serial === micSerial && state.stage === 'listen';
  Promise.resolve(request).then(
    (stream) => {
      if (!wanted()) {
        stopStream(stream);
        return;
      }
      if (!document.hidden) {
        listenTo(stream);
        return;
      }
      // The phone's own permission dialog can make the page count as hidden: her "Allow" is kept,
      // and the listening starts when the page is back.
      let waiting = stream;
      ears.add(() => {
        if (waiting) stopStream(waiting);
        waiting = null;
      });
      ears.on(document, 'visibilitychange', () => {
        if (document.hidden || !waiting) return;
        const kept = waiting;
        waiting = null;
        if (wanted()) listenTo(kept);
        else stopStream(kept);
      });
    },
    () => {
      if (serial === micSerial) offerTap();
    },
  );
}

// ───────────── the candles ─────────────

function puff(candle) {
  candle.el.classList.remove('is-puff');
  reflow(candle.el);
  candle.el.classList.add('is-puff');
}

/** The gold flame ducks, flickers and stands up again. */
function dodge() {
  const candle = els.candles[MIDDLE];
  candle.el.classList.remove('is-dodge');
  reflow(candle.el);
  candle.el.classList.add('is-dodge');
}

function putOut(candle, { instant = false, touch = false, quiet = false } = {}) {
  if (!state || !candle.lit || candle.eternal) return;
  candle.lit = false;
  candle.bend.style.transform = '';
  candle.flame.extinguish({ instant });
  candle.el.classList.add('is-out');
  updateLight();
  if (!instant) {
    puff(candle);
    // A listening microphone would hear the puff of the speaker as more blowing, and the next candle
    // would go out by itself. The last candle may sound: the microphone is let go with it.
    const overheard = Boolean(state.mic) && burning().length > 0;
    if (!quiet && !overheard) ctx.sfx.play('puff');
    if (touch) ctx.haptics.tap();
  }
  if (burning().length === 0) allOut({ instant });
}

/** The lit flame nearest to a point of the screen (the gold one counts as lit, always). */
function nearest(x, y) {
  let best = null;
  let bestGap = TAP_REACH;
  for (const candle of els.candles) {
    if (!candle.lit) continue;
    const box = candle.spot.getBoundingClientRect();
    const gap = Math.hypot(box.left + box.width / 2 - x, box.top + box.height * 0.6 - y);
    if (gap < bestGap) {
      best = candle;
      bestGap = gap;
    }
  }
  return best;
}

function onTouch(event) {
  if (!state) return;
  ctx.audio.unlock(); // inside the tap
  const candle = nearest(event.clientX, event.clientY);
  if (!candle) return;
  if (candle.eternal) {
    dodge();
    ctx.haptics.tap();
    return;
  }
  putOut(candle, { touch: true });
}

// ───────────── the ritual ─────────────

function onReady() {
  if (!state || state.stage !== 'wish') return;
  ctx.audio.unlock(); // inside the tap
  ctx.sfx.play('tap');
  ctx.haptics.tap();
  steps.dispose();
  stopTune(700);
  openAudio(); // inside the tap, so the listening may start as soon as she says yes
  setStage('listen');
  els.ready.hidden = true;
  hide(els.wish);
  show(els.ask);
  askMic();
}

/** The button of the "no mic" line: the six go out one after the other, as if she had blown. */
function skip() {
  state.skipped = true;
  ctx.sfx.play('whoosh');
  ctx.haptics.tap();
  stopMic();
  const rest = ORDER.map((index) => els.candles[index]).filter((candle) => candle.lit);
  rest.forEach((candle, index) => steps.timeout(() => putOut(candle, { quiet: index % 2 === 1 }), index * SKIP_STEP_MS));
}

function showNext() {
  els.next.textContent = els.text.next;
  els.next.classList.remove('btn--ghost');
  if (els.next.hidden) {
    els.next.hidden = false;
    reflow(els.nextSlot);
  }
  show(els.nextSlot);
}

/** The six are out. One flame, one line; then the celebration. */
function allOut({ instant = false } = {}) {
  if (state.stage === 'dark' || state.stage === 'party') return;
  const quick = state.skipped;
  stopMic(); // the microphone is let go the moment the six are out
  steps.dispose();
  stopTune(500);
  setStage('dark');
  els.ready.hidden = true;
  hide(els.wish);
  hide(els.ask);
  hide(els.hint);
  if (instant) return; // complete() shows the rest itself
  if (quick) {
    // "blow for me" has done its work and stays in its place as the way on: a tap on it during the
    // quiet beat brings the celebration at once, never the next chapter
    els.next.textContent = els.text.next;
  } else {
    // the quiet beat belongs to the flame and its line alone
    hide(els.nextSlot);
    els.next.hidden = true;
  }
  dodge();
  steps.timeout(() => show(els.stays), quick ? QUICK_STAYS_AT_MS : STAYS_AT_MS);
  steps.timeout(celebrate, quick ? QUICK_PARTY_AT_MS : PARTY_AT_MS);
}

function celebrate() {
  if (!state || state.stage !== 'dark') return;
  setStage('party');
  state.partyAt = performance.now();
  show(els.stays);
  show(els.done);
  ctx.sfx.play('chime');
  if (touched()) ctx.haptics.success();
  ctx.audio.playMusic('celebration', { fadeMs: 2000 });

  let bursts = 0;
  fireworks.start({
    durationMs: FIREWORKS_MS,
    intensity: 1,
    reducedMotion: ctx.reducedMotion,
    onBurst: () => {
      bursts += 1;
      ctx.sfx.play(bursts % 2 === 1 ? 'boom' : 'crackle');
    },
  });
  const top = els.candles[MIDDLE].spot.getBoundingClientRect();
  ctx.fx.confetti.burst(top.left + top.width / 2, top.top, { preset: 'petals', count: 26, spread: 120 });
  steps.add(ctx.fx.confetti.rain(PETALS_MS, 'petals'));
  steps.timeout(showNext, state.skipped ? 0 : BUTTON_AFTER_MS);
  steps.timeout(closeAudio, 1200); // the music box and the microphone are done
}

function onNext() {
  if (!state) return;
  ctx.audio.unlock(); // inside the tap
  if (state.stage === 'wish' || state.stage === 'listen') {
    skip();
    return;
  }
  if (state.stage === 'dark') {
    // only after "blow for me", where the button stays: the birthday line comes now, the way on with it
    celebrate();
    return;
  }
  if (state.stage !== 'party' || performance.now() - state.partyAt < PARTY_GUARD_MS) return;
  ctx.sfx.play('tap');
  ctx.haptics.tap();
  ctx.flow.next();
}

function onVisibility() {
  if (!els || !state) return;
  const hidden = document.hidden;
  for (const candle of els.candles) {
    if (hidden) candle.flame.pause();
    else candle.flame.resume();
  }
  if (hidden) {
    stopTune(0);
    if (state.stage === 'listen' && state.mic) {
      // nobody listens to a phone that is in her pocket
      // (while the permission question is still open nothing is dropped: its dialog may be what hides the page)
      stopMic();
      offerTap();
    }
  } else if (state.stage === 'wish') {
    tunes.timeout(startTune, 600);
  }
}

/** Back to the start: seven flames, low light, nothing said yet. */
function reset() {
  state = freshState();
  els.root.classList.add('cake-instant');
  setStage('wish');
  for (const candle of els.candles) {
    candle.lit = true;
    candle.el.classList.remove('is-out', 'is-puff', 'is-dodge');
    candle.bend.style.transform = '';
    candle.flame.light({ instant: true });
    candle.flame.resume();
  }
  updateLight();
  for (const el of [els.wish, els.ask, els.hint, els.stays, els.done, els.nextSlot]) hide(el);
  els.ready.hidden = false;
  els.next.hidden = true;
  els.next.textContent = els.text.next;
  els.next.classList.remove('btn--ghost');
  reflow(els.root);
  els.root.classList.remove('cake-instant');
}

// ───────────── the module ─────────────

export default {
  id: 'cake',

  mount(root, context) {
    ctx = context;
    const text = ctx.content.cake ?? {};
    const { col, body, actions } = buildScreen(root);
    col.classList.add('cake');
    root.prepend(h('div', { class: 'cake__veil', attrs: DECOR }), h('div', { class: 'cake__glow', attrs: DECOR }));

    const candles = CANDLE_X.map((_, index) => buildCandle(index, ctx.reducedMotion));
    const [left, right] = ctx.stickers.forChapter('cake');
    const stage = h(
      'div',
      { class: 'cake__stage reveal' },
      h('span', { class: 'cake__pool', attrs: DECOR }),
      h('span', { class: 'cake__ground', attrs: DECOR }),
      drawCake(),
      h('div', { class: 'cake__flames', attrs: DECOR }, ...candles.map((candle) => candle.el)),
      h('div', { class: 'sticker-slot cake__sticker cake__sticker--l', attrs: DECOR }, left ? ctx.stickers.el(left) : null),
      h('div', { class: 'sticker-slot cake__sticker cake__sticker--r', attrs: DECOR }, right ? ctx.stickers.el(right) : null),
    );
    // one touch surface over the candles: a tap puts out the nearest flame, so every flame has a wide target
    const touch = h('div', { class: 'cake__touch' });
    stage.append(touch);

    const wish = twoLevels(text.before, 'cake__wish cake-step');
    const hint = h('p', { class: 'cake__hint cake-step', text: text.noMic });
    const ask = h('div', { class: 'cake__ask cake-step' }, twoLevels(text.instruction, 'cake__instruction'), hint);
    const stays = bySentence(text.stays, 'cake__stays hand cake-step');
    const done = doneLine(text.done);
    const words = h('div', { class: 'cake__words', attrs: { 'aria-live': 'polite' } }, wish, ask, h('div', { class: 'cake__end' }, stays, done));
    body.append(stage, words);

    // The first button invites her to get ready. The second stays hidden (not only see-through) until
    // its moment: as the quiet "blow for me" of the no-mic line, and as the way on at the end.
    const ready = h('button', { type: 'button', class: 'btn', dataset: { qc: 'primary' }, text: text.ready ?? ctx.content.common?.next });
    const next = h('button', { type: 'button', class: 'btn', hidden: true, dataset: { qc: 'primary' }, text: ctx.content.common?.next });
    const nextSlot = h('div', { class: 'cake__slot cake-step' }, next);
    actions.append(h('div', { class: 'cake__cta' }, h('div', { class: 'cake__slot reveal d5' }, ready), nextSlot));

    // the second button says what it does: it blows for her in the no-mic state, it is the way on at the end
    els = { root, candles, touch, wish, ask, hint, stays, done, ready, next, nextSlot, text: { next: ctx.content.common?.next ?? '', blowForMe: text.blowForMe } };
    state = freshState();
    root.dataset.cake = 'wish';
    updateLight();
  },

  enter(context) {
    if (!els) return;
    ctx = context;
    bag.dispose();
    steps.dispose();
    tunes.dispose();
    stopMic();
    reset();
    ctx.audio.stopMusic({ fadeMs: 1500 });

    bag.on(els.ready, 'click', onReady);
    bag.on(els.next, 'click', onNext);
    bag.on(els.touch, 'click', onTouch);
    bag.on(document, 'visibilitychange', onVisibility);
    bag.on(window, 'resize', aimGlow);
    bag.add(
      ctx.audio.onChange(({ muted }) => {
        if (sound.out) sound.out.gain.value = muted ? 0 : 1;
      }),
    );
    bag.timeout(aimGlow, 50);
    bag.timeout(aimGlow, 900); // once more after the screen has settled
    steps.timeout(() => show(els.wish), WISH_AT_MS);
    steps.timeout(startTune, TUNE_AFTER_MS);
  },

  exit() {
    steps.dispose();
    bag.dispose();
    stopMic(); // also drops an answer of the microphone that is still on its way
    stopTune(0);
    tunes.dispose();
    closeAudio();
    fireworks.stop({ fadeMs: FIREWORKS_OUT_MS });
    ctx?.fx.confetti.clear();
    if (els) for (const candle of els.candles) candle.flame.pause();
  },

  complete(context) {
    if (!els || !state) return;
    if (context) ctx = context;
    els.root.classList.add('cake-instant');
    steps.dispose();
    fireworks.stop();
    for (const candle of ordinary()) putOut(candle, { instant: true });
    stopMic();
    stopTune(0);
    if (state.stage !== 'party') setStage('party');
    for (const el of [els.wish, els.ask, els.hint]) hide(el);
    els.ready.hidden = true;
    show(els.stays);
    show(els.done);
    showNext();
    ctx.audio.playMusic('celebration', { fadeMs: 2000 });
  },
};
