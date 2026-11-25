// Chapter "question" (One question).
// 1. The question with YES and NO. NO can never be pressed: it jumps away from the finger, shows a
//    teasing line, makes YES bigger and swaps the sticker. It has no action at all.
// 2. After YES: the two answer lines and a scratch card (gold foil on a canvas) with the prize.
// Interface: mount builds the DOM once, enter resets and starts, exit stops everything,
// complete answers yes and reveals the prize at once (safe to call twice).
import { SINCE_YES_MS } from '../config.js';
import { buildScreen, h, rich, scope } from '../core/dom.js';

const NEAR = 70; // px: closer than this and NO runs
const KEEP_AWAY = 104; // px: NO lands at least this far from the finger
const MIN_JUMP = 96; // px: a jump must be seen
const COOLDOWN_MS = 380; // one tap fires several events; they count as one escape
const GROW_STEP = 0.075; // YES grows by this much per escape …
const GROW_MAX = 1.45; // … up to this
const LOOP_FROM = 2; // after the last teasing line, start again from the third
const BRUSH = 46; // px: width of the scratch stroke
const CELL = 12; // px: grid used to measure how much is scratched away
const CLEAR_AT = 0.55; // scratched share that reveals the rest
const SKIP_AFTER_MS = 5000; // "reveal it for me" appears this long after the card
const DAY_MS = 24 * 60 * 60 * 1000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const HEART_ICON = 'M12 20.6C5.6 15.9 2.5 12.4 2.5 8.6 2.5 5.8 4.6 3.8 7.2 3.8c1.9 0 3.5 1 4.8 2.9 1.3-1.9 2.9-2.9 4.8-2.9 2.6 0 4.7 2 4.7 4.8 0 3.8-3.1 7.3-9.5 12z';

const bag = scope();
let ui = null;
let ctx = null;
let state = null;

const freshState = () => ({
  stage: 'ask', // ask → won
  escapes: 0,
  lastEscape: -Infinity,
  swallowClickUntil: 0,
  noTarget: null, // where NO is going (screen rectangle); null = still at home
  grow: 1,
  shift: 0,
  pointer: null,
  revealed: false,
  foil: null,
  left: false,
});

// ───────────── small helpers ─────────────

/** Text of content.json with every heart mark drawn as a small icon (the emoji heart is red on Android and would vanish on the red button). */
function withHearts(text) {
  const fragment = document.createDocumentFragment();
  String(text ?? '')
    .split(/❤️?/)
    .forEach((part, index) => {
      if (index > 0) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('class', 'q-heart');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', HEART_ICON);
        path.setAttribute('fill', 'currentColor');
        svg.append(path);
        fragment.append(svg);
      }
      const words = index === 0 ? part.trimEnd() : part.trim();
      if (words) fragment.append(rich(words));
    });
  return fragment;
}

/** Each sentence in its own span that stays together if it fits, so a line never ends on a lonely first word of the next sentence. */
function sentences(text, each = rich) {
  const fragment = document.createDocumentFragment();
  String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .forEach((sentence, index) => {
      if (index > 0) fragment.append(' ');
      fragment.append(h('span', { class: 'q-sentence' }, each(sentence)));
    });
  return fragment;
}

/** The "{days} din …" line with the number set apart. */
function daysLine(template, days) {
  return sentences(template, (sentence) => {
    const fragment = document.createDocumentFragment();
    sentence.split('{days}').forEach((part, index) => {
      if (index > 0) fragment.append(h('strong', { class: 'q-days num', text: days }));
      if (part) fragment.append(rich(part));
    });
    return fragment;
  });
}

function daysSinceYes() {
  const days = Math.max(0, Math.floor((ctx.clock.now() - SINCE_YES_MS) / DAY_MS));
  if (!Number.isFinite(days)) return '';
  try {
    return days.toLocaleString('en-IN');
  } catch {
    return String(days);
  }
}

