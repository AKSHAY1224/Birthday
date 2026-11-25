// The midnight moment (screen "start"). ctx.flow.mode() says how she got here:
//   live     — she was watching when midnight came: flash, chime, fireworks, her name writes itself in gold
//   late     — she opened the link after midnight and has not seen this yet: the late line, a clock that
//              spins back to 12:00, a short 3-2-1, then the same reveal
//   continue — she has seen it before: a short version (her name, one line, the button)
//   replay   — opened again from the menu: the reveal once more
// The main button is always the first tap: it allows sound, starts the celebration music and enters the story.
// Everything this screen starts is stopped in exit().
import { buildScreen, fill, h, roughDuration, scope } from '../core/dom.js';
import { TARGET_MS } from '../config.js';
import { fireworks } from '../fx/fireworks.js';

const SVG = 'http://www.w3.org/2000/svg';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// the reveal, in milliseconds after the flash
const BUTTON_AT = 3400;
const CONFETTI_AT = 2900;
const FIREWORKS_MS = 11000;
const FIREWORKS_OUT_MS = 600; // "Open your gift" tapped mid-show: the sparks fade with the screen

// the late version, in milliseconds after the screen appears
const SPIN_AT = 900;
const SPIN_MS = 2800;
const COUNT_AT = 4000;
const COUNT_STEP = 1000;

const bag = scope();
let els = null;
let revealed = false;

const touched = () => navigator.userActivation?.hasBeenActive !== false;

function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (text != null) el.textContent = text;
  return el;
}

/** Each sentence in its own span, so a line can break between two sentences but not leave one word of a sentence alone. */
function sentences(text) {
  const fragment = document.createDocumentFragment();
  String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .forEach((sentence, index) => {
      if (index > 0) fragment.append(' ');
      fragment.append(h('span', { class: 'mn__sentence', text: sentence }));
    });
  return fragment;
}

function soft(el, frames, options) {
  try {
    return el.animate?.(frames, options) ?? null;
  } catch {
    return null;
  }
}

/** Her name as SVG text in Pinyon Script: a pen layer (stroke, drawn letter by letter) over a gold fill layer. */
function buildName(name) {
  const root = svg('svg', { class: 'mn__name-svg', viewBox: '0 0 360 150', role: 'img', 'aria-label': name });
  const gradient = svg('linearGradient', { id: 'mn-foil', x1: '0', y1: '0', x2: '1', y2: '1' });
  [
    ['0', 'var(--gold-deep)'],
    ['0.28', 'var(--gold)'],
    ['0.5', 'var(--gold-light)'],
    ['0.72', 'var(--gold)'],
    ['1', 'var(--gold-deep)'],
  ].forEach(([offset, colour]) => {
    const stop = svg('stop', { offset });
    stop.style.stopColor = colour;
    gradient.append(stop);
  });
  const defs = svg('defs');
  defs.append(gradient);

  const place = { x: '180', y: '104', 'text-anchor': 'middle', 'aria-hidden': 'true' };
  const filled = svg('text', { ...place, class: 'mn__name-fill', fill: 'url(#mn-foil)' }, name);
  const pen = svg('text', { ...place, class: 'mn__name-pen', fill: 'none' });
  [...name].forEach((letter, index) => {
    const span = svg('tspan', {}, letter);
    span.style.setProperty('--i', String(index));
    pen.append(span);
  });
  root.append(defs, filled, pen);
  return root;
}

function buildClock() {
  const face = h('div', { class: 'mn__clock', attrs: { 'aria-hidden': 'true' } });
  for (let i = 0; i < 12; i++) {
    const tick = h('span', { class: i % 3 === 0 ? 'mn__tick mn__tick--main' : 'mn__tick' });
    tick.style.transform = `rotate(${i * 30}deg)`;
    face.append(tick);
  }
  const hour = h('span', { class: 'mn__hand mn__hand--hour' });
  const minute = h('span', { class: 'mn__hand mn__hand--minute' });
  face.append(hour, minute, h('span', { class: 'mn__pin' }));
  return { face, hour, minute };
}

function setSticker(slot, ctx, key) {
  if (slot.dataset.key === key) return;
  slot.dataset.key = key ?? '';
  slot.replaceChildren();
  const img = key ? ctx.stickers.el(key) : null;
  if (img) slot.append(img);
}

