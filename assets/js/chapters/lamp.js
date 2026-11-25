// Chapter "lamp" (Light the lamp) — the signature of the site: Vartika means the wick of a lamp.
// A dark, quiet screen with one clay lamp. She presses and holds, a thin gold ring fills, the wick
// catches, the light spreads, and the three lines about her name appear one after another.
// Interface: mount builds the DOM once, enter runs each time it is shown, exit stops everything
// it started, complete lights the lamp at once (safe to call twice).
import { buildScreen, h, rich, scope } from '../core/dom.js';
import { create as createFlame } from '../fx/flame.js';

const HOLD_MS = 1200; // how long she holds
const FALL_MS = 520; // how fast the ring falls back after an early release
const AUTO_MS = 460; // the ring finishing by itself (tap fallback, keyboard)
const FALLBACK_AFTER_MS = 6000; // then a plain tap is enough
const HINT_MS = 2600;
const TICKS = [0.25, 0.5, 0.75]; // soft haptic ticks on the way
const VERSE_AT_MS = [1000, 2500, 4000]; // the three lines, calmly
const STICKER_AT_MS = 5000;
const BUTTON_AT_MS = 5700;

const SVG_NS = 'http://www.w3.org/2000/svg';
const DECOR = { 'aria-hidden': 'true' };

const bag = scope(); // listeners and timers of one visit
const steps = scope(); // the timed reveal after the flame catches

let els = null;
let context = null;
const state = { lit: false, holding: false, auto: false, tapOk: false, progress: 0, tick: 0, stopLoop: null, stopHint: null };

// ───────────── drawing ─────────────

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

/** A gradient whose colours come from CSS classes (tokens only). stops: [[offset, class], …] */
function gradient(type, id, attrs, stops) {
  return svg(type, { id, ...attrs }, ...stops.map(([offset, name]) => svg('stop', { offset: String(offset), class: `diya__stop diya__stop--${name}` })));
}

/** The clay lamp: bowl, rim with a highlight, oil and the wick. Drawn in a 240 x 150 box; the wick tip is at (120, 47). */
function drawDiya() {
  const BODY = 'M34 62 C34 104 74 137 120 137 C166 137 206 104 206 62 Z';
  const dots = [];
  for (let i = 0; i <= 10; i++) {
    // points on the curve M54 99 Q120 127 186 99
    const t = i / 10;
    const x = (1 - t) * (1 - t) * 54 + 2 * (1 - t) * t * 120 + t * t * 186;
    const y = (1 - t) * (1 - t) * 99 + 2 * (1 - t) * t * 127 + t * t * 99;
    dots.push(svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: i % 2 === 0 ? '2.4' : '1.4', class: 'diya__dot' }));
  }

  return svg(
    'svg',
    { class: 'diya', viewBox: '0 0 240 150', focusable: 'false', ...DECOR },
    svg(
      'defs',
      {},
      gradient('linearGradient', 'diya-body', { x1: '0', y1: '0', x2: '1', y2: '0' }, [
        [0, 'deep'],
        [0.16, 'dark'],
        [0.36, 'light'],
        [0.5, 'clay'],
        [0.8, 'dark'],
        [1, 'deep'],
      ]),
      gradient('linearGradient', 'diya-depth', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        [0.2, 'clear'],
        [1, 'shade'],
      ]),
      gradient('linearGradient', 'diya-rim', { x1: '0', y1: '0', x2: '1', y2: '0' }, [
        [0, 'dark'],
        [0.3, 'light'],
        [0.42, 'hi'],
        [0.6, 'light'],
        [1, 'dark'],
      ]),
      gradient('linearGradient', 'diya-oil', { x1: '0', y1: '0', x2: '1', y2: '1' }, [
        [0, 'oil-1'],
        [1, 'oil-2'],
      ]),
      gradient('radialGradient', 'diya-oil-lit', { cx: '0.5', cy: '0.5', r: '0.5' }, [
        [0, 'glow-1'],
        [1, 'glow-0'],
      ]),
      gradient('linearGradient', 'diya-body-lit', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        [0, 'warm-1'],
        [0.7, 'warm-0'],
      ]),
      gradient('linearGradient', 'diya-wick', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        [0, 'wick-tip'],
        [0.4, 'wick'],
        [1, 'wick'],
      ]),
    ),
    svg('ellipse', { cx: '120', cy: '136', rx: '40', ry: '7.5', class: 'diya__foot' }),
    svg('path', { d: BODY, fill: 'url(#diya-body)' }),
    svg('path', { d: BODY, fill: 'url(#diya-depth)' }),
    svg('path', { d: 'M42 87 Q120 115 198 87', class: 'diya__band' }),
    svg('g', {}, ...dots),
    svg('ellipse', { cx: '120', cy: '62', rx: '86', ry: '19', fill: 'url(#diya-rim)' }),
    svg('ellipse', { cx: '120', cy: '63', rx: '76', ry: '14', class: 'diya__inside' }),
    svg('ellipse', { cx: '120', cy: '66.5', rx: '68', ry: '10', fill: 'url(#diya-oil)' }),
    svg('path', { d: 'M74 68 Q96 74 122 73', class: 'diya__glint' }),
    svg('path', { d: 'M44 70.9 A86 19 0 0 0 196 70.9', class: 'diya__rim-light' }),
    svg('path', { d: 'M66 76.4 A86 19 0 0 0 108 80.6', class: 'diya__rim-spark' }),
    svg(
      'g',
      { class: 'diya__lit' },
      svg('path', { d: BODY, fill: 'url(#diya-body-lit)' }),
      svg('ellipse', { cx: '120', cy: '62', rx: '86', ry: '19', class: 'diya__rim-warm' }),
      svg('ellipse', { cx: '120', cy: '66', rx: '50', ry: '8', fill: 'url(#diya-oil-lit)' }),
    ),
    svg(
      'g',
      { class: 'diya__dim' },
      svg('ellipse', { cx: '120', cy: '136', rx: '40', ry: '7.5' }),
      svg('path', { d: BODY }),
      svg('ellipse', { cx: '120', cy: '62', rx: '86', ry: '19' }),
    ),
    svg('path', { d: 'M119.4 72 C118.4 63 121.4 56 120 47.5', class: 'diya__wick', stroke: 'url(#diya-wick)' }),
  );
}

