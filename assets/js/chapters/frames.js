// Chapter "frames" (Our four frames) — one scrapbook page on the night sky.
// Frame A (the square portrait) is the hero of the first view, frame B follows large, C and D are two
// small tilted polaroids side by side. The page scrolls inside the chapter, never sideways. Every picture
// "develops" (white → soft → full colour) when it comes into view. A tap opens a frame large in a calm
// full-screen view; the close button, a tap outside, Escape and the Back gesture close it again without
// leaving the chapter (the Back gesture through ctx.flow.openOverlay).
// Interface: mount builds the DOM once, enter resets and starts, exit stops everything it started,
// complete shows every frame and the button at once (safe to call twice).
import { buildScreen, h, rich, scope, svg } from '../core/dom.js';

const ID = 'frames';

// The web-ready copies made by tools/prepare-media.mjs (paths start at the page; sizes in real pixels).
const PHOTOS = {
  a: { src: 'assets/img/photos/frame-a.webp', tiny: 'assets/img/photos/frame-a-tiny.webp', width: 1024, height: 1024 },
  b: { src: 'assets/img/photos/frame-b.webp', tiny: 'assets/img/photos/frame-b-tiny.webp', width: 1200, height: 1600 },
  c: { src: 'assets/img/photos/frame-c.webp', tiny: 'assets/img/photos/frame-c-tiny.webp', width: 1130, height: 1106 },
  d: { src: 'assets/img/photos/frame-d.webp', tiny: 'assets/img/photos/frame-d-tiny.webp', width: 540, height: 1141 },
};

const RISE_SHARE = 0.12; // this much of a frame in view: the print slides in
const DEVELOP_SHARE = 0.5; // this much in view: the picture develops, and the frame counts as seen
const SHARES = [0, 0.06, 0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 1];
const BUTTON_AFTER_SEEN_MS = 900; // the main button, once the second frame has been seen …
const BUTTON_AFTER_MS = 6000; // … or after this long in any case
const RETRY_MS = 1400; // a photo that failed is asked for once more
const VIEW_OUT_MS = 420; // the large view fading away
const DECOR = { 'aria-hidden': 'true' };

const bag = scope(); // listeners, the observer and timers of one visit
const viewBag = scope(); // timers of the large view

let ui = null;
let ctx = null;
const state = { viewing: null, release: null }; // release: tells the flow that she closed the view herself

// ───────────── building ─────────────

/** A caption with each sentence kept together: the line breaks between two sentences, not inside one that fits. */
function caption(text) {
  const fragment = document.createDocumentFragment();
  String(text ?? '')
    .split(/(?<=[.!?…])\s+/)
    .filter(Boolean)
    .forEach((sentence, index) => fragment.append(index > 0 ? ' ' : '', h('span', { class: 'fr-sentence' }, rich(sentence))));
  return fragment;
}

/** One print: paper, tape or corners, the picture with its two "undeveloped" layers, the handwritten caption. */
function buildFrame(entry, index, stickerKey) {
  const photo = PHOTOS[entry.id];
  const alt = entry.image ?? '';
  const img = h('img', { class: 'fr-img', alt, width: photo.width, height: photo.height, decoding: 'async', draggable: false });
  const soft = h('img', { class: 'fr-soft', alt: '', width: photo.width, height: photo.height, decoding: 'async', draggable: false, attrs: DECOR });
  const error = h('span', { class: 'fr-error hand', hidden: true, text: ctx.content.errors?.photo });
  const picture = h('span', { class: 'fr-photo' }, img, soft, h('span', { class: 'fr-wash', attrs: DECOR }), error);
  picture.style.setProperty('--fr-ratio', `${photo.width} / ${photo.height}`);

  const hold =
    index === 1
      ? ['tl', 'tr', 'bl', 'br'].map((corner) => h('span', { class: `fr-corner fr-corner--${corner}`, attrs: DECOR }))
      : [h('span', { class: 'fr-tape', attrs: DECOR })];
  const sticker = stickerKey ? h('span', { class: 'sticker-slot fr-sticker', attrs: DECOR }, ctx.stickers.el(stickerKey)) : null;
  const print = h('button', { type: 'button', class: 'paper fr-print' }, picture, h('span', { class: 'fr-caption hand' }, caption(entry.caption)), hold, sticker);
  const item = h('div', { class: `fr-item fr-item--${entry.id} ${index < 2 ? 'fr-item--large' : 'fr-item--small'}` }, print);

  const frame = { id: entry.id, entry, photo, alt, item, print, picture, img, soft, error, status: 'idle', tries: 0, seen: false };
  img.addEventListener('load', () => onLoad(frame));
  img.addEventListener('error', () => onError(frame));
  soft.addEventListener('error', () => soft.remove(), { once: true }); // only a stand-in: the picture develops without it
  print.addEventListener('click', () => {
    ctx.audio.unlock();
    openView(frame);
  });
  return frame;
}

