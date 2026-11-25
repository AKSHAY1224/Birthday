// Chapter "letter" (The letter) — the one quiet, deep moment of the site. No stickers, no confetti.
// 1. A sealed envelope on the dark screen. She presses and holds the wax seal: a ring fills, cracks
//    appear, the seal breaks. (After a few seconds a plain tap is enough.)
// 2. The flap opens, the sheet rises and unfolds into the letter paper that fills the screen.
// 3. The letter is read at her pace: every tap shows the next paragraph; the paper scrolls inside
//    itself. The one line in gold gets its own breath. At the end his name is written with a pen
//    line, and only then the main button appears.
// Interface: mount builds the DOM once, enter resets and starts, exit stops everything it started,
// complete shows the whole letter and the button at once (safe to call twice).
import { buildScreen, h, rich, scope, svg } from '../core/dom.js';

const HOLD_MS = 700; // how long she holds the seal
const FALL_MS = 420; // how fast the ring falls back after an early release
const AUTO_MS = 420; // the ring finishing by itself (tap fallback, keyboard)
const FALLBACK_AFTER_MS = 4000; // then a plain tap is enough
const HINT_MS = 2600;
const CRACKS = [0.3, 0.58, 0.84]; // a crack (and a soft tick) on the way

// after the seal breaks, in milliseconds
const FLAP_AT_MS = 420;
const FLAP_BEHIND_MS = 150; // the flap is edge-on now: it goes behind the sheet
const SHEET_AT_MS = 1150;
const READ_AT_MS = 2050; // the envelope leaves, the paper unfolds
const FIRST_LINE_MS = 950; // after the paper started to unfold
const CONTROLS_MS = 1700;

const STEP_GUARD_MS = 320; // one tap, one paragraph
const SIGN_AT_MS = 700; // the sign-off, then his name …
const AFTER_SIGN_MS = 2900; // … then the small line in brackets …
const BUTTON_AT_MS = 4100; // … and the button last
const ALL_BUTTON_MS = 900; // "show the whole letter": the button follows the text, once she has read to its end
const END_SLACK_PX = 48; // this close to the end of the paper counts as "read to the end"

const DECOR = { 'aria-hidden': 'true' };
const FLAME_OUTER = 'M50 31C57 40 63 46 63 55C63 63 57 69 50 69C43 69 37 63 37 55C37 49 40 45 44 40C45 44 46 46 48 47C48 41 49 36 50 31Z';
const FLAME_INNER = 'M50 50C53 53 56 56 56 60C56 64 53 66 50 66C47 66 44 64 44 60C44 56 47 54 50 50Z';
const WAX = 'M50 5C62 3 75 8 84 17C93 26 98 39 96 52C95 65 89 78 78 86C68 94 55 98 42 95C30 93 18 86 11 75C4 64 2 50 6 38C9 26 18 15 29 9C35 6 43 6 50 5Z';

/** A dash between two words stays with the word before it, so no line begins with a dash. The words are not changed. */
const tidy = (text) => String(text ?? '').replace(/ ([–—]) /g, ' $1 ');

const bag = scope(); // listeners and timers of one visit
const steps = scope(); // the timed parts: opening the envelope, the signature
let els = null;
let ctx = null;
const state = { stage: 'sealed', holding: false, auto: false, tapOk: false, progress: 0, crack: 0, shown: 0, lastStep: -Infinity, left: false, stopLoop: null, stopHint: null };

// ───────────── drawing ─────────────

/** A gradient whose colours come from CSS classes (tokens only). stops: [[offset, class], …] */
function gradient(type, id, attrs, stops) {
  return svg(type, { id, ...attrs }, ...stops.map(([offset, name]) => svg('stop', { offset: String(offset), class: `letter-stop letter-stop--${name}` })));
}