/** The thin ring: a faint track and two half arcs that rotate into view (transform only). */
function drawRing() {
  const first = h('span', { class: 'lamp__arc' });
  const second = h('span', { class: 'lamp__arc' });
  const head = h('span', { class: 'lamp__head' }, h('span', { class: 'lamp__head-dot' }));
  const ring = h(
    'span',
    { class: 'lamp__ring', attrs: DECOR },
    h('span', { class: 'lamp__track' }),
    h('span', { class: 'lamp__half lamp__half--a' }, first),
    h('span', { class: 'lamp__half lamp__half--b' }, second),
    head,
    h('span', { class: 'lamp__flash' }),
  );
  return { ring, first, second, head };
}

function drawSparks() {
  const sparks = [];
  for (let i = 0; i < 7; i++) sparks.push(h('span', { class: `lamp__spark lamp__spark--${i + 1}` }));
  return h('span', { class: 'lamp__sparks', attrs: DECOR }, ...sparks);
}

// ───────────── the ring and the hold ─────────────

function renderRing() {
  const turn = state.progress * 360;
  els.first.style.transform = `rotate(${Math.min(180, turn).toFixed(1)}deg)`;
  els.second.style.transform = `rotate(${Math.max(0, turn - 180).toFixed(1)}deg)`;
  els.head.style.transform = `rotate(${turn.toFixed(1)}deg)`;
  // an empty arc stays invisible, so no hairline shows where the two halves meet
  els.first.style.opacity = turn > 0 ? '1' : '0';
  els.second.style.opacity = turn > 180 ? '1' : '0';
  els.head.style.opacity = turn > 0 && turn < 360 ? '1' : '0';
}

function stopLoop() {
  if (state.stopLoop) state.stopLoop();
  state.stopLoop = null;
}

function startLoop() {
  if (state.stopLoop) return;
  state.stopLoop = bag.raf((time, delta) => {
    if (state.lit) return stopLoop();
    if (state.auto) state.progress += delta / AUTO_MS;
    else if (state.holding) state.progress += delta / HOLD_MS;
    else state.progress -= delta / FALL_MS;
    state.progress = Math.max(0, Math.min(1, state.progress));

    if (state.holding && state.tick < TICKS.length && state.progress >= TICKS[state.tick]) {
      state.tick += 1;
      context.haptics.tap();
    }
    renderRing();
    if (state.progress >= 1) return ignite();
    if (state.progress <= 0 && !state.holding) {
      state.tick = 0;
      stopLoop();
    }
    return undefined;
  });
}

