// Chapter "gifts" (Gifts).
// 1. A wrapped box: rose red, gold ribbon, a bow. One ribbon end hangs down with a gold tag. She pulls
//    the tag: the ribbon stretches like a rubber band and past a threshold the bow comes loose.
//    A plain tap on the box works too after a moment (or on the third tap), so nobody gets stuck.
// 2. The lid lifts off, warm light comes out, a few gold pieces fly, the line appears.
// 3. The box moves up and the coupon wallet rises out of it: twelve paper tickets in a slider.
//    A tap on a ticket opens it large; "Redeem" opens WhatsApp with the ready message (no phone number
//    anywhere: she picks the chat herself) and stamps the coupon. The stamps are remembered. A stamped
//    coupon keeps its button, so the message can be sent again if it never left WhatsApp. The Back
//    gesture closes an open coupon and the chapter stays (ctx.flow.openOverlay).
// Interface: mount builds the DOM once, enter resets and starts, exit stops everything it started,
// complete opens the box and the wallet at once (safe to call twice).
import { buildScreen, fill, h, openWhatsApp, scope, soft, svg } from '../core/dom.js';

const TAP_AFTER_MS = 3500; // from then on a plain tap opens the box
const TAPS_TO_OPEN = 3; // … and so does the third tap, whenever it comes
const LINE_AT_MS = 800; // the line under the open box
const BURST_AT_MS = 420; // the gold pieces
const WALLET_AT_MS = 2500; // the wallet rises
const BUTTON_AT_MS = 3500; // the main button
const SHEET_MS = 620; // the large coupon opening and closing
const RESTAMP_WITHIN_MS = 2500; // WhatsApp opening this soon after the stamp hides it: it lands once more on her return

// The ribbon, in shares of the box size.
const KNOT = { x: 0.5, y: 0.3 }; // where the bow is tied
const TAIL_LEN = 0.36; // length of the hanging end at rest
const TAIL_ANGLE = (33 * Math.PI) / 180; // it hangs to the right of straight down by this much
const STRETCH_MAX = 0.34; // the most the ribbon gives, however far the finger goes
const PULL_AT = 0.42; // finger travel beyond the rest length that unties the bow
const TICKS = [0.34, 0.68]; // soft haptic ticks on the way
const REST_DIR = { x: Math.sin(TAIL_ANGLE), y: Math.cos(TAIL_ANGLE) };

const DECOR = { 'aria-hidden': 'true' };
const HEART = 'M12 20.6C5.6 15.9 2.5 12.4 2.5 8.6 2.5 5.8 4.6 3.8 7.2 3.8c1.9 0 3.5 1 4.8 2.9 1.3-1.9 2.9-2.9 4.8-2.9 2.6 0 4.7 2 4.7 4.8 0 3.8-3.1 7.3-9.5 12z';
const STAR = 'M12 2.6l2.3 6.1 6.5.3-5.1 4.1 1.8 6.3L12 15.8 6.5 19.4l1.8-6.3-5.1-4.1 6.5-.3z';

const bag = scope(); // listeners and timers of one visit
const steps = scope(); // the timed reveal after the bow comes loose
const sheetBag = scope(); // the short timers of the large coupon

let els = null;
let ctx = null;
const state = { stage: 'wrapped', tapOk: false, taps: 0, drag: null, tick: 0, open: -1, release: null, left: false, redeemed: new Set(), stampedAt: -Infinity, restamp: false };

// ───────────── drawing ─────────────

const pad = (n) => String(n).padStart(2, '0');

/** A gradient whose colours come from CSS classes (tokens only). stops: [[offset, class], …] */
function gradient(type, id, attrs, stops) {
  return svg(type, { id, ...attrs }, stops.map(([offset, name]) => svg('stop', { offset: String(offset), class: `gbox__stop gbox__stop--${name}` })));
}

function icon(path, className) {
  return svg('svg', { class: className, viewBox: '0 0 24 24', focusable: 'false', ...DECOR }, svg('path', { d: path, fill: 'currentColor' }));
}