/** The wax seal with the tiny flame pressed into it. Drawn twice (one per half), so every id gets a suffix. */
function drawWax(suffix) {
  const fill = `letter-wax-${suffix}`;
  return svg(
    'svg',
    { class: 'seal__svg', viewBox: '0 0 100 100', focusable: 'false', ...DECOR },
    svg(
      'defs',
      {},
      gradient('radialGradient', fill, { cx: '0.36', cy: '0.3', r: '0.78' }, [
        [0, 'wax-hi'],
        [0.42, 'wax'],
        [1, 'wax-deep'],
      ]),
    ),
    svg('path', { d: WAX, fill: `url(#${fill})` }),
    svg('circle', { cx: '50', cy: '50', r: '32', class: 'seal__groove' }),
    svg('circle', { cx: '50.6', cy: '50.8', r: '32', class: 'seal__lip' }),
    svg('path', { d: FLAME_OUTER, class: 'seal__flame' }),
    svg('path', { d: FLAME_INNER, class: 'seal__flame-core' }),
    svg('path', { d: 'M24 31C29 22 38 16 48 15', class: 'seal__shine' }),
  );
}

function drawCracks() {
  return svg(
    'svg',
    { class: 'seal__cracks', viewBox: '0 0 100 100', focusable: 'false', ...DECOR },
    svg('path', { d: 'M50 5L47 22L53 33L48 45', class: 'seal__crack seal__crack--1' }),
    svg('path', { d: 'M48 45L54 56L47 68L52 80L49 96M53 33L65 28L73 17', class: 'seal__crack seal__crack--2' }),
    svg('path', { d: 'M47 68L34 73L26 85M54 56L68 60L80 71', class: 'seal__crack seal__crack--3' }),
  );
}

/** The thin ring around the seal: a faint track and two half arcs that rotate into view (transform only). */
function drawRing() {
  const first = h('span', { class: 'seal__arc' });
  const second = h('span', { class: 'seal__arc' });
  const ring = h('span', { class: 'seal__ring', attrs: DECOR }, h('span', { class: 'seal__track' }), h('span', { class: 'seal__half seal__half--a' }, first), h('span', { class: 'seal__half seal__half--b' }, second));
  return { ring, first, second };
}

const FLAP = 'M0 0H320L173 120Q160 130 147 120Z';
const FLAP_EDGE = 'M4 1L147 118Q160 128 173 118L316 1';

/** One face of the flap. The inner face is turned over (CSS), so it is drawn upside down: turned, it is the same triangle seen from behind. */
function flapFace(kind) {
  const inner = kind === 'in';
  const shapes = inner
    ? svg(
        'g',
        { transform: 'translate(0 128) scale(1 -1)' },
        svg('path', { d: FLAP, fill: 'url(#letter-flap-in)' }),
        svg('path', { d: FLAP_EDGE, class: 'env__flap-edge env__flap-edge--in' }),
      )
    : svg('g', {}, svg('path', { d: FLAP, class: 'env__flap-shape' }), svg('path', { d: FLAP_EDGE, class: 'env__flap-edge' }));
  return h(
    'span',
    { class: `env__face env__face--${kind}` },
    svg(
      'svg',
      { viewBox: '0 0 320 128', preserveAspectRatio: 'none', focusable: 'false', ...DECOR },
      inner
        ? svg(
            'defs',
            {},
            gradient('linearGradient', 'letter-flap-in', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
              [0, 'flap-hinge'],
              [1, 'flap-tip'],
            ]),
          )
        : null,
      shapes,
    ),
  );
}