function syncChip(ctx) {
  const wanted = revealed && !ctx.audio.isUnlocked() && !els.root.classList.contains('is-static');
  els.chip.classList.toggle('is-on', wanted);
  els.chip.tabIndex = wanted ? 0 : -1;
}

function showButton() {
  els.button.classList.remove('btn--ghost');
  els.root.classList.add('is-ready');
}

/** The reveal itself: flash, chime, fireworks, the name, the line, the music — and the button last. */
function reveal(ctx) {
  if (revealed) return;
  revealed = true;
  const { root } = els;
  root.classList.remove('is-late', 'is-counting');
  root.classList.add('is-reveal');

  soft(els.flash, [{ opacity: 0 }, { opacity: ctx.reducedMotion ? 0.35 : 0.95, offset: 0.2 }, { opacity: 0 }], {
    duration: 1500,
    easing: 'ease-out',
  });
  ctx.sfx.play('chime');
  if (touched()) ctx.haptics.success();
  ctx.audio.playMusic('celebration', { fadeMs: 2000 });
  syncChip(ctx);

  let booms = 0;
  fireworks.start({
    durationMs: FIREWORKS_MS,
    intensity: 1.1,
    reducedMotion: ctx.reducedMotion,
    onBurst: () => {
      booms += 1;
      if (booms % 2 === 1) ctx.sfx.play('boom');
      else ctx.sfx.play('crackle');
    },
  });
  bag.timeout(() => ctx.fx.sky.shoot(), 1600);
  bag.timeout(() => ctx.fx.confetti.burst(window.innerWidth / 2, window.innerHeight * 0.42, { preset: 'gold', count: 80, spread: 100 }), CONFETTI_AT);
  bag.timeout(() => {
    ctx.sfx.play('sparkle');
    showButton();
  }, BUTTON_AT);
}

/** The state after everything has played, at once: used by the short version and by complete(). */
function settle(ctx, { quiet = false } = {}) {
  revealed = true;
  els.root.classList.remove('is-late', 'is-counting');
  els.root.classList.add('is-reveal', 'is-static');
  showButton();
  if (!quiet) syncChip(ctx);
}