function showHint(text, { stay = false } = {}) {
  if (state.stopHint) state.stopHint();
  state.stopHint = null;
  els.hint.textContent = text;
  els.hint.classList.add('is-on');
  if (!stay) state.stopHint = bag.timeout(() => els.hint.classList.remove('is-on'), HINT_MS);
}

function press(event) {
  if (state.lit || state.auto) return;
  if (event.button != null && event.button > 0) return;
  context.audio.unlock();
  state.holding = true;
  els.hold.classList.add('is-held');
  try {
    els.hold.setPointerCapture(event.pointerId);
  } catch {
    // capture is a nicety
  }
  startLoop();
}

function release() {
  if (!state.holding) return;
  state.holding = false;
  els.hold.classList.remove('is-held');
  if (state.lit) return;
  if (state.tapOk) {
    state.auto = true; // a plain tap is enough now: the ring finishes by itself
    startLoop();
    return;
  }
  showHint(context.content.lamp.hint);
}

/** Keyboard and switch users: Enter or Space lights it (a click that no pointer made). */
function keyClick(event) {
  if (event.detail !== 0 || state.lit) return;
  context.audio.unlock();
  state.auto = true;
  startLoop();
}

function offerTap() {
  if (state.lit) return;
  state.tapOk = true;
  showHint(context.content.lamp.tapFallback, { stay: true });
}

// ───────────── the light ─────────────

/** Puts the middle of the glow on the flame, whatever the screen size. */
function aimGlow() {
  const box = els.root.getBoundingClientRect();
  const at = els.flameSpot.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const x = ((at.left + at.width / 2 - box.left) / box.width) * 100;
  const y = ((at.bottom - at.height * 0.2 - box.top) / box.height) * 100;
  els.root.style.setProperty('--lamp-x', `${x.toFixed(2)}%`);
  els.root.style.setProperty('--lamp-y', `${y.toFixed(2)}%`);
}

function showStep(el) {
  if (el === els.cta && els.button.hidden) {
    els.button.hidden = false;
    void el.offsetWidth; // so the fade starts from zero
  }
  el.classList.add('is-on');
}

function ignite({ instant = false } = {}) {
  if (state.lit) return;
  state.lit = true;
  state.holding = false;
  state.auto = false;
  state.progress = 1;
  stopLoop();
  if (state.stopHint) state.stopHint();
  state.stopHint = null;
  renderRing();
  aimGlow();

  els.hold.classList.remove('is-held');
  els.hold.disabled = true;
  els.hint.classList.remove('is-on');
  els.root.classList.toggle('lamp-instant', instant);
  els.root.dataset.lamp = 'lit';
  els.flame.light({ instant });

  if (instant) {
    revealAll();
    return;
  }
  context.haptics.success();
  context.sfx.play('whoosh');
  context.audio.preload('story'); // the next chapter's music, fetched while she reads the meaning
  steps.timeout(() => context.sfx.play('chime'), 260);
  els.lines.forEach((line, index) => steps.timeout(() => showStep(line), VERSE_AT_MS[index] ?? VERSE_AT_MS.at(-1) + 1500 * index));
  steps.timeout(() => {
    showStep(els.sticker);
    context.fx.sky.shoot();
  }, STICKER_AT_MS);
  steps.timeout(() => showStep(els.cta), BUTTON_AT_MS);
}

function revealAll() {
  steps.dispose();
  [...els.lines, els.sticker, els.cta].forEach(showStep);
}

/** Back to the dark, quiet start. */
function reset() {
  steps.dispose();
  stopLoop();
  Object.assign(state, { lit: false, holding: false, auto: false, tapOk: false, progress: 0, tick: 0, stopHint: null });
  els.root.classList.add('lamp-instant');
  els.root.dataset.lamp = 'unlit';
  els.flame.extinguish({ instant: true });
  els.flame.resume();
  els.hold.disabled = false;
  els.hold.classList.remove('is-held');
  els.hint.classList.remove('is-on');
  els.hint.textContent = '';
  [...els.lines, els.sticker, els.cta].forEach((el) => el.classList.remove('is-on'));
  els.button.hidden = true;
  renderRing();
  void els.root.offsetWidth;
  els.root.classList.remove('lamp-instant');
}

// ───────────── the module ─────────────