/** The envelope: back, sheet, pocket with her name, flap and seal. Drawn in a 320 x 232 box. */
function buildEnvelope(name, sealLabel) {
  const pocket = svg(
    'svg',
    { class: 'env__pocket', viewBox: '0 0 320 232', role: 'img', 'aria-label': name, focusable: 'false' },
    svg(
      'defs',
      {},
      gradient('linearGradient', 'letter-fold-side', { x1: '0', y1: '0', x2: '1', y2: '0' }, [
        [0, 'fold-a'],
        [0.5, 'fold-b'],
        [1, 'fold-a'],
      ]),
      gradient('linearGradient', 'letter-fold-low', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        [0, 'fold-c'],
        [1, 'fold-d'],
      ]),
    ),
    svg('path', { d: 'M0 0L160 122L0 232Z', fill: 'url(#letter-fold-side)' }),
    svg('path', { d: 'M320 0L160 122L320 232Z', fill: 'url(#letter-fold-side)' }),
    svg('path', { d: 'M0 0L160 122L320 0', class: 'env__crease' }),
    svg('path', { d: 'M0 230L146 121Q160 111 174 121L320 230', class: 'env__fold-shadow' }),
    svg('path', { d: 'M0 232L146 124Q160 114 174 124L320 232Z', fill: 'url(#letter-fold-low)' }),
    svg('path', { d: 'M0 232L146 124Q160 114 174 124L320 232', class: 'env__crease' }),
    svg('text', { x: '160', y: '213', 'text-anchor': 'middle', class: 'env__name', ...DECOR }, name),
  );

  const { ring, first, second } = drawRing();
  const seal = h(
    'button',
    { type: 'button', class: 'seal', attrs: { 'aria-label': sealLabel } },
    h('span', { class: 'seal__shadow', attrs: DECOR }),
    ring,
    h('span', { class: 'seal__wax', attrs: DECOR }, h('span', { class: 'seal__part seal__part--a' }, drawWax('a')), h('span', { class: 'seal__part seal__part--b' }, drawWax('b')), drawCracks()),
  );

  const env = h(
    'div',
    { class: 'env reveal' },
    h('div', { class: 'env__back', attrs: DECOR }),
    h('div', { class: 'env__sheet', attrs: DECOR }),
    pocket,
    h('div', { class: 'env__flap-shadow', attrs: DECOR }),
    h('div', { class: 'env__flap', attrs: DECOR }, flapFace('out'), flapFace('in')),
    seal,
  );
  return { env, seal, first, second };
}

/** His name as SVG text in the script font: a pen layer drawn letter by letter over a fill layer (as her name at midnight). */
function buildSignature(name) {
  const place = { x: '236', y: '60', 'text-anchor': 'end', ...DECOR };
  const pen = svg('text', { ...place, class: 'letter__sig-pen', fill: 'none' });
  [...name].forEach((letter, index) => {
    const span = svg('tspan', {}, letter);
    span.style.setProperty('--i', String(index));
    pen.append(span);
  });
  return svg('svg', { class: 'letter__sig', viewBox: '0 0 240 84', role: 'img', 'aria-label': name }, svg('text', { ...place, class: 'letter__sig-fill' }, name), pen);
}

/**
 * One paragraph of content.json as an element.
 * → { el, kind: 'hello' | 'text' | 'gold' | 'sign', sig, after: [elements shown after the signature] }
 */
function buildParagraph(text, index, total) {
  const source = tidy(text);
  const lines = source.split('\n');
  const nameAt = lines.findIndex((line) => /^\*\*[^*]+\*\*$/.test(line.trim()));

  // the sign-off: the last paragraph, with his name alone on a line
  if (index === total - 1 && nameAt > -1 && lines.length > 1) {
    const sig = buildSignature(lines[nameAt].trim().slice(2, -2));
    const before = lines.slice(0, nameAt).map((line) => h('p', { class: 'letter__signoff' }, rich(line)));
    const after = lines.slice(nameAt + 1).map((line) => h('p', { class: 'letter__ps' }, rich(line)));
    return { el: h('div', { class: 'letter__p letter__sign', hidden: true }, ...before, sig, ...after), kind: 'sign', sig, after };
  }
  // one sentence, all in bold: the line that gets its own breath
  if (/^\*\*[^*]+\*\*$/.test(source.trim())) {
    return { el: h('p', { class: 'letter__p letter__p--gold', hidden: true }, rich(source)), kind: 'gold', sig: null, after: [] };
  }
  const kind = index === 0 ? 'hello' : 'text';
  return { el: h('p', { class: `letter__p${index === 0 ? ' letter__p--hello' : ''}`, hidden: true }, rich(source)), kind, sig: null, after: [] };
}