/** The wrapped box in a 240 x 240 square: floor shadow, the inside, the base, and the lid with its bow. */
function drawBox() {
  const dots = [];
  [126, 150, 174, 198].forEach((y, row) => {
    for (const x of row % 2 === 0 ? [56, 82, 158, 184] : [69, 171]) dots.push(svg('circle', { cx: x, cy: y, r: 1.7, class: 'gbox__dot' }));
  });
  const loop = (side, outer, inner) =>
    svg('g', { class: `gbox__loop gbox__loop--${side}` }, svg('path', { d: outer, fill: 'url(#gbox-loop)' }), svg('path', { d: inner, class: 'gbox__loop-in' }));

  return svg(
    'svg',
    { class: 'gbox', viewBox: '0 0 240 240', focusable: 'false', ...DECOR },
    svg(
      'defs',
      {},
      gradient('linearGradient', 'gbox-red', { x1: '0', y1: '0', x2: '1', y2: '0' }, [
        [0, 'red-deep'],
        [0.2, 'red'],
        [0.38, 'red-light'],
        [0.6, 'red'],
        [1, 'red-deep'],
      ]),
      gradient('linearGradient', 'gbox-shade', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        [0.3, 'clear'],
        [1, 'shade'],
      ]),
      gradient('linearGradient', 'gbox-gold', { x1: '0', y1: '0', x2: '1', y2: '0' }, [
        [0, 'gold-deep'],
        [0.3, 'gold'],
        [0.5, 'gold-light'],
        [0.72, 'gold'],
        [1, 'gold-deep'],
      ]),
      gradient('linearGradient', 'gbox-loop', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        [0, 'gold-light'],
        [0.55, 'gold'],
        [1, 'gold-deep'],
      ]),
      gradient('radialGradient', 'gbox-glow', { cx: '0.5', cy: '0.5', r: '0.5' }, [
        [0, 'glow-1'],
        [0.55, 'glow-2'],
        [1, 'glow-0'],
      ]),
    ),
    svg('ellipse', { cx: 120, cy: 222, rx: 94, ry: 9, class: 'gbox__floor' }),
    // the inside, seen once the lid is off
    svg('path', { d: 'M46 92 H194 L202 108 H38 Z', class: 'gbox__inside' }),
    svg('ellipse', { cx: 120, cy: 103, rx: 80, ry: 17, fill: 'url(#gbox-glow)', class: 'gbox__mouth' }),
    // the base
    svg('rect', { x: 38, y: 104, width: 164, height: 116, rx: 7, fill: 'url(#gbox-red)' }),
    svg('g', {}, dots),
    svg('rect', { x: 104, y: 104, width: 32, height: 116, fill: 'url(#gbox-gold)' }),
    svg('rect', { x: 38, y: 104, width: 164, height: 116, rx: 7, fill: 'url(#gbox-shade)' }),
    svg('rect', { x: 38, y: 104, width: 164, height: 15, class: 'gbox__under' }),
    svg('path', { d: 'M42 105.5 H198', class: 'gbox__rim' }),
    // the lid and the bow
    svg(
      'g',
      { class: 'gbox__lid' },
      svg('rect', { x: 28, y: 78, width: 184, height: 36, rx: 7, fill: 'url(#gbox-red)' }),
      svg('rect', { x: 28, y: 78, width: 184, height: 36, rx: 7, class: 'gbox__lid-tint' }),
      svg('rect', { x: 104, y: 78, width: 32, height: 36, fill: 'url(#gbox-gold)' }),
      svg('path', { d: 'M35 81 H205', class: 'gbox__lid-edge' }),
      svg(
        'g',
        { class: 'gbox__bow' },
        svg('path', { d: 'M113 76 L93 116 L103 110 L110 121 L124 80 Z', class: 'gbox__end', fill: 'url(#gbox-gold)' }),
        loop('l', 'M119 72 C104 42 60 34 58 58 C56 80 100 82 119 72 Z', 'M109 68 C99 54 73 47 71 59 C70 70 96 73 109 68 Z'),
        loop('r', 'M121 72 C136 42 180 34 182 58 C184 80 140 82 121 72 Z', 'M131 68 C141 54 167 47 169 59 C170 70 144 73 131 68 Z'),
      ),
    ),
  );
}