/** The large view: a dark sheet over the page, the print, its caption and the close button. */
function buildView(text) {
  const img = h('img', { class: 'fr-view__img', alt: '', decoding: 'async', draggable: false });
  const error = h('span', { class: 'fr-error hand', hidden: true, text: ctx.content.errors?.photo });
  const picture = h('span', { class: 'fr-view__photo' }, img, error);
  const print = h('div', { class: 'fr-view__print' }, picture);
  const caption = h('figcaption', { class: 'fr-view__caption hand' });
  const figure = h('figure', { class: 'fr-view__figure' }, print, caption);
  const cross = svg(
    'svg',
    { viewBox: '0 0 24 24', class: 'fr-view__cross', focusable: 'false', ...DECOR },
    svg('path', { d: 'M6 6l12 12M18 6L6 18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' }),
  );
  const close = h('button', { type: 'button', class: 'fr-view__close', attrs: { 'aria-label': text.close ?? '' } }, cross);
  const view = h('div', { class: 'fr-view', hidden: true, attrs: { role: 'dialog', 'aria-modal': 'true' } }, h('div', { class: 'fr-view__shade', attrs: DECOR }), figure, close);

  img.addEventListener('error', () => {
    img.hidden = true;
    img.removeAttribute('src');
    error.hidden = false;
  });
  return { view, viewImg: img, viewError: error, viewPrint: print, viewCaption: caption, close };
}

// ───────────── loading and developing ─────────────

/** Asks for the photo of a frame (the first time the chapter opens, and again if an earlier try failed). */
function load(frame) {
  if (frame.status === 'loading' || frame.status === 'loaded') return;
  frame.status = 'loading';
  frame.item.classList.remove('is-failed');
  frame.error.hidden = true;
  frame.img.hidden = false;
  frame.img.removeAttribute('src');
  frame.img.src = frame.photo.src;
  if (frame.soft.isConnected && !frame.soft.getAttribute('src')) frame.soft.src = frame.photo.tiny;
}

function onLoad(frame) {
  if (frame.status !== 'loading') return;
  frame.status = 'loaded';
  develop(frame);
}

function onError(frame) {
  if (frame.status !== 'loading') return;
  if (frame.tries < 1) {
    frame.tries += 1;
    frame.status = 'waiting';
    bag.timeout(() => load(frame), RETRY_MS);
    return;
  }
  // The line from content.json takes the place of the picture; the page and the story go on.
  frame.status = 'failed';
  frame.img.hidden = true;
  frame.img.removeAttribute('src');
  frame.error.hidden = false;
  frame.item.classList.add('is-failed');
}

/** A picture develops once it is there and the frame is in view. */
function develop(frame) {
  if (frame.status === 'loaded' && frame.seen) frame.item.classList.add('is-developed');
}

function showButton() {
  if (ui.button.hidden) {
    ui.button.hidden = false;
    void ui.cta.offsetWidth; // so the fade starts from zero
  }
  ui.cta.classList.add('is-on');
}