// ───────────── the seal: ring and hold ─────────────

function renderRing() {
  const turn = state.progress * 360;
  els.first.style.transform = `rotate(${Math.min(180, turn).toFixed(1)}deg)`;
  els.second.style.transform = `rotate(${Math.max(0, turn - 180).toFixed(1)}deg)`;
  // an empty arc stays invisible, so no hairline shows where the two halves meet
  els.first.style.opacity = turn > 0 ? '1' : '0';
  els.second.style.opacity = turn > 180 ? '1' : '0';
}

function setCracks(count) {
  CRACKS.forEach((_, index) => els.seal.classList.toggle(`is-crack-${index + 1}`, index < count));
}

function stopLoop() {
  if (state.stopLoop) state.stopLoop();
  state.stopLoop = null;
}

function startLoop() {
  if (state.stopLoop) return;
  state.stopLoop = bag.raf((time, delta) => {
    if (state.stage !== 'sealed') return stopLoop();
    if (state.auto) state.progress += delta / AUTO_MS;
    else if (state.holding) state.progress += delta / HOLD_MS;
    else state.progress -= delta / FALL_MS;
    state.progress = Math.max(0, Math.min(1, state.progress));

    while (state.crack < CRACKS.length && state.progress >= CRACKS[state.crack]) {
      state.crack += 1;
      setCracks(state.crack);
      ctx.haptics.tap();
      ctx.sfx.play('tick');
    }
    renderRing();
    if (state.progress >= 1) return breakSeal();
    if (state.progress <= 0 && !state.holding) stopLoop();
    return undefined;
  });
}

function showHint(text, { stay = false } = {}) {
  if (state.stopHint) state.stopHint();
  state.stopHint = null;
  if (!text) return;
  els.hint.textContent = text;
  els.hint.classList.add('is-on');
  if (!stay) state.stopHint = bag.timeout(() => els.hint.classList.remove('is-on'), HINT_MS);
}

function press(event) {
  if (state.stage !== 'sealed' || state.auto) return;
  if (event.button != null && event.button > 0) return;
  ctx.audio.unlock();
  state.holding = true;
  els.seal.classList.add('is-held');
  try {
    els.seal.setPointerCapture(event.pointerId);
  } catch {
    // capture is a nicety
  }
  startLoop();
}

function release() {
  if (!state.holding) return;
  state.holding = false;
  els.seal.classList.remove('is-held');
  if (state.stage !== 'sealed') return;
  if (state.tapOk) {
    state.auto = true; // a plain tap is enough now: the ring finishes by itself
    startLoop();
    return;
  }
  showHint(els.text.hint);
}

/** Keyboard and switch users: Enter or Space breaks it (a click that no pointer made). */
function keyClick(event) {
  if (event.detail !== 0 || state.stage !== 'sealed') return;
  ctx.audio.unlock();
  state.auto = true;
  startLoop();
}

function offerTap() {
  if (state.stage !== 'sealed') return;
  state.tapOk = true;
  showHint(els.text.tapFallback, { stay: true });
}

// ───────────── the envelope opens ─────────────

function breakSeal() {
  if (state.stage !== 'sealed') return;
  state.stage = 'opening';
  state.holding = false;
  state.auto = false;
  state.progress = 1;
  stopLoop();
  if (state.stopHint) state.stopHint();
  state.stopHint = null;
  renderRing();
  setCracks(CRACKS.length);

  els.seal.classList.remove('is-held');
  els.seal.disabled = true;
  els.hint.classList.remove('is-on');
  els.root.dataset.letter = 'opening';
  els.env.classList.add('is-broken');
  ctx.haptics.success();
  ctx.sfx.play('pop');

  if (ctx.reducedMotion) {
    steps.timeout(startReading, 500);
    return;
  }
  steps.timeout(() => {
    els.env.classList.add('is-flap');
    ctx.sfx.play('puff');
  }, FLAP_AT_MS);
  steps.timeout(() => els.env.classList.add('is-flap-behind'), FLAP_AT_MS + FLAP_BEHIND_MS);
  steps.timeout(() => els.env.classList.add('is-sheet'), SHEET_AT_MS);
  steps.timeout(startReading, READ_AT_MS);
}