/** One coupon of the slider: a stub with its number, the title and the note, and the stamp. */
function drawTicket(coupon, index, total, text) {
  return h(
    'button',
    { type: 'button', class: 'gf-ticket', dataset: { index: String(index) } },
    h(
      'span',
      { class: 'paper gf-ticket__paper' },
      h(
        'span',
        { class: 'gf-ticket__stub', attrs: DECOR },
        icon(STAR, 'gf-ticket__star'),
        h('span', { class: 'gf-ticket__no num', text: pad(index + 1) }),
        h('span', { class: 'gf-ticket__of num', text: pad(total) }),
      ),
      h(
        'span',
        { class: 'gf-ticket__main' },
        h('span', { class: 'gf-ticket__title', text: coupon.title }),
        coupon.note ? h('span', { class: 'gf-ticket__note', text: coupon.note }) : null,
      ),
      h('span', { class: 'gf-stamp', text: text.redeemedStamp }),
    ),
  );
}

// ───────────── saved stamps ─────────────

const keyOf = (coupon) => String(coupon?.title ?? '');

function readRedeemed() {
  const saved = ctx.store.chapterData('gifts').redeemed;
  return new Set(Array.isArray(saved) ? saved.filter((key) => typeof key === 'string') : []);
}

function paintRedeemed() {
  els.tickets.forEach((ticket, index) => ticket.classList.toggle('is-redeemed', state.redeemed.has(keyOf(els.coupons[index]))));
}

// ───────────── where things are ─────────────

/** Sets how far down the big box sits before it is opened, and how small it becomes above the wallet. */
function measure() {
  if (!els) return;
  const size = els.stage.offsetWidth;
  const slot = els.slot.offsetHeight;
  if (!size || !slot) return;
  const free = els.scene.clientHeight - size - els.words.offsetHeight - els.gap;
  const top = Math.max(0, free / 2);
  els.root.style.setProperty('--gf-drop', `${Math.round(top - els.slot.offsetTop)}px`);
  els.root.style.setProperty('--gf-mini', (slot / size).toFixed(4));
}

/** The box as it is on screen now: its size and the point where the bow is tied. */
function geometry() {
  const box = els.stage.getBoundingClientRect();
  const size = box.width || 1;
  return { size, knot: { x: box.left + size * KNOT.x, y: box.top + size * KNOT.y }, rest: size * TAIL_LEN };
}

// ───────────── the ribbon ─────────────

function setRibbon(dir, length, rest, pull) {
  const style = els.stage.style;
  style.setProperty('--gf-rot', `${Math.atan2(-dir.x, dir.y).toFixed(4)}rad`);
  style.setProperty('--gf-len', (length / rest).toFixed(4));
  style.setProperty('--gf-thin', (1 - 0.3 * pull).toFixed(3));
  style.setProperty('--gf-px', `${(dir.x * length - REST_DIR.x * rest).toFixed(1)}px`);
  style.setProperty('--gf-py', `${(dir.y * length - REST_DIR.y * rest).toFixed(1)}px`);
  style.setProperty('--gf-pull', pull.toFixed(3));
}

function restRibbon() {
  for (const name of ['--gf-rot', '--gf-len', '--gf-thin', '--gf-px', '--gf-py', '--gf-pull']) els.stage.style.removeProperty(name);
}

function dragStart(event) {
  if (state.stage !== 'wrapped' || state.drag) return;
  if (event.button != null && event.button > 0) return;
  event.preventDefault();
  ctx.audio.unlock();
  const g = geometry();
  const tag = { x: g.knot.x + REST_DIR.x * g.rest, y: g.knot.y + REST_DIR.y * g.rest };
  state.drag = { id: event.pointerId, g, grab: { x: event.clientX - tag.x, y: event.clientY - tag.y }, moved: 0, dir: REST_DIR };
  state.tick = 0;
  try {
    els.pull.setPointerCapture(event.pointerId);
  } catch {
    // capture is a nicety
  }
  els.stage.classList.remove('is-springing');
  els.stage.classList.add('is-dragging');
}

function dragMove(event) {
  const drag = state.drag;
  if (!drag || drag.id !== event.pointerId || state.stage !== 'wrapped') return;
  event.preventDefault();
  const { g } = drag;
  const vx = event.clientX - drag.grab.x - g.knot.x;
  const vy = event.clientY - drag.grab.y - g.knot.y;
  const distance = Math.hypot(vx, vy);
  const dir = distance > 1 ? { x: vx / distance, y: vy / distance } : REST_DIR;
  const stretch = Math.max(0, distance - g.rest);
  const give = g.size * STRETCH_MAX;
  const length = Math.max(g.rest * 0.55, Math.min(distance, g.rest) + give * (1 - Math.exp(-stretch / give)));
  const pull = Math.min(1, stretch / Math.max(64, g.size * PULL_AT));
  drag.moved = Math.max(drag.moved, Math.abs(distance - g.rest));
  drag.dir = dir;
  setRibbon(dir, length, g.rest, pull);
  if (state.tick < TICKS.length && pull >= TICKS[state.tick]) {
    state.tick += 1;
    ctx.haptics.tap();
    ctx.sfx.play('tick');
  }
  if (pull >= 1) untie({ dir });
}