/** Watches which frames are on screen: a frame slides in early and develops when half of it is seen (or passed). */
function watch() {
  const second = ui.frames[1] ?? ui.frames.at(-1);
  const sawSecond = () => bag.timeout(showButton, BUTTON_AFTER_SEEN_MS);
  const see = (frame) => {
    if (frame.seen) return;
    frame.seen = true;
    develop(frame);
    if (frame === second) sawSecond();
  };

  if (typeof IntersectionObserver !== 'function') {
    for (const frame of ui.frames) {
      frame.item.classList.add('is-risen');
      see(frame);
    }
    return;
  }
  const byItem = new Map(ui.frames.map((frame) => [frame.item, frame]));
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const frame = byItem.get(entry.target);
        if (!frame) continue;
        // A frame whose upper edge is above the page's upper edge has been scrolled past, however fast she
        // went: it counts as seen, so that no picture is ever left undeveloped behind her.
        if (entry.rootBounds && entry.boundingClientRect.top < entry.rootBounds.top) {
          frame.item.classList.add('is-risen');
          see(frame);
        }
        if (!entry.isIntersecting) continue;
        // a frame taller than the screen can never be "half in view": measure against the smaller of the two
        const full = Math.min(entry.boundingClientRect.height, entry.rootBounds?.height ?? Infinity) || 1;
        const share = entry.intersectionRect.height / full;
        if (share >= RISE_SHARE) frame.item.classList.add('is-risen');
        if (share >= DEVELOP_SHARE) see(frame);
      }
    },
    { root: ui.root, threshold: SHARES },
  );
  for (const frame of ui.frames) observer.observe(frame.item);
  bag.add(() => observer.disconnect());
}

/** Back to the untouched page: prints waiting below, pictures not developed, no button. */
function reset() {
  ui.root.classList.add('fr-instant');
  for (const frame of ui.frames) {
    frame.seen = false;
    frame.item.classList.remove('is-risen', 'is-developed');
  }
  ui.cta.classList.remove('is-on');
  ui.button.hidden = true;
  void ui.root.offsetWidth;
  ui.root.classList.remove('fr-instant');
}

// ───────────── the large view ─────────────

function openView(frame) {
  if (state.viewing || frame.status === 'failed') return;
  viewBag.dispose();
  state.viewing = frame;

  const { photo } = frame;
  ui.viewError.hidden = true;
  ui.viewImg.hidden = false;
  ui.viewImg.width = photo.width;
  ui.viewImg.height = photo.height;
  ui.viewImg.alt = frame.alt;
  if (ui.viewImg.getAttribute('src') !== photo.src) ui.viewImg.src = photo.src;
  ui.viewPrint.style.setProperty('--fr-ratio', `${photo.width} / ${photo.height}`);
  ui.viewPrint.style.setProperty('--fr-ratio-n', (photo.width / photo.height).toFixed(4));
  ui.viewPrint.style.setProperty('--fr-natural', `${Math.round(photo.width / 2)}px`); // never blown up beyond what the file holds
  ui.viewCaption.replaceChildren(caption(frame.entry.caption));
  ui.view.setAttribute('aria-label', frame.alt);

  ui.view.hidden = false;
  void ui.view.offsetWidth;
  ui.view.classList.add('is-open');
  ui.root.classList.add('is-viewing');
  ui.col.inert = true;
  try {
    ui.close.focus({ preventScroll: true });
  } catch {
    // focus is a nicety
  }
  ctx.sfx.play('tap');
  ctx.haptics.tap();

  // the Back gesture closes the view and the chapter stays
  state.release = ctx.flow.openOverlay(() => closeView({ viaBack: true }));
}

function closeView({ viaBack = false, instant = false } = {}) {
  const frame = state.viewing;
  if (!frame) return;
  const { release } = state;
  state.viewing = null;
  state.release = null;
  viewBag.dispose();
  ui.view.classList.remove('is-open');
  ui.root.classList.remove('is-viewing');
  ui.col.inert = false;
  if (instant || ctx.reducedMotion) ui.view.hidden = true;
  else {
    viewBag.timeout(() => {
      ui.view.hidden = true;
    }, VIEW_OUT_MS);
  }
  if (!instant) {
    try {
      frame.print.focus({ preventScroll: true });
    } catch {
      // focus is a nicety
    }
  }
  if (!viaBack) release?.(); // she closed it herself: the flow takes back the history step of the view
}