function showControls() {
  if (state.stage !== 'reading') return;
  els.controls.hidden = false;
  void els.controls.offsetWidth; // so the fade starts from zero
  els.controls.classList.add('is-on');
}

/** The envelope leaves and the letter paper unfolds; the first line comes by itself. */
function startReading() {
  if (state.stage === 'reading' || state.stage === 'signing' || state.stage === 'done') return;
  state.stage = 'reading';
  els.root.dataset.letter = 'reading';
  steps.timeout(() => {
    if (state.shown === 0) revealNext({ force: true });
  }, FIRST_LINE_MS);
  steps.timeout(showControls, CONTROLS_MS);
}

// ───────────── reading ─────────────

function show(el) {
  if (el.hidden) {
    el.hidden = false;
    void el.offsetWidth; // so the fade starts from zero
  }
  el.classList.add('is-on');
}

/** Scrolls the paper so that a freshly shown part can be read; the gold line goes to the middle. */
function bringIntoView(el, { centre = false } = {}) {
  const view = els.scroll;
  const frame = view.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  if (!frame.height || !box.height) return;
  const top = view.scrollTop + (box.top - frame.top);
  let target;
  if (centre) target = top - (frame.height - box.height) / 2;
  else target = Math.min(top - 28, Math.max(view.scrollTop, top + box.height + 56 - frame.height));
  target = Math.max(0, Math.min(target, view.scrollHeight - view.clientHeight));
  if (Math.abs(target - view.scrollTop) < 2) return;
  try {
    view.scrollTo({ top: target, behavior: ctx.reducedMotion ? 'auto' : 'smooth' });
  } catch {
    view.scrollTop = target;
  }
}

function showButton() {
  if (els.button.hidden) {
    els.button.hidden = false;
    void els.cta.offsetWidth; // so the fade starts from zero
  }
  els.cta.classList.add('is-on');
}

/** The whole letter has been shown: the reading controls go, the main button comes. */
function finish() {
  state.stage = 'done';
  els.root.dataset.letter = 'done';
  els.paper.classList.remove('has-more');
  els.controls.classList.remove('is-on');
  els.controls.hidden = true;
  showButton();
}

/** The sign-off is on the paper: his name writes itself, then the small line, then the button. */
function sign(item) {
  state.stage = 'signing';
  els.controls.classList.remove('is-on'); // nothing left to ask for
  steps.timeout(() => item.sig.classList.add('is-writing'), SIGN_AT_MS);
  steps.timeout(() => {
    item.after.forEach(show);
    bringIntoView(item.el);
  }, AFTER_SIGN_MS);
  steps.timeout(finish, BUTTON_AT_MS);
}

/** One tap: the next paragraph fades in. */
function revealNext({ force = false } = {}) {
  if (state.stage !== 'reading') return;
  const time = performance.now();
  if (!force && time - state.lastStep < STEP_GUARD_MS) return;
  const item = els.items[state.shown];
  if (!item) return;
  state.lastStep = time;
  state.shown += 1;
  els.paper.classList.toggle('is-breath', item.kind === 'gold'); // the gold line stands alone for a moment
  show(item.el);
  bringIntoView(item.el, { centre: item.kind === 'gold' });
  if (item.kind === 'gold') ctx.haptics.heartbeat();
  if (item.kind === 'sign') sign(item);
  else if (state.shown >= els.items.length) finish();
}

