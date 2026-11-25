// Chapter "reasons" (Reasons) — a deck of twelve paper cards, one reason each, in a slightly fanned stack.
// She throws the top card away with a swipe (left or right) or taps the arrow; the other arrow brings the
// last card back. A small counter shows where she is, and a sticker sits on the corner of the deck.
// After the twelfth card everything goes quiet: one line alone, then the main button to the letter.
// Interface: mount builds the DOM once, enter resets and starts, exit stops everything it started,
// complete jumps to the quiet end (safe to call twice).
import { buildScreen, h, rich, scope, svg } from '../core/dom.js';

const DEPTH_SHOWN = 3; // cards seen under the top one
const DRAG_START = 6; // px: less than this is a tap
const SWIPE_MIN = 76; // px: dragged farther than this, the card is thrown
const FLICK_MIN = 0.4; // px per ms: a quick flick throws it too …
const FLICK_TRAVEL = 18; // … if it travelled at least this far
const PULL_FULL = 150; // px of drag after which the next card has fully come up
const AWAY_MS = 720; // then a thrown card is taken out of sight
const NUDGE_AFTER_MS = 3800; // the top card moves a little by itself if she only looks
const NAV_OUT_MS = 650; // the end: the arrows leave …
const BUTTON_AT_MS = 2900; // … and the main button comes after the line had its moment
const TILT = [-1.6, 1.2, -0.7, 2, -1.3, 0.8, -2.1, 1.5, -0.5, 1.9, -1.1, 0.6]; // degrees: laid down by hand
// Which of the four stickers sits beside which card. The third one eats from a bowl: it belongs to the rice reason (6).
const STICKER_FOR = [0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 0, 0];
const HEART = 'M12 20.6C5.6 15.9 2.5 12.4 2.5 8.6 2.5 5.8 4.6 3.8 7.2 3.8c1.9 0 3.5 1 4.8 2.9 1.3-1.9 2.9-2.9 4.8-2.9 2.6 0 4.7 2 4.7 4.8 0 3.8-3.1 7.3-9.5 12z';
const DECOR = { 'aria-hidden': 'true' };

/** A dash between two words stays with the word before it, so no line begins with a dash. The words are not changed. */
const tidy = (text) => String(text ?? '').replace(/ ([–—]) /g, ' $1 ');

const bag = scope(); // listeners and timers of one visit
const steps = scope(); // the timed end
let ui = null;
let ctx = null;
let state = null;

const freshState = () => ({
  index: 0, // how many cards are gone = the number of the top card, from 0
  drag: null,
  ended: false,
  sticker: null,
  away: new Map(), // card → stop function of its "out of sight" timer
  left: false,
});

// ───────────── drawing ─────────────

