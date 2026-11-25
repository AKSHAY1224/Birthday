// Chapter "finale" (Finale) — the last scene before the menu.
// A starry sky, fireworks that open the scene (and more wherever she taps), a slow fall of rose petals.
// Centre stage: the live counter since she said yes, with rolling numbers. Then, one after another:
// the tease with her real number of peeks (left out when it is 0), the two last lines, the
// "Tell me how it was" button (WhatsApp with a ready message, no phone number: she picks the chat),
// the closing line, the credits line, and the main button that leads to the menu.
// Interface: mount builds the DOM once, enter resets and starts, exit stops everything it started,
// complete shows everything at once (safe to call twice).
import { SINCE_YES_MS } from '../config.js';
import { buildScreen, fill, h, openWhatsApp, pad2, scope, splitDuration } from '../core/dom.js';
import { fireworks } from '../fx/fireworks.js';

const SHOW_MS = 6500; // the opening fireworks
const SKY_BAND = [0.05, 0.15]; // … burst above the counter, never on its figures or on the last lines
const FIREWORKS_OUT_MS = 600; // leaving mid-show: the sparks fade with the screen
const AMBIENT_MS = 90000; // after this the sky is left to the stars
const ROCKET_EVERY_MS = 6500; // one quiet rocket now and then
const PETALS_AT_MS = 1400;
const PETALS_EVERY_MS = 2600; // a short fall of petals, again and again: never a curtain
const PETALS_FOR_MS = 330;
const STEP_GAP_MS = 1500; // between two staged lines
const FIRST_STEP_MS = 2800;
const SMALL_UNITS = ['hours', 'minutes', 'seconds'];
const STAR_COUNT = 10;
const DECOR = { 'aria-hidden': 'true' };

const bag = scope(); // listeners, timers and loops of one visit
const steps = scope(); // the staged lines

let els = null;
let ctx = null;
const state = { firstPaint: true, daysText: '', loudUntil: 0, booms: 0, left: false, label: '' };

// ───────────── the counter ─────────────