export default {
  id: 'lamp',

  mount(root, ctx) {
    const text = ctx.content.lamp;
    const { col, body, actions } = buildScreen(root);
    col.classList.add('lamp');

    const veil = h('div', { class: 'lamp__veil', attrs: DECOR });
    const glow = h('div', { class: 'lamp__glow', attrs: DECOR });
    const near = h('div', { class: 'lamp__near', attrs: DECOR }, h('div', { class: 'lamp__glow-near' }), h('div', { class: 'lamp__glow-breath' }));
    root.prepend(veil, glow, near);

    const flame = createFlame({ reducedMotion: ctx.reducedMotion });
    const flameSpot = h('span', { class: 'lamp__flame', attrs: DECOR }, flame);
    const { ring, first, second, head } = drawRing();
    const hold = h(
      'button',
      { type: 'button', class: 'lamp__hold', attrs: { 'aria-label': text.instruction } },
      ring,
      h('span', { class: 'lamp__pool', attrs: DECOR }),
      h('span', { class: 'lamp__ground', attrs: DECOR }),
      drawDiya(),
      flameSpot,
      drawSparks(),
    );
    const sticker = h('div', { class: 'sticker-slot lamp__sticker lamp-step', attrs: DECOR }, ctx.stickers.el(ctx.stickers.forChapter('lamp')[0]));
    const stage = h('div', { class: 'lamp__stage reveal' }, hold, sticker);

    const hint = h('p', { class: 'lamp__hint', attrs: { 'aria-live': 'polite' } });
    const prompt = h('div', { class: 'lamp__prompt reveal d3' }, h('p', { class: 'lamp__instruction', text: text.instruction }), hint);
    const lines = text.meaning.map((line, index) => h('p', { class: `lamp__line lamp__line--${index + 1} lamp-step` }, rich(line)));
    // her name inside the verse: the script font, in gold
    for (const name of lines[0]?.querySelectorAll('strong') ?? []) {
      name.classList.add('name-script', 'lamp__name');
      // the name stands on a line of its own, so the dash that joined it to the rest of the sentence is not shown
      const rest = name.nextSibling;
      if (rest?.nodeType === Node.TEXT_NODE) rest.textContent = rest.textContent.replace(/^\s*[—–-]\s*/, '');
    }
    const verse = h('div', { class: 'lamp__verse' }, ...lines);

    // hidden (not only see-through) until the lamp burns, so nothing can press it early
    const button = h('button', { type: 'button', class: 'btn', hidden: true, dataset: { qc: 'primary' }, text: text.button });
    const cta = h('div', { class: 'lamp__cta lamp-step' }, button);
    button.addEventListener('click', () => {
      ctx.sfx.play('tap');
      ctx.haptics.tap();
      ctx.flow.next();
    });

    body.append(stage, h('div', { class: 'lamp__words' }, prompt, verse));
    actions.append(cta);

    els = { root, hold, first, second, head, flame, flameSpot, hint, lines, sticker, cta, button };
    context = ctx;
    root.dataset.lamp = 'unlit';
    renderRing();
  },

  enter(ctx) {
    if (!els) return;
    context = ctx;
    bag.dispose();
    reset();
    // the lamp's own music: it is already playing on the first run; after Back, a reload or a replay it comes back
    ctx.audio.playMusic('celebration', { fadeMs: 1500 });

    bag.on(els.hold, 'pointerdown', press);
    bag.on(els.hold, 'pointerup', release);
    bag.on(els.hold, 'pointercancel', release);
    bag.on(els.hold, 'lostpointercapture', release);
    bag.on(els.hold, 'click', keyClick);
    bag.on(els.hold, 'contextmenu', (event) => event.preventDefault());
    bag.on(document, 'visibilitychange', () => {
      if (document.hidden) {
        release();
        els.flame.pause();
        els.root.classList.add('is-paused');
      } else {
        els.flame.resume();
        els.root.classList.remove('is-paused');
      }
    });
    bag.on(window, 'resize', aimGlow);
    bag.timeout(aimGlow, 50);
    bag.timeout(aimGlow, 900); // once more after the screen has settled
    bag.timeout(offerTap, FALLBACK_AFTER_MS);
  },

  exit() {
    state.holding = false;
    stopLoop();
    steps.dispose();
    bag.dispose();
    if (els) {
      els.hold.classList.remove('is-held');
      els.flame.pause();
    }
  },

  complete() {
    if (!els) return;
    if (!state.lit) {
      ignite({ instant: true });
      return;
    }
    els.root.classList.add('lamp-instant'); // already burning: only finish the reveal
    revealAll();
  },
};