const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const grown = (r, by) => box(r.left - by, r.top - by, r.width + 2 * by, r.height + 2 * by);
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
/** Distance from a point to a rectangle (0 inside). */
const gap = (r, p) => Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom));
const reflow = (el) => el.getBoundingClientRect();
const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

// ───────────── the stickers above the question ─────────────

function showFace(key) {
  if (!key) return;
  let face = ui.faces.get(key);
  if (!face) {
    face = h('span', { class: 'q-face' }, ctx.stickers.el(key));
    ui.faces.set(key, face);
    ui.faceSlot.append(face);
    reflow(face);
  }
  for (const other of ui.faces.values()) other.classList.toggle('is-on', other === face);
}

// ───────────── NO: where it may go ─────────────

/** The part of the screen NO may use: inside the safe area, below the top bar, inside the phone column. */
function arena() {
  const screen = ui.root.getBoundingClientRect();
  const style = getComputedStyle(ui.root);
  const col = ui.col.getBoundingClientRect();
  const viewW = document.documentElement.clientWidth;
  const viewH = window.innerHeight;
  const left = Math.max(col.left - 8, 12);
  const right = Math.min(col.right + 8, viewW - 12);
  const top = Math.max(screen.top, 0) + (parseFloat(style.paddingTop) || 56) + 4;
  const bottom = Math.min(screen.bottom, viewH) - (parseFloat(style.paddingBottom) || 16);
  return box(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

/** Where YES is (or will be when its growth has finished). */
function yesRect() {
  const home = ui.yesSlot.getBoundingClientRect();
  const width = ui.yes.offsetWidth * state.grow;
  const height = ui.yes.offsetHeight * state.grow;
  return box(home.left + home.width / 2 + state.shift - width / 2, home.top + home.height / 2 - height / 2, width, height);
}

const noHome = () => {
  const r = ui.noSlot.getBoundingClientRect();
  return box(r.left, r.top, r.width, r.height);
};
const noRect = () => state.noTarget ?? noHome();

/** Picks a free spot for NO and sends it there. `point` is the finger (or null). */
function placeNo(point) {
  const field = arena();
  const home = noHome();
  const { width, height } = home;
  const spanX = Math.max(0, field.width - width);
  const spanY = Math.max(0, field.height - height);
  // YES where it will be, and YES where it is seen right now (it may still be growing)
  const yesGoal = yesRect();
  const yesNow = ui.yes.getBoundingClientRect();
  const yesLeft = Math.min(yesGoal.left, yesNow.left);
  const yesTop = Math.min(yesGoal.top, yesNow.top);
  const yes = grown(box(yesLeft, yesTop, Math.max(yesGoal.right, yesNow.right) - yesLeft, Math.max(yesGoal.bottom, yesNow.bottom) - yesTop), 18);
  const words =[ui.faceSlot, ui.leadIn, ui.title, ui.tease].map((el) => grown(el.getBoundingClientRect(), 12));
  const from = noRect();
  const fromCentre = { x: from.left + width / 2, y: from.top + height / 2 };

  let best = null;
  let bestCost = Infinity;
  for (let i = 0; i < 120; i++) {
    const spot = box(field.left + Math.random() * spanX, field.top + Math.random() * spanY, width, height);
    if (overlap(spot, yes) > 0) continue;
    if (point && gap(spot, point) < KEEP_AWAY) continue;
    if (Math.hypot(spot.left + width / 2 - fromCentre.x, spot.top + height / 2 - fromCentre.y) < MIN_JUMP) continue;
    const cost = words.reduce((sum, r) => sum + overlap(spot, r), 0);
    if (cost < bestCost) {
      best = spot;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  if (!best) {
    // A very small screen: take the corner that is free of YES and farthest from the finger.
    const corners = [
      box(field.left, field.top, width, height),
      box(field.left + spanX, field.top, width, height),
      box(field.left, field.top + spanY, width, height),
      box(field.left + spanX, field.top + spanY, width, height),
      box(field.left + spanX / 2, field.top, width, height),
    ].filter((spot) => overlap(spot, yes) === 0);
    const away = point ?? fromCentre;
    corners.sort((a, b) => gap(b, away) - gap(a, away));
    best = corners[0] ?? box(field.left, field.top, width, height);
  }

  state.noTarget = best;
  ui.no.style.setProperty('--q-tx', `${Math.round(best.left - home.left)}px`);
  ui.no.style.setProperty('--q-ty', `${Math.round(best.top - home.top)}px`);
  ui.no.style.setProperty('--q-rot', `${Math.round(Math.random() * 12 - 6)}deg`);
}

/** NO runs. Counted escapes show the next line, grow YES, swap the sticker and buzz. */
function escapeNo(point, { direct = false } = {}) {
  if (!state || state.stage !== 'ask') return;
  const time = performance.now();
  const counted = time - state.lastEscape > COOLDOWN_MS;
  if (direct && !counted) return; // the same touch, seen through another event
  if (counted) {
    // YES first, so that NO is placed around the bigger YES.
    state.lastEscape = time;
    state.escapes += 1;
    const row = ui.choices.getBoundingClientRect();
    const slot = ui.yesSlot.getBoundingClientRect();
    const limit = Math.min(GROW_MAX, Math.max(1, (row.width + 8) / Math.max(1, ui.yes.offsetWidth)));
    state.grow = Math.min(limit, 1 + state.escapes * GROW_STEP);
    state.shift = row.left + row.width / 2 - (slot.left + slot.width / 2); // NO has left: YES takes the middle
    ui.yes.style.setProperty('--q-grow', state.grow.toFixed(3));
    ui.yes.style.setProperty('--q-shift', `${Math.round(state.shift)}px`);
  }
  placeNo(point ?? state.pointer);
  if (!counted) return;

  const lines = ui.lines;
  if (lines.length > 0) {
    const n = state.escapes - 1;
    const loopFrom = Math.min(LOOP_FROM, lines.length - 1);
    const index = n < lines.length ? n : loopFrom + ((n - lines.length) % (lines.length - loopFrom));
    ui.tease.replaceChildren(rich(lines[index]));
    ui.tease.classList.remove('is-pop');
    reflow(ui.tease);
    ui.tease.classList.add('is-pop');
  }
  if (ui.noFaces.length > 0) showFace(ui.noFaces[(state.escapes - 1) % ui.noFaces.length]);
  ui.root.classList.add('has-escaped');
  ctx.haptics.tap();
  ctx.sfx.play('whoosh');
}

// ───────────── YES ─────────────

function showWon({ instant = false } = {}) {
  ui.ask.hidden = true;
  ui.choices.hidden = true;
  ui.won.hidden = false;
  if (!state.foil && !state.revealed) setupFoil();
  if (instant) {
    ui.won.classList.add('is-on');
    return;
  }
  reflow(ui.won);
  ui.won.classList.add('is-on');
  bag.timeout(() => {
    if (state.revealed) return;
    ui.skip.hidden = false;
    reflow(ui.skip);
    ui.skip.classList.add('is-on');
  }, SKIP_AFTER_MS + 1400);
}

function answerYes(point, { instant = false } = {}) {
  if (!state || state.stage !== 'ask') return;
  state.stage = 'won';
  delete ui.yes.dataset.qc;
  ui.wonDays.replaceChildren(daysLine(ui.text.afterYes?.[1], daysSinceYes()));

  if (instant) {
    showWon({ instant: true });
    return;
  }
  const yes = ui.yes.getBoundingClientRect();
  const from = point ?? { x: yes.left + yes.width / 2, y: yes.top + yes.height / 2 };
  ctx.fx.confetti.burst(from.x, from.y, { preset: 'hearts', count: 90, spread: 100 });
  bag.timeout(() => ctx.fx.confetti.burst(from.x, from.y, { preset: 'gold', count: 40, spread: 120 }), 180);
  ctx.haptics.success();
  ctx.sfx.play('chime');
  bag.timeout(() => ctx.sfx.play('sparkle'), 200);
  ui.ask.classList.add('is-leaving');
  ui.choices.classList.add('is-leaving');
  bag.timeout(() => showWon(), ctx.reducedMotion ? 200 : 420);
}

// ───────────── the scratch card ─────────────

/** Paints the gold foil: a metal gradient, a light band, fine brushed lines and small sparkles. */
function paintFoil(g, width, height) {
  const gold = token('--gold', 'goldenrod');
  const light = token('--gold-light', 'wheat');
  const deep = token('--gold-deep', 'darkgoldenrod');
  const white = token('--paper', 'white');

  const metal = g.createLinearGradient(0, 0, width, height);
  metal.addColorStop(0, deep);
  metal.addColorStop(0.26, gold);
  metal.addColorStop(0.5, light);
  metal.addColorStop(0.74, gold);
  metal.addColorStop(1, deep);
  g.fillStyle = metal;
  g.fillRect(0, 0, width, height);

  // brushed metal: thin slanted lines
  g.save();
  g.globalAlpha = 0.07;
  g.strokeStyle = white;
  g.lineWidth = 1;
  for (let x = -height; x < width; x += 5) {
    g.beginPath();
    g.moveTo(x, height);
    g.lineTo(x + height, 0);
    g.stroke();
  }
  g.restore();

  // one soft band of light
  g.save();
  const band = g.createLinearGradient(width * 0.15, 0, width * 0.7, height);
  band.addColorStop(0, 'transparent');
  band.addColorStop(0.5, white);
  band.addColorStop(1, 'transparent');
  g.globalAlpha = 0.28;
  g.fillStyle = band;
  g.fillRect(0, 0, width, height);
  g.restore();

  // sparkles in a loose grid; the same on every visit
  let seed = 20221204;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const star = (x, y, size) => {
    g.beginPath();
    g.moveTo(x, y - size);
    g.quadraticCurveTo(x, y, x + size, y);
    g.quadraticCurveTo(x, y, x, y + size);
    g.quadraticCurveTo(x, y, x - size, y);
    g.quadraticCurveTo(x, y, x, y - size);
    g.fill();
  };
  const step = 34;
  for (let row = 0; row * step < height + step; row++) {
    for (let colIndex = 0; colIndex * step < width + step; colIndex++) {
      const x = colIndex * step + (row % 2 ? step / 2 : 0) + (random() - 0.5) * 10;
      const y = row * step + (random() - 0.5) * 10;
      const bright = (row + colIndex) % 2 === 0;
      g.globalAlpha = bright ? 0.75 : 0.32;
      g.fillStyle = bright ? white : deep;
      star(x, y, bright ? 3 + random() * 3.5 : 2 + random() * 2);
    }
  }
  g.globalAlpha = 1;

  // a fine inner line, like the edge of a printed coupon
  g.strokeStyle = deep;
  g.globalAlpha = 0.45;
  g.lineWidth = 1;
  g.strokeRect(7.5, 7.5, width - 15, height - 15);
  g.globalAlpha = 1;
}

/** Sizes and paints the foil. If the canvas cannot be used the prize is simply shown. */
function setupFoil() {
  try {
    const width = Math.max(1, Math.round(ui.card.clientWidth));
    const height = Math.max(1, Math.round(ui.card.clientHeight));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    ui.foil.width = Math.round(width * ratio);
    ui.foil.height = Math.round(height * ratio);
    const g = ui.foil.getContext('2d');
    if (!g) throw new Error('no canvas');
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintFoil(g, width, height);
    const cols = Math.ceil(width / CELL);
    const rows = Math.ceil(height / CELL);
    state.foil = { g, width, height, ratio, cols, rows, cells: new Uint8Array(cols * rows), cleared: 0, pointerId: null, last: null, rect: null, lastBuzz: 0 };
  } catch {
    state.foil = null;
    revealPrize({ instant: true });
  }
}

/** Rubs the foil away along the line a → b (card pixels) and notes the cleared cells. */
function scratch(a, b) {
  const foil = state.foil;
  const { g } = foil;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = BRUSH;
  g.shadowColor = 'black';
  g.shadowBlur = 7 * foil.ratio; // soft edge
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x + 0.01, b.y + 0.01);
  g.stroke();
  g.restore();

  const radius = BRUSH / 2;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(length / (radius / 2)));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    const c0 = Math.max(0, Math.floor((x - radius) / CELL));
    const c1 = Math.min(foil.cols - 1, Math.floor((x + radius) / CELL));
    const r0 = Math.max(0, Math.floor((y - radius) / CELL));
    const r1 = Math.min(foil.rows - 1, Math.floor((y + radius) / CELL));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const at = r * foil.cols + c;
        if (foil.cells[at]) continue;
        if (Math.hypot((c + 0.5) * CELL - x, (r + 0.5) * CELL - y) <= radius) {
          foil.cells[at] = 1;
          foil.cleared += 1;
        }
      }
    }
  }
}