/** Everything at once, for a reader who prefers that (and for complete()). */
function showAll({ instant = false } = {}) {
  steps.dispose();
  els.paper.classList.remove('is-breath');
  for (const item of els.items) {
    show(item.el);
    if (item.sig) {
      item.sig.classList.remove('is-writing');
      item.sig.classList.add('is-signed');
    }
    item.after.forEach(show);
  }
  state.shown = els.items.length;
  if (instant) {
    finish();
    return;
  }
  state.stage = 'signing';
  els.controls.classList.remove('is-on');
  // The whole letter is on the paper now, but only its beginning is on screen. The way on waits until she has
  // read down to the signature — the paper must never look finished where it is not — and a small mark at its
  // lower edge says that there is more.
  const settle = () => {
    if (state.stage !== 'signing') return;
    if (readToEnd()) finish();
    else els.paper.classList.add('has-more');
  };
  steps.on(els.scroll, 'scroll', settle, { passive: true });
  steps.on(window, 'resize', settle);
  steps.timeout(settle, ALL_BUTTON_MS);
}

/** Is the end of the paper on screen (or is there nothing to scroll)? */
function readToEnd() {
  const view = els.scroll;
  return view.scrollTop + view.clientHeight >= view.scrollHeight - END_SLACK_PX;
}

/** Back to the sealed envelope. */
function reset() {
  steps.dispose();
  stopLoop();
  Object.assign(state, { stage: 'sealed', holding: false, auto: false, tapOk: false, progress: 0, crack: 0, shown: 0, lastStep: -Infinity, left: false, stopHint: null });
  els.root.classList.add('letter-instant');
  els.root.dataset.letter = 'sealed';
  els.env.classList.remove('is-broken', 'is-flap', 'is-flap-behind', 'is-sheet');
  els.seal.disabled = false;
  els.seal.classList.remove('is-held');
  setCracks(0);
  renderRing();
  els.hint.classList.remove('is-on');
  els.hint.textContent = '';
  els.paper.classList.remove('is-breath', 'has-more');
  for (const item of els.items) {
    item.el.hidden = true;
    item.el.classList.remove('is-on');
    item.sig?.classList.remove('is-writing', 'is-signed');
    for (const line of item.after) line.classList.remove('is-on');
  }
  els.scroll.scrollTop = 0;
  els.controls.hidden = true;
  els.controls.classList.remove('is-on');
  els.button.hidden = true;
  els.cta.classList.remove('is-on');
  void els.root.offsetWidth;
  els.root.classList.remove('letter-instant');
}

// ───────────── the module ─────────────