function dragEnd(event) {
  const drag = state.drag;
  if (!drag || (event && event.pointerId !== drag.id)) return;
  state.drag = null;
  els.stage.classList.remove('is-dragging');
  if (state.stage !== 'wrapped') return;
  els.stage.classList.add('is-springing'); // the ribbon snaps back
  restRibbon();
  if (drag.moved < 6 && event?.type === 'pointerup') tapBox(); // a tap on the tag counts as a tap on the box
}

// ───────────── taps on the box ─────────────

function nudge() {
  if (ctx.reducedMotion) return;
  soft(els.box, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-3deg)' }, { transform: 'rotate(2.4deg)' }, { transform: 'rotate(-1.2deg)' }, { transform: 'rotate(0deg)' }], {
    duration: 620,
    easing: 'ease-out',
  });
  soft(els.pull, [{ translate: '0 0' }, { translate: '7px 11px' }, { translate: '-2px -3px' }, { translate: '0 0' }], { duration: 700, easing: 'ease-out' });
}

function tapBox() {
  if (state.stage !== 'wrapped') return;
  ctx.audio.unlock();
  state.taps += 1;
  if (state.tapOk || state.taps >= TAPS_TO_OPEN) {
    untie();
    return;
  }
  ctx.sfx.play('tap');
  ctx.haptics.tap();
  nudge();
}

function boxClick(event) {
  if (event.detail === 0) {
    // keyboard and switch users: Enter or Space opens it
    ctx.audio.unlock();
    untie();
    return;
  }
  tapBox();
}

// ───────────── opening ─────────────

function showStep(el) {
  if (el === els.cta && els.button.hidden) {
    els.button.hidden = false;
    void el.offsetWidth; // so the fade starts from zero
  }
  el.classList.add('is-on');
}

function showWallet() {
  if (state.stage === 'wallet') return;
  state.stage = 'wallet';
  els.root.dataset.gifts = 'wallet';
  els.wallet.inert = false;
  syncSlider();
  ctx.audio.preload('finale'); // the last track, fetched while she looks through the coupons
}