function foilPoint(event) {
  const { rect, width, height } = state.foil;
  return { x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * width, y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * height };
}

function onFoilDown(event) {
  const foil = state?.foil;
  if (!foil || state.revealed || foil.pointerId !== null) return;
  event.preventDefault();
  foil.pointerId = event.pointerId;
  foil.rect = ui.foil.getBoundingClientRect();
  try {
    ui.foil.setPointerCapture(event.pointerId);
  } catch {
    // capture is a bonus
  }
  ctx.audio.unlock();
  ui.card.classList.add('is-scratching');
  foil.last = foilPoint(event);
  scratch(foil.last, foil.last);
  afterScratch();
}

function onFoilMove(event) {
  const foil = state?.foil;
  if (!foil || state.revealed || foil.pointerId !== event.pointerId) return;
  event.preventDefault();
  let events = [event];
  try {
    const all = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    if (all.length > 0) events = all;
  } catch {
    // one point is enough
  }
  for (const one of events) {
    const point = foilPoint(one);
    scratch(foil.last, point);
    foil.last = point;
  }
  const time = performance.now();
  if (time - foil.lastBuzz > 90) {
    foil.lastBuzz = time;
    ctx.haptics.buzz(6);
  }
  afterScratch();
}

function onFoilUp(event) {
  const foil = state?.foil;
  if (!foil || foil.pointerId !== event.pointerId) return;
  foil.pointerId = null;
  foil.last = null;
}