function icon(d) {
  return svg('svg', { viewBox: '0 0 24 24', focusable: 'false', ...DECOR }, svg('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

function buildCard(text, index) {
  return h(
    'article',
    { class: `paper reasons__card${index % 2 ? ' reasons__card--b' : ''}` },
    h('span', { class: 'reasons__tape', attrs: DECOR }),
    h('p', { class: 'reasons__no' }, h('span', { class: 'num', text: String(index + 1).padStart(2, '0') }), h('span', { class: 'reasons__no-line', attrs: DECOR })),
    h('p', { class: 'reasons__text' }, rich(tidy(text))),
    svg('svg', { class: 'reasons__heart', viewBox: '0 0 24 24', focusable: 'false', ...DECOR }, svg('path', { d: HEART, fill: 'currentColor' })),
  );
}

/** The title is one string: its first sentence is the heading, the rest a handwritten aside. */
function splitTitle(text) {
  const parts = String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return { head: parts[0] ?? '', note: parts.slice(1).join(' ') };
}

// ───────────── the deck ─────────────

function place(card, { x, y, rot, scale, shade }) {
  card.style.setProperty('--tx', `${x.toFixed(1)}px`);
  card.style.setProperty('--ty', `${y.toFixed(1)}px`);
  card.style.setProperty('--rot', `${rot.toFixed(2)}deg`);
  card.style.setProperty('--scale', scale.toFixed(3));
  card.style.setProperty('--shade', shade.toFixed(2));
}

/** Puts every card that is still in the deck in its place. pull (0…1): how far the top card has been dragged away. */
function layout(pull = 0) {
  const total = ui.cards.length;
  const dragging = Boolean(state.drag?.moved);
  ui.cards.forEach((card, i) => {
    const depth = i - state.index;
    card.classList.toggle('is-gone', depth < 0);
    card.classList.toggle('is-top', depth === 0);
    card.classList.toggle('is-deep', depth - pull > DEPTH_SHOWN);
    card.style.zIndex = String(total - i);
    if (depth === 0) card.removeAttribute('aria-hidden');
    else card.setAttribute('aria-hidden', 'true');
    if (depth < 0) return; // a thrown card stays where it flew
    if (depth === 0 && dragging) return; // the finger holds it
    const d = depth === 0 ? 0 : Math.max(0, depth - pull);
    const side = i % 2 === 0 ? -1 : 1;
    place(card, {
      x: side * d * 5,
      y: d * 9,
      rot: TILT[i % TILT.length] + side * d * 1.5,
      scale: 1 - d * 0.035,
      shade: Math.min(1, d / DEPTH_SHOWN),
    });
  });
}

function showSticker(cardIndex) {
  const keys = ui.stickerKeys;
  if (keys.length === 0) return;
  const key = keys[(STICKER_FOR[cardIndex] ?? 0) % keys.length];
  if (key === state.sticker) return;
  state.sticker = key;
  let face = ui.faces.get(key);
  if (!face) {
    face = h('span', { class: 'reasons__face' }, ctx.stickers.el(key));
    ui.faces.set(key, face);
    ui.stickerSlot.append(face);
    void face.offsetWidth; // so the first one also pops in
  }
  for (const other of ui.faces.values()) other.classList.toggle('is-on', other === face);
}

function update() {
  const total = ui.cards.length;
  const shown = Math.min(state.index, total - 1);
  layout();
  ui.now.textContent = String(shown + 1);
  ui.prev.disabled = state.index === 0 || state.ended;
  ui.next.disabled = state.ended;
  ui.prev.setAttribute('aria-label', `${Math.max(1, shown)} / ${total}`);
  showSticker(shown);
}

function stopNudge() {
  ui.deck.classList.add('is-touched');
  for (const card of ui.cards) card.classList.remove('is-nudge');
}

/** Throws the top card to one side (-1 left, 1 right) and shows the next one. */
function throwCard(side, { lift = 0 } = {}) {
  if (state.ended) return;
  const card = ui.cards[state.index];
  if (!card) return;
  stopNudge();
  const reach = ui.stage.clientWidth / 2 + card.offsetWidth * 0.8;
  place(card, { x: side * reach, y: lift * 0.6 - 12, rot: side * 22, scale: 1, shade: 0 });
  card.classList.remove('is-away');
  state.away.get(card)?.();
  state.away.set(
    card,
    bag.timeout(() => {
      state.away.delete(card);
      card.classList.add('is-away');
    }, AWAY_MS),
  );
  state.index += 1;
  ctx.sfx.play('puff');
  ctx.haptics.tap();
  if (state.index >= ui.cards.length) {
    layout();
    finish();
    return;
  }
  update();
}

/** Brings the last thrown card back onto the deck. */
function takeBack() {
  if (state.ended || state.index === 0) return;
  stopNudge();
  const card = ui.cards[state.index - 1];
  state.away.get(card)?.();
  state.away.delete(card);
  card.classList.remove('is-away');
  void card.offsetWidth; // it flies in from where it went
  state.index -= 1;
  ctx.sfx.play('tap');
  ctx.haptics.tap();
  update();
}

// ───────────── the finger ─────────────

function dropDrag() {
  const drag = state.drag;
  state.drag = null;
  ui.deck.classList.remove('is-dragging');
  if (!drag) return;
  try {
    ui.deck.releasePointerCapture(drag.id);
  } catch {
    // it was never held
  }
}

function onDown(event) {
  if (state.ended || state.drag) return;
  if (event.button != null && event.button > 0) return;
  if (!ui.cards[state.index]) return;
  ctx.audio.unlock();
  state.drag = { id: event.pointerId, x0: event.clientX, y0: event.clientY, x: event.clientX, t: event.timeStamp, speed: 0, moved: false };
  try {
    ui.deck.setPointerCapture(event.pointerId);
  } catch {
    // capture is a nicety
  }
}

function onMove(event) {
  const drag = state.drag;
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x0;
  const dy = event.clientY - drag.y0;
  const dt = Math.max(1, event.timeStamp - drag.t);
  drag.speed = drag.speed * 0.6 + ((event.clientX - drag.x) / dt) * 0.4;
  drag.x = event.clientX;
  drag.t = event.timeStamp;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < DRAG_START) return;
    drag.moved = true;
    stopNudge();
    ui.deck.classList.add('is-dragging');
  }
  const card = ui.cards[state.index];
  place(card, { x: dx, y: dy * 0.35, rot: TILT[state.index % TILT.length] + dx * 0.055, scale: 1.02, shade: 0 });
  layout(Math.min(1, Math.abs(dx) / PULL_FULL));
}

function onUp(event) {
  const drag = state.drag;
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x0;
  const dy = event.clientY - drag.y0;
  const stale = event.timeStamp - drag.t > 120; // the finger rested before it lifted: no flick
  const flick = !stale && Math.abs(drag.speed) > FLICK_MIN && Math.abs(dx) > FLICK_TRAVEL && Math.sign(drag.speed) === Math.sign(dx);
  dropDrag();
  if (!drag.moved) {
    nudge(); // a tap: the card shows that it wants to be swiped
    return;
  }
  if (Math.abs(dx) > SWIPE_MIN || flick) throwCard(dx < 0 ? -1 : 1, { lift: dy });
  else update(); // back onto the deck
}

function onCancel(event) {
  const drag = state.drag;
  if (!drag || (event.pointerId != null && drag.id !== event.pointerId)) return;
  dropDrag();
  update();
}

function nudge() {
  if (state.ended || state.drag || ctx.reducedMotion) return;
  const card = ui.cards[state.index];
  if (!card) return;
  card.classList.remove('is-nudge');
  void card.offsetWidth;
  card.classList.add('is-nudge');
}

// ───────────── the quiet end ─────────────

function showButton() {
  if (ui.button.hidden) {
    ui.button.hidden = false;
    void ui.cta.offsetWidth; // so the fade starts from zero
  }
  ui.cta.classList.add('is-on');
}

/** After the twelfth card: the deck leaves, the line stands alone, then the button. */
function finish({ instant = false } = {}) {
  const first = !state.ended;
  state.ended = true;
  dropDrag();
  ui.prev.disabled = true;
  ui.next.disabled = true;
  if (instant) {
    steps.dispose();
    ui.root.classList.add('reasons-instant');
    ui.root.dataset.reasons = 'end';
    ui.nav.hidden = true;
    showButton();
    return;
  }
  if (!first) return;
  ui.root.dataset.reasons = 'end';
  ctx.audio.preload?.('letter');
  steps.timeout(() => {
    ui.nav.hidden = true;
  }, NAV_OUT_MS);
  steps.timeout(showButton, BUTTON_AT_MS);
}

/** Back to the full deck, without anything flying backwards. */
function reset() {
  steps.dispose();
  state = freshState();
  ui.root.classList.add('reasons-instant');
  ui.root.dataset.reasons = 'deck';
  ui.deck.classList.remove('is-dragging', 'is-touched');
  for (const card of ui.cards) card.classList.remove('is-away', 'is-nudge');
  for (const face of ui.faces.values()) face.classList.remove('is-on');
  ui.nav.hidden = false;
  ui.button.hidden = true;
  ui.cta.classList.remove('is-on');
  update();
  void ui.root.offsetWidth;
  ui.root.classList.remove('reasons-instant');
}

// ───────────── the module ─────────────

export default {
  id: 'reasons',

  mount(root, context) {
    ctx = context;
    const text = ctx.content.reasons ?? {};
    const items = Array.isArray(text.items) ? text.items : [];
    const { col, body, actions } = buildScreen(root);
    col.classList.add('reasons');
    root.prepend(h('div', { class: 'reasons__veil', attrs: DECOR }));

    const { head, note } = splitTitle(text.title);
    const title = h('div', { class: 'reasons__head reveal' }, h('h2', { class: 'title reasons__title', text: head }), note ? h('p', { class: 'hand reasons__note', text: note }) : null);

    const cards = items.map(buildCard);
    const deck = h('div', { class: 'reasons__deck' }, ...cards);
    const stickerSlot = h('div', { class: 'sticker-slot reasons__sticker', attrs: DECOR });
    const stage = h('div', { class: 'reasons__stage reveal d2' }, h('div', { class: 'reasons__spot' }, deck, stickerSlot));
    const main = h('div', { class: 'reasons__main' }, title, stage);
    const quiet = h('p', { class: 'reasons__quiet' }, rich(text.afterLast));
    body.append(h('div', { class: 'reasons__layers' }, main, h('div', { class: 'reasons__after' }, quiet)));

    // the arrows and the counter sit where the thumb is; the main button takes their place at the end
    const prev = h('button', { type: 'button', class: 'reasons__step reasons__step--back' }, icon('M14.5 5.5 8 12l6.5 6.5'));
    const next = h('button', { type: 'button', class: 'reasons__step reasons__step--next', attrs: { 'aria-label': ctx.content.common?.next ?? '' } }, icon('M9.5 5.5 16 12l-6.5 6.5'));
    const now = h('span', { class: 'reasons__now', text: '1' });
    const count = h('p', { class: 'reasons__count num', attrs: { 'aria-live': 'polite' } }, now, h('span', { class: 'reasons__of', text: ` / ${items.length}` }));
    const nav = h('div', { class: 'reasons__nav reveal d4' }, prev, count, next);
    // hidden (not only see-through) until the last card has gone, so nothing can press it early
    const button = h('button', { type: 'button', class: 'btn', hidden: true, dataset: { qc: 'primary' }, text: ctx.content.common?.next });
    const cta = h('div', { class: 'reasons__cta' }, button);
    actions.append(h('div', { class: 'reasons__dock' }, nav, cta));

    button.addEventListener('click', () => {
      const here = state;
      if (!here || here.left) return;
      here.left = true;
      ctx.sfx.play('tap');
      ctx.haptics.tap();
      // a tap the flow does not take (too soon after a change) must never leave a dead button behind
      if (ctx.flow.next() !== true) here.left = false;
    });

    ui = { root, stage, deck, cards, stickerSlot, prev, next, now, nav, cta, button, faces: new Map(), stickerKeys: ctx.stickers.forChapter('reasons') };
    state = freshState();
    root.dataset.reasons = 'deck';
    update();
  },

  enter(context) {
    if (!ui) return;
    ctx = context;
    bag.dispose();
    reset();
    ctx.audio.playMusic('story', { fadeMs: 1500 }); // it may already be playing

    bag.on(ui.deck, 'pointerdown', onDown);
    bag.on(ui.deck, 'pointermove', onMove);
    bag.on(ui.deck, 'pointerup', onUp);
    bag.on(ui.deck, 'pointercancel', onCancel);
    bag.on(ui.deck, 'lostpointercapture', onCancel);
    bag.on(ui.deck, 'contextmenu', (event) => event.preventDefault());
    bag.on(ui.deck, 'dragstart', (event) => event.preventDefault());
    bag.on(ui.next, 'click', () => {
      ctx.audio.unlock();
      throwCard(state.index % 2 === 0 ? -1 : 1);
    });
    bag.on(ui.prev, 'click', takeBack);
    bag.on(window, 'keydown', (event) => {
      if (event.target instanceof Element && event.target.closest('button')) return;
      if (event.key === 'ArrowRight') throwCard(-1);
      else if (event.key === 'ArrowLeft') takeBack();
    });
    bag.on(document, 'visibilitychange', () => {
      if (document.hidden) onCancel({});
    });
    bag.timeout(() => {
      if (state.index === 0 && !ui.deck.classList.contains('is-touched')) nudge();
    }, NUDGE_AFTER_MS);
  },

  exit() {
    steps.dispose();
    bag.dispose();
    if (ui && state) {
      dropDrag();
      state.away.clear();
    }
  },

  complete() {
    if (!ui || !state) return;
    finish({ instant: true });
  },
};