/** The bow comes loose and the box opens. dir: the way the ribbon was pulled (for the fly-away). */
function untie({ dir = REST_DIR, instant = false } = {}) {
  if (state.stage !== 'wrapped') return;
  state.stage = 'open';
  state.drag = null;
  els.stage.classList.remove('is-dragging', 'is-springing');
  els.box.disabled = true;
  els.root.classList.toggle('gf-instant', instant);
  els.root.dataset.gifts = 'open';

  if (instant) {
    restRibbon();
    revealAll();
    return;
  }
  // the loose end flies off the way it was pulled
  if (!ctx.reducedMotion) {
    const fly = `${Math.round(dir.x * 90)}px ${Math.round(dir.y * 90)}px`;
    soft(els.pull, [{ translate: '0 0' }, { translate: fly }], { duration: 600, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }
  ctx.haptics.success();
  ctx.sfx.play('whoosh');
  steps.timeout(() => ctx.sfx.play('sparkle'), 300);
  steps.timeout(() => {
    ctx.sfx.play('chime');
    const box = els.stage.getBoundingClientRect();
    ctx.fx.confetti.burst(box.left + box.width / 2, box.top + box.height * 0.42, { preset: 'gold', count: 34, spread: 62 });
  }, BURST_AT_MS);
  steps.timeout(() => showStep(els.line), LINE_AT_MS);
  steps.timeout(() => {
    restRibbon();
    showWallet();
    ctx.sfx.play('pop');
  }, WALLET_AT_MS);
  steps.timeout(() => showStep(els.cta), BUTTON_AT_MS);
}

function revealAll() {
  steps.dispose();
  showStep(els.line);
  showWallet();
  showStep(els.cta);
}

/** Back to the wrapped box. */
function reset() {
  steps.dispose();
  closeSheet({ instant: true, viaBack: true });
  Object.assign(state, { stage: 'wrapped', tapOk: false, taps: 0, drag: null, tick: 0, open: -1, release: null, left: false, stampedAt: -Infinity, restamp: false });
  els.root.classList.add('gf-instant');
  els.root.dataset.gifts = 'wrapped';
  els.stage.classList.remove('is-dragging', 'is-springing');
  restRibbon();
  els.box.disabled = false;
  els.wallet.inert = true;
  els.line.classList.remove('is-on');
  els.cta.classList.remove('is-on');
  els.button.hidden = true;
  els.rail.scrollLeft = 0;
  state.redeemed = readRedeemed();
  paintRedeemed();
  syncSlider();
  measure();
  void els.root.offsetWidth;
  els.root.classList.remove('gf-instant');
}

// ───────────── the slider ─────────────

function syncSlider() {
  if (!els || els.tickets.length === 0) return;
  const rail = els.rail.getBoundingClientRect();
  const middle = rail.left + rail.width / 2;
  let current = 0;
  let nearest = Infinity;
  els.tickets.forEach((ticket, index) => {
    const box = ticket.getBoundingClientRect();
    const away = Math.abs(box.left + box.width / 2 - middle);
    if (away < nearest) {
      nearest = away;
      current = index;
    }
  });
  els.tickets.forEach((ticket, index) => ticket.classList.toggle('is-current', index === current));
  els.dots.forEach((dot, index) => dot.classList.toggle('is-current', index === current));
}

// ───────────── the large coupon ─────────────

function openSheet(index) {
  const coupon = els.coupons[index];
  if (!coupon || state.stage !== 'wallet' || state.open === index) return;
  sheetBag.dispose();
  state.open = index;
  const redeemed = state.redeemed.has(keyOf(coupon));
  els.sheetNo.textContent = pad(index + 1);
  els.sheetTitle.textContent = coupon.title;
  els.sheetNote.textContent = coupon.note ?? '';
  els.sheetNote.hidden = !coupon.note;
  els.card.classList.remove('is-stamping');
  els.card.classList.toggle('is-redeemed', redeemed);
  quietRedeem(redeemed);
  els.sheet.hidden = false;

  // the large coupon grows out of the small one
  const from = els.tickets[index].getBoundingClientRect();
  const to = els.card.getBoundingClientRect();
  if (from.width > 0 && to.width > 0 && !ctx.reducedMotion) {
    els.card.style.setProperty('--gf-fx', `${Math.round(from.left + from.width / 2 - (to.left + to.width / 2))}px`);
    els.card.style.setProperty('--gf-fy', `${Math.round(from.top + from.height / 2 - (to.top + to.height / 2))}px`);
    els.card.style.setProperty('--gf-fs', (from.width / to.width).toFixed(3));
  } else {
    for (const name of ['--gf-fx', '--gf-fy', '--gf-fs']) els.card.style.removeProperty(name);
  }
  void els.sheet.offsetWidth;
  els.sheet.classList.add('is-on');
  ctx.sfx.play('whoosh');
  ctx.haptics.tap();
  try {
    els.close.focus({ preventScroll: true });
  } catch {
    // focus is a nicety
  }
  // the Back gesture closes the coupon and the chapter stays
  state.release = ctx.flow.openOverlay(() => closeSheet({ viaBack: true }));
}

/** viaBack: the Back gesture (or leaving the chapter) closed it, so there is no history step to take back. */
function closeSheet({ instant = false, viaBack = false } = {}) {
  if (!els || state.open < 0) return;
  const index = state.open;
  const { release } = state;
  state.open = -1;
  state.release = null;
  state.restamp = false;
  if (!viaBack) release?.();
  sheetBag.dispose();
  els.sheet.classList.remove('is-on');
  if (instant) {
    els.sheet.hidden = true;
    return;
  }
  sheetBag.timeout(() => {
    els.sheet.hidden = true;
  }, SHEET_MS);
  try {
    els.tickets[index]?.focus({ preventScroll: true });
  } catch {
    // focus is a nicety
  }
}

/** A stamped coupon keeps its button, outlined instead of red: it only sends the message once more. */
function quietRedeem(on) {
  els.redeem.classList.toggle('btn--rose', !on);
  els.redeem.classList.toggle('btn--ghost', on);
}

function stamp() {
  els.card.classList.remove('is-stamping');
  void els.card.offsetWidth;
  els.card.classList.add('is-redeemed', 'is-stamping');
  ctx.sfx.play('pop');
  ctx.haptics.success();
}

function redeem() {
  const coupon = els.coupons[state.open];
  if (!coupon) return;
  const key = keyOf(coupon);
  if (state.redeemed.has(key)) {
    // already stamped (the message may never have left WhatsApp): only the message once more
    ctx.sfx.play('tap');
    ctx.haptics.tap();
  } else {
    // what another tab has stamped in the meantime is kept
    state.redeemed = new Set([...readRedeemed(), ...state.redeemed, key]);
    ctx.store.setChapterData('gifts', { redeemed: [...state.redeemed] });
    paintRedeemed();
    quietRedeem(true);
    stamp();
    state.stampedAt = performance.now(); // WhatsApp covers the page at once: the stamp lands again when she is back
  }
  openWhatsApp(fill(els.text.redeemMessage, { 'coupon name': coupon.title }));
}

// ───────────── the module ─────────────

export default {
  id: 'gifts',

  mount(root, context) {
    ctx = context;
    const text = ctx.content.gifts ?? {};
    const coupons = (Array.isArray(text.coupons) ? text.coupons : []).filter((coupon) => coupon && coupon.title);
    const { col, body, actions } = buildScreen(root);
    col.classList.add('gf');

    // the box
    const box = h('button', { type: 'button', class: 'gf-box', attrs: { 'aria-label': text.onBox ?? '' } }, drawBox());
    const pull = h('span', { class: 'gf-pull', attrs: DECOR }, icon(HEART, 'gf-pull__heart'));
    const stage = h(
      'div',
      { class: 'gf-stage' },
      h('span', { class: 'gf-aura', attrs: DECOR }),
      h('span', { class: 'gf-shine', attrs: DECOR }),
      h('span', { class: 'gf-rays', attrs: DECOR }, h('span', { class: 'gf-rays__spin' })),
      box,
      h('span', { class: 'gf-tail', attrs: DECOR }),
      h('span', { class: 'gf-knot', attrs: DECOR }),
      h('span', { class: 'gf-arrow', attrs: DECOR }, h('span', { class: 'gf-arrow__mark' }), h('span', { class: 'gf-arrow__mark' })),
      pull,
    );
    const sticker = h('div', { class: 'sticker-slot gf-sticker', attrs: DECOR }, ctx.stickers.el(ctx.stickers.forChapter('gifts')[0]));
    const slot = h('div', { class: 'gf-slot reveal' }, stage, sticker);

    // the words under the box
    const prompt = h('p', { class: 'gf-prompt reveal d2', text: text.onBox });
    const line = h('p', { class: 'gf-line gf-step', text: text.opened });
    const words = h('div', { class: 'gf-words' }, prompt, line);

    // the wallet
    const tickets = coupons.map((coupon, index) => drawTicket(coupon, index, coupons.length, text));
    const rail = h('ul', { class: 'gf-rail' }, tickets.map((ticket) => h('li', { class: 'gf-rail__item' }, ticket)));
    const dots = coupons.map(() => h('span', { class: 'gf-dot' }));
    const wallet = h(
      'section',
      { class: 'gf-wallet' },
      h('div', { class: 'gf-wallet__pocket' }, h('h2', { class: 'gf-wallet__title', text: text.walletTitle }), rail, h('div', { class: 'gf-dots', attrs: DECOR }, dots)),
      h('p', { class: 'gf-small', text: text.smallPrint }),
    );

    const scene = h('div', { class: 'gf-scene' }, slot, words, wallet);
    body.append(scene);

    // hidden (not only see-through) until the wallet is open, so nothing can press it early
    const button = h('button', { type: 'button', class: 'btn', hidden: true, dataset: { qc: 'primary' }, text: ctx.content.common?.next });
    const cta = h('div', { class: 'gf-cta gf-step' }, button);
    actions.append(cta);

    // the large coupon
    const sheetNo = h('span', { class: 'gf-card__no num' });
    const sheetTitle = h('h3', { class: 'gf-card__title' });
    const sheetNote = h('p', { class: 'gf-card__note' });
    const card = h(
      'div',
      { class: 'gf-card' },
      h(
        'div',
        { class: 'paper gf-card__paper' },
        h(
          'div',
          { class: 'gf-card__head' },
          h('span', { class: 'gf-card__serial', attrs: DECOR }, icon(STAR, 'gf-card__star'), sheetNo, h('span', { class: 'gf-card__of num', text: pad(coupons.length) })),
          h('span', { class: 'gf-card__wallet', text: text.walletTitle }),
        ),
        h('div', { class: 'gf-card__body' }, sheetTitle, sheetNote),
        h('p', { class: 'gf-card__print', text: text.smallPrint }),
        h('span', { class: 'gf-stamp gf-stamp--big', text: text.redeemedStamp }),
      ),
    );
    const redeemButton = h('button', { type: 'button', class: 'btn btn--rose gf-redeem', text: text.redeemButton });
    const close = h(
      'button',
      { type: 'button', class: 'gf-close', attrs: { 'aria-label': text.closeLabel ?? '' } },
      svg('svg', { viewBox: '0 0 24 24', focusable: 'false', ...DECOR }, svg('path', { d: 'M6 6l12 12M18 6L6 18' })),
    );
    const veil = h('div', { class: 'gf-sheet__veil', attrs: DECOR });
    const sheet = h(
      'div',
      { class: 'gf-sheet', hidden: true, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': text.walletTitle ?? '' } },
      veil,
      h('div', { class: 'gf-sheet__col' }, close, card, h('div', { class: 'gf-sheet__actions' }, redeemButton)),
    );
    root.append(sheet);

    button.addEventListener('click', () => {
      if (state.left) return;
      state.left = true;
      ctx.sfx.play('tap');
      ctx.haptics.tap();
      // a tap the flow does not take (a coupon was closed a moment ago) must never leave a dead button behind
      if (ctx.flow.next() !== true) state.left = false;
    });

    els = {
      root, scene, slot, stage, box, pull, words, line, wallet, rail, tickets, dots, cta, button, coupons, text,
      sheet, veil, card, close, sheetNo, sheetTitle, sheetNote, redeem: redeemButton,
      gap: 16,
    };
    root.dataset.gifts = 'wrapped';
    wallet.inert = true;
  },

  enter(context) {
    if (!els) return;
    ctx = context;
    bag.dispose();
    reset();
    ctx.audio.playMusic('celebration', { fadeMs: 1500 });

    bag.on(els.pull, 'pointerdown', dragStart);
    bag.on(els.pull, 'pointermove', dragMove);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) bag.on(els.pull, type, dragEnd);
    bag.on(els.pull, 'contextmenu', (event) => event.preventDefault());
    bag.on(els.box, 'click', boxClick);
    bag.on(els.box, 'contextmenu', (event) => event.preventDefault());

    els.tickets.forEach((ticket, index) => bag.on(ticket, 'click', () => openSheet(index)));
    let queued = false;
    bag.on(
      els.rail,
      'scroll',
      () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          syncSlider();
        });
      },
      { passive: true },
    );

    bag.on(els.veil, 'click', () => closeSheet());
    bag.on(els.close, 'click', () => {
      ctx.sfx.play('tap');
      closeSheet();
    });
    bag.on(els.redeem, 'click', redeem);
    bag.on(document, 'keydown', (event) => {
      if (event.key === 'Escape' && state.open >= 0) closeSheet();
    });
    bag.on(document, 'visibilitychange', () => {
      if (document.hidden) {
        dragEnd();
        // WhatsApp took the screen right after the stamp: she has not seen it land
        if (state.open >= 0 && performance.now() - state.stampedAt < RESTAMP_WITHIN_MS) state.restamp = true;
        return;
      }
      if (state.restamp && state.open >= 0) stamp();
      state.restamp = false;
    });
    bag.on(window, 'resize', () => {
      measure();
      syncSlider();
    });
    bag.timeout(measure, 60);
    bag.timeout(measure, 900); // once more after the screen has settled
    bag.timeout(() => {
      state.tapOk = true;
    }, TAP_AFTER_MS);
  },

  exit() {
    state.drag = null;
    steps.dispose();
    bag.dispose();
    closeSheet({ instant: true, viaBack: true });
    sheetBag.dispose();
    if (els) els.stage.classList.remove('is-dragging');
    ctx?.fx.confetti.clear();
  },

  complete() {
    if (!els) return;
    closeSheet({ instant: true });
    if (state.stage === 'wrapped') {
      untie({ instant: true });
      return;
    }
    els.root.classList.add('gf-instant'); // already open: only finish the reveal
    restRibbon();
    revealAll();
  },
};