function afterScratch() {
  const foil = state.foil;
  if (foil.cleared / foil.cells.length >= CLEAR_AT) revealPrize();
}

function revealPrize({ instant = false } = {}) {
  if (!state || state.revealed) return;
  state.revealed = true;
  if (state.foil) state.foil.pointerId = null;
  ui.card.classList.add('is-revealed');
  ui.skip.hidden = true;
  ui.skip.classList.remove('is-on');
  ui.after.hidden = false;
  ui.next.dataset.qc = 'primary';
  if (instant) {
    ui.after.classList.add('is-on');
    ui.foil.hidden = true;
    return;
  }
  reflow(ui.after);
  ui.after.classList.add('is-on');
  const card = ui.card.getBoundingClientRect();
  ctx.fx.confetti.burst(card.left + card.width / 2, card.top + card.height / 2, { preset: 'gold', count: 80, spread: 110 });
  ctx.sfx.play('sparkle');
  bag.timeout(() => ctx.sfx.play('chime'), 160);
  ctx.haptics.success();
  bag.timeout(() => {
    ui.foil.hidden = true;
  }, 900);
}

// ───────────── the module ─────────────

export default {
  id: 'question',

  mount(root, context) {
    ctx = context;
    const text = ctx.content.question ?? {};
    const { stickers } = ctx;
    const { col, body, actions } = buildScreen(root);

    const noKeys = stickers.forGroup('question-no');
    // crying, angry, grumpy, then the others: the moods take turns
    const noFaces = [0, 3, 5, 1, 4, 2].map((i) => noKeys[i]).filter(Boolean);
    const yesKeys = stickers.forGroup('question-yes');
    const prizeKey = stickers.forGroup('scratch-prize')[0];

    // the question
    const faceSlot = h('div', { class: 'sticker-slot q-faces reveal', attrs: { 'aria-hidden': 'true' } });
    const leadIn = h('p', { class: 'eyebrow reveal d1', text: text.leadIn });
    const title = h('h2', { class: 'title q-title reveal d2' }, rich(text.question));
    const tease = h('p', { class: 'hand q-tease', attrs: { 'aria-live': 'polite' } });
    const ask = h('div', { class: 'q-stage q-ask' }, faceSlot, leadIn, title, tease);

    // after YES
    const trio = h(
      'div',
      { class: 'q-trio q-rise', attrs: { 'aria-hidden': 'true' } },
      [yesKeys[0], yesKeys[1] ?? yesKeys[0], yesKeys[2]].filter(Boolean).map((key) => h('div', { class: 'sticker-slot' }, stickers.el(key))),
    );
    const wonTitle = h('h2', { class: 'title q-won__title q-rise q-d1' }, withHearts(text.afterYes?.[0]));
    const wonDays = h('p', { class: 'lead q-won__days q-rise q-d2' });
    const prompt = h('p', { class: 'hand q-prompt q-rise q-d3', text: text.scratch?.prompt });
    const foil = h('canvas', { class: 'q-foil', attrs: { 'aria-hidden': 'true' } });
    const hint = h('p', { class: 'q-hint', text: text.scratch?.hint });
    const card = h(
      'div',
      { class: 'paper q-card q-rise q-d4' },
      h(
        'div',
        { class: 'q-prize' },
        h('div', { class: 'sticker-slot', attrs: { 'aria-hidden': 'true' } }, prizeKey ? stickers.el(prizeKey) : null),
        h('p', { class: 'hand q-prize__text' }, sentences(text.scratch?.prize)),
      ),
      foil,
      hint,
    );
    const won = h('div', { class: 'q-stage q-won', hidden: true }, trio, wonTitle, wonDays, prompt, card);
    body.append(ask, won);

    // the two answers; NO sits in a slot so that its home place can always be measured
    const yes = h('button', { type: 'button', class: 'btn btn--rose q-yes', dataset: { qc: 'primary' } }, withHearts(text.yes));
    const no = h('button', { type: 'button', class: 'btn btn--ghost q-no', text: text.no });
    const yesSlot = h('div', { class: 'q-slot reveal d4' }, yes);
    const noSlot = h('div', { class: 'q-slot reveal d5' }, no);
    const choices = h('div', { class: 'q-choices' }, yesSlot, noSlot);

    // after the scratch card
    const next = h('button', { type: 'button', class: 'btn q-next', text: ctx.content.common?.next });
    const after = h('div', { class: 'q-after q-rise', hidden: true }, next);
    const skip = h('button', { type: 'button', class: 'q-skip q-rise', hidden: true, text: text.scratch?.skip });
    actions.append(choices, after, skip);

    ui = {
      root, col, text, ask, won, faceSlot, leadIn, title, tease, wonDays, card, foil, yes, no, yesSlot, noSlot, choices, next, after, skip,
      faces: new Map(),
      noFaces,
      restFace: yesKeys[0] ?? null,
      lines: Array.isArray(text.noLines) ? text.noLines : [],
    };
    state = freshState();
  },

  enter(context) {
    ctx = context;
    bag.dispose();
    state = freshState();
    // the story music: it is already playing on the first run; after Back, a reload or a replay it comes back
    ctx.audio.playMusic('story', { fadeMs: 1500 });

    // back to the untouched question
    ui.root.classList.remove('has-escaped');
    for (const el of [ui.ask, ui.choices]) {
      el.hidden = false;
      el.classList.remove('is-leaving');
    }
    ui.won.hidden = true;
    ui.won.classList.remove('is-on');
    ui.card.classList.remove('is-revealed', 'is-scratching');
    ui.foil.hidden = false;
    ui.after.hidden = true;
    ui.after.classList.remove('is-on');
    ui.skip.hidden = true;
    ui.skip.classList.remove('is-on');
    delete ui.next.dataset.qc;
    ui.yes.dataset.qc = 'primary';
    for (const name of ['--q-grow', '--q-shift']) ui.yes.style.removeProperty(name);
    for (const name of ['--q-tx', '--q-ty', '--q-rot']) ui.no.style.removeProperty(name);
    ui.tease.classList.remove('is-pop');
    ui.tease.replaceChildren();
    showFace(ui.restFace);
    ctx.stickers.preload(['question']);

    const pointOf = (event) => ({ x: event.clientX, y: event.clientY });
    const onNo = (event) => event.target instanceof Node && ui.no.contains(event.target);

    // A finger (or a mouse) anywhere on the screen: if it is on NO or close to it, NO runs.
    const watch = (event) => {
      if (state.stage !== 'ask') return;
      const point = pointOf(event);
      state.pointer = point;
      if (onNo(event)) {
        if (event.type === 'pointerdown') state.swallowClickUntil = performance.now() + 800;
        escapeNo(point, { direct: true });
      } else if (event.target instanceof Node && ui.yes.contains(event.target)) {
        // she is going for YES: NO keeps still
      } else if (gap(noRect(), point) < NEAR || (performance.now() - state.lastEscape > COOLDOWN_MS && gap(ui.no.getBoundingClientRect(), point) < NEAR / 2)) {
        escapeNo(point);
      }
    };
    bag.on(ui.root, 'pointerdown', watch, true);
    bag.on(ui.root, 'pointermove', watch, true);

    // Everything that could ever reach NO itself. None of these handlers has an action.
    bag.on(ui.no, 'pointerenter', (event) => escapeNo(pointOf(event), { direct: true }));
    bag.on(
      ui.no,
      'touchstart',
      (event) => {
        if (event.cancelable) event.preventDefault(); // no click will follow
        const touch = event.touches[0] ?? event.changedTouches[0];
        state.swallowClickUntil = performance.now() + 800;
        escapeNo(touch ? { x: touch.clientX, y: touch.clientY } : null, { direct: true });
      },
      { passive: false },
    );
    bag.on(ui.no, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < state.swallowClickUntil) return; // the end of a touch that already made it run
      escapeNo(null, { direct: true });
    });
    bag.on(ui.no, 'focus', () => {
      escapeNo(null, { direct: true });
      ui.no.blur();
    });
    bag.on(ui.no, 'keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      escapeNo(null, { direct: true });
    });
    bag.on(ui.no, 'contextmenu', (event) => event.preventDefault());

    // The screen changed size (rotation, address bar): keep NO inside it.
    bag.on(window, 'resize', () => {
      if (state.stage === 'ask' && state.noTarget) placeNo(null);
    });

    bag.on(ui.yes, 'click', (event) => {
      ctx.audio.unlock(); // inside the tap
      const real = event.clientX !== 0 || event.clientY !== 0;
      answerYes(real ? pointOf(event) : null);
    });

    bag.on(ui.foil, 'pointerdown', onFoilDown);
    bag.on(ui.foil, 'pointermove', onFoilMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) bag.on(ui.foil, type, onFoilUp);

    bag.on(ui.skip, 'click', () => {
      ctx.sfx.play('tap');
      revealPrize();
    });
    bag.on(ui.next, 'click', () => {
      const here = state;
      if (!here || here.left) return;
      here.left = true;
      ctx.sfx.play('tap');
      ctx.haptics.tap();
      // a tap the flow does not take (too soon after a change) must never leave a dead button behind
      if (ctx.flow.next() !== true) here.left = false;
    });
  },

  exit() {
    bag.dispose();
    if (state?.foil) state.foil.pointerId = null;
    ctx?.fx.confetti.clear();
  },

  complete() {
    if (!ui || !state) return;
    answerYes(null, { instant: true });
    if (state.stage === 'won' && ui.won.hidden) showWon({ instant: true }); // YES was tapped a moment ago
    ui.won.classList.add('is-on');
    revealPrize({ instant: true });
  },
};
