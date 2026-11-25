// The waiting room (screen "countdown"): a moon dial whose ring closes as midnight comes nearer,
// a little line that changes with the time left, a locked gift that answers every tap,
// and the "hold my hand" tap that allows sound and keeps the screen awake (any tap in this room does the same).
// In the last 60 seconds the page dims and a heartbeat starts; the last 10 seconds are giant numerals.
// Everything is derived from ctx.clock.now() on every second boundary — nothing counts intervals.
// Everything this screen starts is stopped in exit().
import { buildScreen, fill, h, pad2, scope, soft, splitDuration, svg, touched } from '../core/dom.js';
import { TARGET_MS } from '../config.js';

const RING_R = 94;
const RING_LENGTH = 2 * Math.PI * RING_R;
const RING_SPAN_S = 7 * 86400; // the ring is open by a hair a week before, closed at midnight
const FINAL_S = 60;
const GIANT_S = 10;
const PRELOAD_S = 20; // the celebration track is asked for once more when the clock looks at the server again
const REPLY_MS = 5200;
const PEEK_MS = 2600;
const SMALL_UNITS = ['hours', 'minutes', 'seconds'];

const bag = scope(); // lives from enter() to exit()
const peekBag = scope(); // the short timers of one gift tap
let els = null;
let lineSide = 0;
let lastLine = null;
let lastGiant = null;
let firstPaint = true;
let warmedLate = false;

function lineFor(lines, secondsLeft) {
  let chosen = lines[0];
  for (const entry of lines) {
    if (entry.underSeconds == null || secondsLeft < entry.underSeconds) chosen = entry;
  }
  return chosen?.line ?? '';
}

/** 0 → 1 as midnight approaches, on a logarithmic scale so the ring visibly moves in the last minutes too. */
function ringProgress(secondsLeft) {
  if (secondsLeft <= 0) return 1;
  return Math.max(0.03, Math.min(1, 1 - Math.log1p(secondsLeft) / Math.log1p(RING_SPAN_S)));
}

// ───────────── digits ─────────────