/** The unit words and the closing words of "{days} days · … — since you said yes." */
function readTemplate(template) {
  const text = String(template ?? '');
  const labels = {};
  for (const match of text.matchAll(/\{(days|hours|minutes|seconds)\}\s*([^·—{]*)/g)) labels[match[1]] = match[2].trim();
  const dash = text.lastIndexOf('—');
  return { labels, tail: dash >= 0 ? text.slice(dash + 1).trim() : '' };
}

function makeDigit(char = '0') {
  const inner = h('span', { class: 'digit__in', text: char });
  const el = h('span', { class: 'digit', dataset: { prev: char } }, inner);
  return { el, inner, flip: false };
}

function setDigit(digit, char, animate) {
  if (digit.inner.textContent === char) return;
  digit.el.dataset.prev = digit.inner.textContent;
  digit.inner.textContent = char;
  if (!animate) return;
  digit.flip = !digit.flip;
  digit.el.classList.toggle('is-roll-a', digit.flip);
  digit.el.classList.toggle('is-roll-b', !digit.flip);
}

function groupDays(days) {
  try {
    return days.toLocaleString('en-IN');
  } catch {
    return String(days);
  }
}

/** The days: as many figures as needed, with the comma of thousands standing still between them. */
function setDays(days, animate) {
  const text = groupDays(days);
  if (text.length !== state.daysText.length) {
    els.dayDigits = [...text].map((char) => (/\d/.test(char) ? makeDigit(char) : null));
    els.daysNum.replaceChildren(...[...text].map((char, index) => els.dayDigits[index]?.el ?? h('span', { class: 'fin-sep', text: char })));
  } else {
    [...text].forEach((char, index) => {
      if (els.dayDigits[index]) setDigit(els.dayDigits[index], char, animate);
    });
  }
  state.daysText = text;
}

function unitWord(name, value) {
  const words = ctx.content.common?.units?.[name];
  return (value === 1 ? words?.[0] : words?.[1]) ?? els.labels[name] ?? '';
}

/** The counter sentence of content.json with its numbers filled in and each unit word in the right number. */
function spokenCounter(parts) {
  let text = String(els.text.counter ?? '');
  for (const unit of ['days', ...SMALL_UNITS]) {
    const value = unit === 'days' ? groupDays(parts.days) : String(parts[unit]);
    const label = els.labels[unit];
    const hole = `{${unit}}`;
    const at = text.indexOf(hole);
    if (at < 0) continue;
    const after = text.slice(at + hole.length);
    const word = label ? after.indexOf(label) : -1;
    // the unit word that follows the hole is replaced by the one that fits the number
    text =
      word >= 0 && after.slice(0, word).trim() === ''
        ? text.slice(0, at) + value + after.slice(0, word) + unitWord(unit, parts[unit]) + after.slice(word + label.length)
        : text.slice(0, at) + value + after;
  }
  return text;
}

function paint() {
  const now = ctx.clock.now();
  if (!Number.isFinite(now)) return;
  const parts = splitDuration(Math.max(0, now - SINCE_YES_MS));
  const animate = !state.firstPaint && !ctx.reducedMotion && document.visibilityState !== 'hidden';

  setDays(parts.days, animate);
  if (els.daysUnit.textContent !== unitWord('days', parts.days)) els.daysUnit.textContent = unitWord('days', parts.days);
  for (const unit of SMALL_UNITS) {
    const cell = els.cells[unit];
    const text = pad2(parts[unit]);
    setDigit(cell.digits[0], text[0], animate);
    setDigit(cell.digits[1], text[1], animate);
    const word = unitWord(unit, parts[unit]);
    if (cell.unit.textContent !== word) cell.unit.textContent = word;
  }
  // read aloud as one sentence, renewed once a minute — with the same unit words as the cells ("1 minute", not "1 minutes")
  if (state.firstPaint || parts.seconds === 0) {
    const label = spokenCounter(parts);
    if (label !== state.label) {
      state.label = label;
      els.count.setAttribute('aria-label', label);
    }
  }
  state.firstPaint = false;
}

function makeCell(name) {
  const digits = [makeDigit(), makeDigit()];
  const unit = h('span', { class: 'fin-unit' });
  const el = h('div', { class: 'fin-cell', dataset: { unit: name } }, h('span', { class: 'fin-cell__num num' }, digits[0].el, digits[1].el), unit);
  return { el, digits, unit };
}

// ───────────── the sky ─────────────

function onBurst() {
  if (performance.now() > state.loudUntil) return; // the quiet rockets stay quiet
  state.booms += 1;
  ctx.sfx.play(state.booms % 2 === 1 ? 'boom' : 'crackle');
}

function startSky() {
  state.loudUntil = performance.now() + SHOW_MS + 1500;
  fireworks.start({ durationMs: SHOW_MS, intensity: 1.1, reducedMotion: ctx.reducedMotion, onBurst, band: SKY_BAND });
  bag.timeout(() => ctx.fx.sky.shoot(), 2200);
  if (ctx.reducedMotion) return;

  const until = performance.now() + AMBIENT_MS;
  const quiet = () => performance.now() > until || document.visibilityState === 'hidden';

  // rose petals, a few at a time
  bag.timeout(() => {
    const fall = () => {
      if (quiet()) return;
      bag.add(ctx.fx.confetti.rain(PETALS_FOR_MS, 'petals'));
    };
    fall();
    bag.interval(fall, PETALS_EVERY_MS);
  }, PETALS_AT_MS);

  // one rocket now and then, without a sound
  bag.timeout(() => {
    bag.interval(() => {
      if (quiet()) return;
      fireworks.launchAt(window.innerWidth * (0.16 + Math.random() * 0.68), window.innerHeight * (SKY_BAND[0] + Math.random() * (SKY_BAND[1] - SKY_BAND[0])));
    }, ROCKET_EVERY_MS);
  }, SHOW_MS);
}

/** A tap on the sky sends up one more rocket to that spot. */
function launch(event) {
  if (event.button != null && event.button > 0) return;
  if (event.target instanceof Element && event.target.closest('button, a')) return;
  ctx.audio.unlock();
  state.loudUntil = Math.max(state.loudUntil, performance.now() + 1500);
  fireworks.launchAt(event.clientX, event.clientY);
  ctx.sfx.play('whoosh');
  if (ctx.reducedMotion) ctx.fx.sky.shoot();
}

// ───────────── the staged lines ─────────────

function showStep(el) {
  if (el === els.cta && els.button.hidden) {
    els.button.hidden = false;
    void el.offsetWidth; // so the fade starts from zero
  }
  el.classList.add('is-on');
}

/** The lines in the order they appear; the tease only when she really peeked. */
function sequence() {
  return [els.tease.hidden ? null : els.tease, ...els.lastLines, els.tell, els.closing, els.credits, els.cta].filter(Boolean);
}

function revealAll() {
  steps.dispose();
  sequence().forEach(showStep);
}

/** "1 times" would be wrong: one peek is one time. */
function teaseLine(template, count) {
  const line = fill(template, { count });
  return count === 1 ? line.replace(/\b1 times\b/, '1 time') : line;
}

function reset() {
  steps.dispose();
  Object.assign(state, { firstPaint: true, loudUntil: 0, booms: 0, left: false });
  els.root.classList.add('fin-instant');
  for (const el of [els.tease, ...els.lastLines, els.tell, els.closing, els.credits, els.cta]) el.classList.remove('is-on');
  els.button.hidden = true;

  const peeks = Math.max(0, Math.floor(Number(ctx.store.peekCount) || 0));
  els.tease.hidden = peeks === 0 || !els.text.tease;
  els.tease.textContent = els.tease.hidden ? '' : teaseLine(els.text.tease, peeks);

  void els.root.offsetWidth;
  els.root.classList.remove('fin-instant');
}

// ───────────── the module ─────────────

export default {
  id: 'finale',

  mount(root, context) {
    ctx = context;
    const text = ctx.content.finale ?? {};
    const { labels, tail } = readTemplate(text.counter);
    const [kissKey, cheekKey, hugKey] = ctx.stickers.forChapter('finale');
    const slot = (key, name) => h('div', { class: `sticker-slot fin-sticker fin-sticker--${name}`, attrs: DECOR }, key ? ctx.stickers.el(key) : null);
    const { col, body, actions } = buildScreen(root);
    col.classList.add('fin');

    const stars = [];
    for (let i = 0; i < STAR_COUNT; i++) stars.push(h('span', { class: 'fin-star' }));
    root.prepend(h('div', { class: 'fin-stars', attrs: DECOR }, stars));

    // the counter, with a kiss on either side of the days
    const daysNum = h('span', { class: 'fin-days__num num' });
    const daysUnit = h('span', { class: 'fin-unit' });
    const cells = {};
    const row = h('div', { class: 'fin-row' });
    for (const unit of SMALL_UNITS) {
      cells[unit] = makeCell(unit);
      row.append(cells[unit].el);
    }
    const count = h(
      'div',
      { class: 'fin-count reveal', attrs: { role: 'timer' } },
      h('div', { class: 'fin-days' }, slot(kissKey, 'kiss'), h('div', { class: 'fin-days__mid' }, daysNum, daysUnit), slot(cheekKey, 'cheek')),
      row,
      tail ? h('p', { class: 'hand fin-since', text: tail }) : null,
    );

    const tease = h('p', { class: 'hand fin-tease fin-step', hidden: true });
    const lastLines = (Array.isArray(text.lastLines) ? text.lastLines : []).map((line, index) =>
      h('p', { class: `fin-last__line fin-last__line--${index + 1} fin-step`, text: line }),
    );
    const last = h('div', { class: 'fin-last' }, h('hr', { class: 'rule fin-rule reveal d3', attrs: DECOR }), lastLines);

    const tellButton = h('button', { type: 'button', class: 'btn btn--rose fin-tell__button', text: text.tellButton });
    const tell = h('div', { class: 'fin-tell fin-step' }, tellButton);
    const closing = h('div', { class: 'fin-close fin-step' }, slot(hugKey, 'hug'), h('p', { class: 'hand fin-close__line', text: text.closing }));
    const credits = h('p', { class: 'fin-credits fin-step', text: text.credits });
    body.append(count, tease, last, tell, closing, credits);

    // hidden (not only see-through) until the last line has come, so nothing can press it early
    const button = h('button', { type: 'button', class: 'btn btn--ghost', hidden: true, dataset: { qc: 'primary' }, text: ctx.content.common?.next });
    const cta = h('div', { class: 'fin-cta fin-step' }, button);
    actions.append(cta);

    tellButton.addEventListener('click', () => {
      ctx.audio.unlock();
      ctx.sfx.play('tap');
      ctx.haptics.tap();
      openWhatsApp(text.tellMessage ?? '');
    });
    button.addEventListener('click', () => {
      if (state.left) return;
      state.left = true;
      ctx.sfx.play('tap');
      ctx.haptics.tap();
      // a tap the flow does not take (too soon after a change) must never leave a dead button behind
      if (ctx.flow.next() !== true) state.left = false;
    });

    els = { root, text, labels, count, daysNum, daysUnit, dayDigits: [], cells, tease, lastLines, tell, closing, credits, cta, button };
  },

  enter(context) {
    if (!els) return;
    ctx = context;
    bag.dispose();
    reset();
    ctx.audio.playMusic('finale', { fadeMs: 2500 });

    paint();
    bag.add(ctx.clock.onTick(paint));
    bag.on(document, 'visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      state.firstPaint = true; // no rolling figures for the time she was away
      paint();
    });

    startSky();
    bag.on(els.root, 'pointerdown', launch);

    sequence().forEach((el, index) => steps.timeout(() => showStep(el), FIRST_STEP_MS + index * STEP_GAP_MS));
    steps.timeout(() => ctx.fx.sky.shoot(), FIRST_STEP_MS + 2 * STEP_GAP_MS);
  },

  exit() {
    steps.dispose();
    bag.dispose();
    fireworks.stop({ fadeMs: FIREWORKS_OUT_MS });
    ctx?.fx.confetti.clear();
  },

  complete() {
    if (!els) return;
    els.root.classList.add('fin-instant');
    revealAll();
  },
};