export default {
  id: 'letter',

  mount(root, context) {
    ctx = context;
    const content = ctx.content;
    const letter = content.letter ?? {};
    const paragraphs = Array.isArray(letter.paragraphs) ? letter.paragraphs : [];
    const text = {
      seal: letter.seal ?? content.lamp?.instruction ?? '',
      hint: letter.hint ?? '',
      tapFallback: letter.tapFallback ?? '',
      nextLine: letter.nextLine ?? content.common?.next ?? '',
      showAll: letter.showAll ?? '',
    };
    // the name on the envelope is the greeting of the letter without its comma
    const name = String(paragraphs[0] ?? content.midnight?.name ?? '').replace(/[\s,]+$/, '');

    const { col, body, actions } = buildScreen(root);
    col.classList.add('letter');
    root.prepend(h('div', { class: 'letter__veil', attrs: DECOR }));

    // 1. the sealed envelope
    const { env, seal, first, second } = buildEnvelope(name, text.seal);
    const hint = h('p', { class: 'letter__hint', attrs: { 'aria-live': 'polite' } });
    const prompt = h('div', { class: 'letter__prompt reveal d3' }, h('p', { class: 'letter__instruction', text: text.seal }), hint);
    const scene = h('div', { class: 'letter__scene' }, h('div', { class: 'letter__glow', attrs: DECOR }), env, prompt);

    // 2. the letter paper
    const items = paragraphs.map((paragraph, index) => buildParagraph(paragraph, index, paragraphs.length));
    const mark = svg('svg', { class: 'letter__mark', viewBox: '34 28 32 44', focusable: 'false', ...DECOR }, svg('path', { d: FLAME_OUTER, class: 'letter__mark-out' }), svg('path', { d: FLAME_INNER, class: 'letter__mark-in' }));
    const page = h('div', { class: 'letter__page' }, mark, ...items.map((item) => item.el));
    const scroll = h('div', { class: 'letter__scroll' }, page);
    const paper = h('div', { class: 'paper letter__paper' }, h('span', { class: 'letter__fold letter__fold--a', attrs: DECOR }), h('span', { class: 'letter__fold letter__fold--b', attrs: DECOR }), scroll);
    body.append(h('div', { class: 'letter__stack' }, scene, paper));

    // 3. reading controls, and the main button that takes their place at the very end
    const more = h(
      'button',
      { type: 'button', class: 'letter__more' },
      h('span', { text: text.nextLine }),
      svg('svg', { viewBox: '0 0 24 24', focusable: 'false', ...DECOR }, svg('path', { d: 'M6.5 9.5 12 15l5.5-5.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
    );
    const all = text.showAll ? h('button', { type: 'button', class: 'letter__all', text: text.showAll }) : null;
    const controls = h('div', { class: 'letter__controls', hidden: true }, more, all);
    // hidden (not only see-through) until the whole letter is on the paper, so nothing can press it early
    const button = h('button', { type: 'button', class: 'btn', hidden: true, dataset: { qc: 'primary' }, text: content.common?.next });
    const cta = h('div', { class: 'letter__cta' }, button);
    actions.append(h('div', { class: 'letter__dock' }, controls, cta));

    button.addEventListener('click', () => {
      if (state.left) return;
      state.left = true;
      ctx.sfx.play('tap');
      ctx.haptics.tap();
      // a tap the flow does not take (too soon after a change) must never leave a dead button behind
      if (ctx.flow.next() !== true) state.left = false;
    });

    els = { root, env, seal, first, second, hint, paper, scroll, items, more, all, controls, cta, button, text };
    root.dataset.letter = 'sealed';
    renderRing();
  },

  enter(context) {
    if (!els) return;
    ctx = context;
    bag.dispose();
    reset();
    ctx.audio.playMusic('letter', { fadeMs: 2500 }); // the story music fades into the letter track

    bag.on(els.seal, 'pointerdown', press);
    bag.on(els.seal, 'pointerup', release);
    bag.on(els.seal, 'pointercancel', release);
    bag.on(els.seal, 'lostpointercapture', release);
    bag.on(els.seal, 'click', keyClick);
    bag.on(els.seal, 'contextmenu', (event) => event.preventDefault());
    bag.on(document, 'visibilitychange', () => {
      if (document.hidden) release();
    });

    // a tap anywhere on the paper, or on the gentle control below it
    bag.on(els.paper, 'click', () => revealNext());
    bag.on(els.more, 'click', () => revealNext());
    if (els.all) {
      bag.on(els.all, 'click', () => {
        if (state.stage !== 'reading') return;
        ctx.sfx.play('tap');
        showAll();
      });
    }
    bag.timeout(offerTap, FALLBACK_AFTER_MS);
  },

  exit() {
    state.holding = false;
    stopLoop();
    steps.dispose();
    bag.dispose();
    if (els) els.seal.classList.remove('is-held');
  },

  complete() {
    if (!els) return;
    state.holding = false;
    state.auto = false;
    stopLoop();
    if (state.stopHint) state.stopHint();
    state.stopHint = null;
    els.root.classList.add('letter-instant'); // nothing moves: the letter is simply there
    els.seal.classList.remove('is-held');
    els.seal.disabled = true;
    els.hint.classList.remove('is-on');
    els.env.classList.add('is-broken', 'is-flap', 'is-flap-behind', 'is-sheet');
    showAll({ instant: true });
  },
};