function count(ctx, number) {
  els.count.textContent = String(number);
  if (!ctx.reducedMotion) {
    soft(
      els.count,
      [
        { transform: 'scale(1.35)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 620, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  }
  if (touched()) ctx.haptics.buzz(24);
  ctx.sfx.play('tick');
}

/** Late: the line with the real delay, the clock runs backwards to 12:00, then 3-2-1 and the reveal. */
function playLate(ctx) {
  const lateBy = Math.max(0, ctx.clock.now() - TARGET_MS);
  els.late.replaceChildren(sentences(fill(ctx.content.midnight.late, { time: roughDuration(lateBy, ctx.content.common.units) })));

  // where the hands are right now, in India time (the same on every phone)
  const dayMs = (((ctx.clock.now() + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  const minutes = dayMs / 60000;
  const minuteAngle = (minutes % 60) * 6 + 720; // two extra turns so the rewind is seen
  const hourAngle = ((minutes / 60) % 12) * 30 + Math.min(2, Math.floor(lateBy / (12 * 60 * 60 * 1000))) * 360;
  els.clock.minute.style.transition = 'none';
  els.clock.hour.style.transition = 'none';
  els.clock.minute.style.transform = `rotate(${minuteAngle.toFixed(1)}deg)`;
  els.clock.hour.style.transform = `rotate(${hourAngle.toFixed(1)}deg)`;

  els.root.classList.add('is-late');
  els.button.classList.add('btn--ghost'); // a quiet way past the rewind; it turns gold with the reveal

  bag.timeout(() => {
    const spin = ctx.reducedMotion ? 'none' : `transform ${SPIN_MS}ms cubic-bezier(0.45, 0, 0.15, 1)`;
    els.clock.minute.style.transition = spin;
    els.clock.hour.style.transition = spin;
    els.clock.minute.style.transform = 'rotate(0deg)';
    els.clock.hour.style.transform = 'rotate(0deg)';
    ctx.sfx.play('whoosh');
  }, SPIN_AT);

  bag.timeout(() => els.root.classList.add('is-counting'), COUNT_AT - 300);
  [3, 2, 1].forEach((number, index) => bag.timeout(() => count(ctx, number), COUNT_AT + index * COUNT_STEP));
  bag.timeout(() => reveal(ctx), COUNT_AT + 3 * COUNT_STEP);
}

function start(ctx) {
  const mode = ctx.flow.mode();
  if (mode === 'continue') settle(ctx, { quiet: true });
  else if (mode === 'late') playLate(ctx);
  else reveal(ctx); // live and replay
}

export default {
  id: 'start',

  mount(root, ctx) {
    const text = ctx.content.midnight;
    const { col, body, actions } = buildScreen(root);
    col.classList.add('mn');

    const flash = h('div', { class: 'mn-flash', attrs: { 'aria-hidden': 'true' } });
    const chip = h('button', { type: 'button', class: 'mn-chip', text: text.soundChip, tabIndex: -1 });
    root.prepend(flash);
    root.append(chip);

    // the late version: line, clock, 3-2-1
    const late = h('p', { class: 'lead mn__late' });
    const clock = buildClock();
    const number = h('span', { class: 'mn__count num', attrs: { 'aria-hidden': 'true' } });
    const intro = h('div', { class: 'mn__intro' }, late, h('div', { class: 'mn__dial' }, clock.face, number));

    // the reveal
    const top = h('div', { class: 'sticker-slot mn__top', attrs: { 'aria-hidden': 'true' } });
    const dance = h('div', { class: 'sticker-slot mn__dance', attrs: { 'aria-hidden': 'true' } });
    const show = h(
      'div',
      { class: 'mn__show' },
      top,
      h('p', { class: 'eyebrow mn__greeting', text: text.greeting }),
      h('h1', { class: 'mn__name' }, buildName(text.name)),
      h('hr', { class: 'rule mn__rule', attrs: { 'aria-hidden': 'true' } }),
      h('p', { class: 'lead mn__under' }, sentences(text.under)),
      dance,
    );

    body.append(h('div', { class: 'mn__stack' }, intro, show));

    const button = h('button', { type: 'button', class: 'btn mn__open', dataset: { qc: 'primary' }, text: text.button });
    actions.append(button);

    button.addEventListener('click', () => {
      ctx.audio.unlock(); // must happen inside the tap
      ctx.audio.playMusic('celebration', { fadeMs: 2000 });
      ctx.sfx.play('chime');
      ctx.haptics.tap();
      ctx.flow.next();
    });
    chip.addEventListener('click', () => {
      ctx.audio.unlock();
      ctx.audio.playMusic('celebration', { fadeMs: 2000 });
      ctx.sfx.play('chime');
      ctx.haptics.tap();
      syncChip(ctx);
    });

    els = { root, flash, chip, late, clock, count: number, top, dance, button };
  },

  enter(ctx) {
    const mode = ctx.flow.mode();
    const keys = ctx.stickers.forChapter('start'); // ringing the bell, dancing, hearts and sparkles
    revealed = false;
    // back to the very beginning, without animating backwards
    els.root.classList.add('is-reset');
    els.root.classList.remove('is-reveal', 'is-static', 'is-ready', 'is-late', 'is-counting');
    els.button.classList.remove('btn--ghost');
    void els.root.offsetWidth;
    els.root.classList.remove('is-reset');
    els.count.textContent = '';
    setSticker(els.top, ctx, mode === 'continue' ? (keys[2] ?? keys[0]) : keys[0]);
    setSticker(els.dance, ctx, mode === 'continue' ? null : (keys[1] ?? null));
    syncChip(ctx);

    bag.add(ctx.audio.onChange?.(() => syncChip(ctx)) ?? (() => {}));
    // taps on the sky send up extra rockets
    bag.on(els.root, 'pointerdown', (event) => {
      if (!revealed || mode === 'continue') return;
      if (event.target instanceof Element && event.target.closest('button')) return;
      fireworks.launchAt(event.clientX, event.clientY);
      ctx.sfx.play('whoosh');
    });

    // if midnight came while the phone was asleep, the reveal waits until she looks
    if (document.visibilityState === 'hidden') {
      const stop = bag.on(document, 'visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        stop();
        start(ctx);
      });
    } else {
      start(ctx);
    }
  },

  exit() {
    bag.dispose();
    fireworks.stop({ fadeMs: FIREWORKS_OUT_MS });
  },

  complete(ctx) {
    // finish the show at once; the button is then ready
    if (!els) return;
    bag.dispose();
    fireworks.stop();
    settle(ctx);
  },
};