function onKey(event) {
  if (!state.viewing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeView();
  } else if (event.key === 'Tab') {
    event.preventDefault(); // the close button is the only control of the view
    ui.close.focus();
  }
}

// ───────────── the module ─────────────

export default {
  id: ID,

  mount(root, context) {
    ctx = context;
    const text = ctx.content.frames ?? {};
    const { col, body, actions } = buildScreen(root);
    col.classList.add('frames');

    const keys = ctx.stickers.forChapter(ID);
    const entries = (Array.isArray(text.frames) ? text.frames : []).filter((entry) => entry && PHOTOS[entry.id]);
    // the first two stickers sit on the top edge of the two large prints; the third waits beside the small ones
    const frames = entries.map((entry, index) => buildFrame(entry, index, index < 2 ? keys[index] : null));
    const large = frames.slice(0, 2);
    const small = frames.slice(2);

    const head = h('div', { class: 'fr-head' }, h('h2', { class: 'title reveal' }, rich(text.title)), h('p', { class: 'lead reveal d1' }, rich(text.under)));
    const pair =
      small.length > 0
        ? h(
            'div',
            { class: 'fr-pair' },
            h('div', { class: 'fr-side' }, small[0].item, h('div', { class: 'sticker-slot fr-friends', attrs: DECOR }, keys[2] ? ctx.stickers.el(keys[2]) : null)),
            small.slice(1).map((frame) => frame.item),
          )
        : null;
    body.append(head, ...large.map((frame) => frame.item));
    if (pair) body.append(pair);

    // hidden (not only see-through) until she has seen the second frame, so nothing can press it early
    const button = h('button', { type: 'button', class: 'btn', hidden: true, dataset: { qc: 'primary' }, text: text.button });
    const cta = h('div', { class: 'fr-cta' }, button);
    button.addEventListener('click', () => {
      if (state.viewing) return;
      ctx.sfx.play('tap');
      ctx.haptics.tap();
      ctx.flow.next();
    });
    actions.append(cta);

    const viewer = buildView(text);
    root.append(viewer.view);
    ui = { root, col, frames, button, cta, ...viewer };
  },

  enter(context) {
    if (!ui) return;
    ctx = context;
    bag.dispose();
    viewBag.dispose();
    state.viewing = null;
    state.release = null;
    ui.view.hidden = true;
    ui.view.classList.remove('is-open');
    ui.root.classList.remove('is-viewing');
    ui.col.inert = false;
    reset();

    ctx.audio.playMusic('story', { fadeMs: 1500 });
    for (const frame of ui.frames) {
      if (frame.status !== 'loaded') frame.tries = 0;
      if (frame.status === 'waiting' || frame.status === 'failed') frame.status = 'idle';
      load(frame);
    }

    bag.on(document, 'keydown', onKey);
    bag.on(ui.view, 'click', (event) => {
      // the close button, the dark sheet, the caption: everything but the print itself closes the view
      if (event.target instanceof Node && ui.viewPrint.contains(event.target)) return;
      ctx.sfx.play('tap');
      closeView();
    });
    bag.on(ui.view, 'wheel', (event) => event.preventDefault(), { passive: false });
    bag.timeout(showButton, BUTTON_AFTER_MS);
    watch();
    // the second print stands ready under the first: on a short screen its edge or its sticker is then the
    // only sign that the page goes on
    ui.frames[1]?.item.classList.add('is-risen');
  },

  exit() {
    if (ui && state.viewing) closeView({ viaBack: true, instant: true });
    state.viewing = null;
    state.release = null;
    viewBag.dispose();
    bag.dispose();
    if (ui) {
      ui.view.hidden = true;
      ui.col.inert = false;
    }
  },

  complete() {
    if (!ui) return;
    if (state.viewing) closeView({ instant: true });
    ui.root.classList.add('fr-instant'); // everything at once, nothing moves
    for (const frame of ui.frames) {
      frame.seen = true;
      frame.item.classList.add('is-risen');
      develop(frame);
    }
    showButton();
  },
};