function makeDigit() {
  const inner = h('span', { class: 'digit__in', text: '0' });
  const el = h('span', { class: 'digit', dataset: { prev: '0' } }, inner);
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

function makeCell(unitWord, className) {
  const digits = [makeDigit(), makeDigit()];
  const unit = h('span', { class: 'dial__unit', text: unitWord });
  const el = h('div', { class: className }, h('span', { class: 'dial__num num' }, digits[0].el, digits[1].el), unit);
  return { el, digits, unit };
}

// ───────────── painting ─────────────

function setLine(text, animate) {
  if (text === lastLine) return;
  lastLine = text;
  if (!animate) {
    els.lines[lineSide].textContent = text;
    return;
  }
  const next = 1 - lineSide;
  els.lines[next].textContent = text;
  els.lines[next].classList.add('is-on');
  els.lines[lineSide].classList.remove('is-on');
  lineSide = next;
}

function beat(ctx) {
  if (touched()) ctx.haptics.heartbeat();
  if (ctx.store.armed) ctx.sfx.play('heartbeat');
  if (!ctx.reducedMotion) {
    soft(els.moon, [{ transform: 'scale(1)' }, { transform: 'scale(1.035)', offset: 0.3 }, { transform: 'scale(1)' }], {
      duration: 520,
      easing: 'ease-out',
    });
  }
}

function showGiant(ctx, seconds) {
  if (seconds === lastGiant) return;
  lastGiant = seconds;
  els.giant.textContent = String(seconds);
  if (!ctx.reducedMotion) {
    soft(
      els.giant,
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

function paint(ctx) {
  const waiting = ctx.flow.mode() !== 'replay';
  const left = waiting ? Math.max(0, TARGET_MS - ctx.clock.now()) : 0;
  const parts = splitDuration(left);
  const words = ctx.content.common.units;
  const animate = !firstPaint && !ctx.reducedMotion && document.visibilityState !== 'hidden';
  // The phone says "midnight has passed" but the server has not confirmed it (no network, or the date was
  // changed): the gift stays locked, the dial rests at zero and a calm line says what we are waiting for.
  const unconfirmed = waiting && left <= 0 && !ctx.clock.isTrusted();

  // days (only while there is at least one) and the three big cells
  const showDays = parts.days > 0;
  if (els.days.el.hidden === showDays) els.days.el.hidden = !showDays;
  const cells = { days: els.days, ...els.cells };
  for (const [unit, cell] of Object.entries(cells)) {
    const text = pad2(parts[unit]);
    setDigit(cell.digits[0], text.length > 2 ? text.slice(0, -1) : text[0], animate);
    setDigit(cell.digits[1], text[text.length - 1], animate);
    const word = words[unit][parts[unit] === 1 ? 0 : 1];
    if (cell.unit.textContent !== word) cell.unit.textContent = word;
  }

  // the ring and its little light
  const progress = ringProgress(parts.total);
  els.arc.setAttribute('stroke-dashoffset', (RING_LENGTH * (1 - progress)).toFixed(2));
  els.spark.style.transform = `rotate(${(progress * 360).toFixed(2)}deg)`;

  const networkLine = unconfirmed ? ctx.content.errors?.network : null;
  setLine(networkLine || lineFor(ctx.content.waitingRoom.littleLines, parts.total), !firstPaint);

  if (waiting && !warmedLate && parts.total <= PRELOAD_S) {
    warmedLate = true;
    ctx.audio.preload('celebration');
  }

  // the last minute
  const final = waiting && !unconfirmed && parts.total <= FINAL_S;
  const giant = waiting && !unconfirmed && parts.total <= GIANT_S;
  els.root.classList.toggle('is-final', final);
  els.root.classList.toggle('is-ten', giant);
  els.root.classList.toggle('is-zero', waiting && !unconfirmed && parts.total <= 0);
  els.dim.style.opacity = final ? (0.25 + 0.6 * (1 - Math.max(0, parts.total - GIANT_S) / (FINAL_S - GIANT_S))).toFixed(3) : '0';
  if (final && parts.total > 0 && !firstPaint) {
    if (parts.total <= 20 || parts.total % 2 === 0) beat(ctx);
  }
  if (giant && parts.total > 0) showGiant(ctx, parts.total);
  else if (lastGiant !== null) {
    lastGiant = null;
    els.giant.textContent = '';
  }

  firstPaint = false;
}

function showActions(ctx) {
  const replay = ctx.flow.mode() === 'replay';
  const held = ctx.audio.isUnlocked() && ctx.store.armed;
  els.hold.hidden = replay || held;
  els.held.hidden = replay || !held;
  els.onward.hidden = !replay;
}

// ───────────── any tap in this room holds my hand ─────────────

/**
 * Allows sound, starts the waiting music, fetches the celebration track ahead of midnight and keeps the
 * screen awake (ctx.awake holds it through the reveal and the chapters). Runs inside her first tap here,
 * wherever it lands — also in the last ten seconds, when the button itself cannot be tapped.
 */
function arm(ctx) {
  if (ctx.flow.mode() === 'replay' || ctx.flow.current() !== 'countdown') return;
  if (ctx.audio.isUnlocked() && ctx.store.armed) return;
  ctx.audio.unlock(); // must happen inside the tap
  ctx.audio.playMusic('waiting', { fadeMs: 2600 });
  ctx.audio.preload('celebration');
  ctx.store.armed = true;
  ctx.awake.hold();
  showActions(ctx);
}

// ───────────── the locked gift ─────────────

function peek(ctx) {
  const replies = ctx.content.waitingRoom.peekReplies;
  const count = ctx.store.addPeek();
  const reply = fill(replies[(count - 1) % replies.length], { count });

  ctx.haptics.buzz([22, 46, 22]);
  ctx.sfx.play('pop');
  if (!ctx.reducedMotion) {
    soft(
      els.gift,
      [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(-9deg) translateX(-3px)' },
        { transform: 'rotate(8deg) translateX(3px)' },
        { transform: 'rotate(-6deg) translateX(-2px)' },
        { transform: 'rotate(4deg)' },
        { transform: 'rotate(0deg)' },
      ],
      { duration: 620, easing: 'ease-out' },
    );
  }

  peekBag.dispose();
  els.reply.textContent = reply;
  els.tag.classList.add('is-reply');
  els.peek.classList.add('is-on');
  peekBag.timeout(() => els.peek.classList.remove('is-on'), PEEK_MS);
  peekBag.timeout(() => els.tag.classList.remove('is-reply'), REPLY_MS);
}

// ───────────── build ─────────────

function buildDial(ctx, keys) {
  const words = ctx.content.common.units;

  const ring = svg('svg', { class: 'dial__ring', viewBox: '0 0 200 200', 'aria-hidden': 'true' });
  const track = svg('circle', { class: 'dial__track', cx: 100, cy: 100, r: RING_R });
  const arc = svg('circle', {
    class: 'dial__arc',
    cx: 100,
    cy: 100,
    r: RING_R,
    transform: 'rotate(-90 100 100)',
    'stroke-dasharray': RING_LENGTH.toFixed(2),
    'stroke-dashoffset': RING_LENGTH.toFixed(2),
  });
  ring.append(track, arc);

  const spark = h('div', { class: 'dial__spark', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'dial__spark-dot' }));
  const moon = h(
    'div',
    { class: 'dial__moon', attrs: { 'aria-hidden': 'true' } },
    h('span', { class: 'dial__crater dial__crater--a' }),
    h('span', { class: 'dial__crater dial__crater--b' }),
    h('span', { class: 'dial__crater dial__crater--c' }),
    h('span', { class: 'dial__crater dial__crater--d' }),
  );

  const days = makeCell(words.days[1], 'dial__days');
  const cells = {};
  const row = h('div', { class: 'dial__row' });
  for (const unit of SMALL_UNITS) {
    cells[unit] = makeCell(words[unit][1], 'dial__cell');
    row.append(cells[unit].el);
  }
  const giant = h('span', { class: 'dial__giant num' });
  const face = h('div', { class: 'dial__face', dataset: { qc: 'countdown' }, attrs: { role: 'timer' } }, days.el, row, giant);

  const sleeper = h('div', { class: 'sticker-slot dial__sleeper', attrs: { 'aria-hidden': 'true' } }, ctx.stickers.el(keys[1]));
  const dial = h('div', { class: 'dial reveal' }, ring, spark, moon, face, sleeper);
  return { dial, arc, spark, moon, days, cells, giant };
}

export default {
  id: 'countdown',

  mount(root, ctx) {
    const text = ctx.content.waitingRoom;
    const keys = ctx.stickers.forChapter('countdown'); // under the stars, asleep, lazy, peeking
    const { col, body, actions } = buildScreen(root);
    col.classList.add('wr');

    const dim = h('div', { class: 'wr-dim', attrs: { 'aria-hidden': 'true' } });
    root.prepend(dim);

    const head = h(
      'header',
      { class: 'wr__head' },
      h('p', { class: 'eyebrow reveal d1', text: text.under }),
      h('h1', { class: 'title reveal d2', text: text.heading }),
    );

    const parts = buildDial(ctx, keys);

    const lines = [h('span', { class: 'wr__line-text is-on' }), h('span', { class: 'wr__line-text' })];
    const line = h('p', { class: 'hand wr__line reveal d3', attrs: { 'aria-live': 'polite' } }, lines[0], lines[1]);

    // the locked gift: a wrapped box with a gold lock; the bear peeks out from behind it
    const gift = h(
      'button',
      { type: 'button', class: 'gift', attrs: { 'aria-label': text.onGift } },
      h('span', { class: 'gift__bow', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'gift__lid', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'gift__box', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'gift__lock', attrs: { 'aria-hidden': 'true' } }),
    );
    const peekSlot = h('div', { class: 'sticker-slot wr__peek', attrs: { 'aria-hidden': 'true' } }, ctx.stickers.el(keys[3]));
    const lazy = h('div', { class: 'sticker-slot wr__lazy', attrs: { 'aria-hidden': 'true' } }, ctx.stickers.el(keys[2]));
    const reply = h('span', { class: 'wr__tag-text wr__tag-reply', attrs: { 'aria-live': 'polite' } });
    const tag = h('p', { class: 'wr__tag' }, h('span', { class: 'wr__tag-text wr__tag-label', text: text.onGift }), reply);
    const present = h('div', { class: 'wr__present reveal d4' }, h('div', { class: 'wr__present-row' }, lazy, gift, peekSlot), tag);

    body.append(head, parts.dial, line, present);

    const hold = h('button', { type: 'button', class: 'btn reveal d5', dataset: { qc: 'primary' }, text: text.soundButton });
    const held = h(
      'div',
      { class: 'wr__held reveal d5', hidden: true },
      h('div', { class: 'sticker-slot wr__pair', attrs: { 'aria-hidden': 'true' } }, ctx.stickers.el(keys[0])),
      h('p', { class: 'hand wr__held-line', text: text.soundAfter }),
    );
    const onward = h('button', { type: 'button', class: 'btn reveal d5', text: ctx.content.common.next, hidden: true });
    actions.append(hold, held, onward);

    // capture: sound is allowed before the tapped thing itself answers with its own sound
    root.addEventListener('click', () => arm(ctx), true);
    hold.addEventListener('click', () => {
      ctx.sfx.play('chime');
      ctx.haptics.success();
    });
    gift.addEventListener('click', () => peek(ctx));
    onward.addEventListener('click', () => ctx.flow.next());

    els = { root, dim, lines, gift, peek: peekSlot, tag, reply, hold, held, onward, ...parts };
  },

  enter(ctx) {
    firstPaint = true;
    lastGiant = null;
    warmedLate = false;
    paint(ctx);
    showActions(ctx);
    bag.add(ctx.clock.onTick(() => paint(ctx)));
    bag.on(document, 'visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      firstPaint = true; // no rolling digits for the time she was away
      paint(ctx);
    });
    if (ctx.audio.isUnlocked()) {
      // its own music, also when it is replayed from the menu: the waiting room sounds like the waiting room
      ctx.audio.playMusic('waiting', { fadeMs: 2600 });
      if (ctx.flow.mode() !== 'replay') {
        ctx.audio.preload('celebration');
        if (ctx.store.armed) ctx.awake.hold();
      }
    }
  },

  exit() {
    bag.dispose();
    peekBag.dispose();
    if (!els) return;
    els.tag.classList.remove('is-reply');
    els.peek.classList.remove('is-on');
  },

  complete() {
    // nothing to finish: the waiting room ends when midnight comes
  },
};
