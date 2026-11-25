// Small DOM helpers shared by every screen and chapter.

/** h('p', { class: 'lead', text: 'Hi' }, child, …) → element. Keys: class, text, dataset, style, attrs, on<Event>, or any property. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') Object.assign(el.style, value);
    else if (key === 'attrs') for (const [name, v] of Object.entries(value)) el.setAttribute(name, v);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child);
  }
  return el;
}

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Replaces {name} holes: fill('{count} baar', { count: 3 }). Unknown holes stay as they are. */
export function fill(text, values = {}) {
  return String(text ?? '').replace(/\{([^{}]+)\}/g, (hole, name) => (Object.hasOwn(values, name) ? String(values[name]) : hole));
}

/**
 * Turns the light marks of content.json into safe DOM nodes: **bold**, *soft* and line breaks.
 * rich('**Vartika** — yaani…') → DocumentFragment (never uses innerHTML).
 */
export function rich(text) {
  const fragment = document.createDocumentFragment();
  String(text ?? '')
    .split('\n')
    .forEach((line, index) => {
      if (index > 0) fragment.append(document.createElement('br'));
      for (const part of line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
        if (!part) continue;
        if (part.startsWith('**')) fragment.append(h('strong', { text: part.slice(2, -2) }));
        else if (part.startsWith('*')) fragment.append(h('em', { text: part.slice(1, -1) }));
        else fragment.append(part);
      }
    });
  return fragment;
}

export const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** Splits a number of milliseconds into whole days, hours, minutes and seconds. */
export function splitDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { days: Math.floor(total / 86400), hours: Math.floor(total / 3600) % 24, minutes: Math.floor(total / 60) % 60, seconds: total % 60, total };
}

const ROUGH_STEPS = [
  ['seconds', 1000, 60],
  ['minutes', 60 * 1000, 60],
  ['hours', 60 * 60 * 1000, 24],
  ['days', 24 * 60 * 60 * 1000, Infinity],
];

/**
 * "3 hours", "1 minute" … from the unit words in content.common.units. Rounds to the nearest whole unit
 * and never says less than 1: 400 ms → "1 second", 89 s → "1 minute", 91 s → "2 minutes", 59.6 min → "1 hour".
 */
export function roughDuration(ms, units) {
  const length = Math.max(0, Number(ms) || 0);
  let name = 'days';
  let count = 1;
  for (const [unit, size, limit] of ROUGH_STEPS) {
    name = unit;
    count = Math.max(1, Math.round(length / size));
    if (count < limit) break;
  }
  const words = units?.[name] ?? [];
  return `${count} ${count === 1 ? (words[0] ?? '') : (words[1] ?? words[0] ?? '')}`.trim();
}

/**
 * A bag for everything a screen starts, so exit() can stop all of it with one call:
 *   const bag = scope();
 *   bag.on(button, 'click', fn);  bag.timeout(fn, 800);  bag.interval(fn, 1000);  bag.raf(fn);  bag.add(stopFn);
 *   bag.dispose();   // removes listeners, clears timers, stops loops; the bag can be used again afterwards
 */
export function scope() {
  let stops = new Set();
  const add = (stop) => {
    stops.add(stop);
    return () => {
      stops.delete(stop);
      stop();
    };
  };
  return {
    add,
    on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      return add(() => target.removeEventListener(type, handler, options));
    },
    timeout(fn, ms) {
      const id = setTimeout(() => {
        stops.delete(stop);
        fn();
      }, ms);
      const stop = () => clearTimeout(id);
      return add(stop);
    },
    interval(fn, ms) {
      const id = setInterval(fn, ms);
      return add(() => clearInterval(id));
    },
    /** Calls fn(time, delta) on every frame until stopped. Pauses by itself while the tab is hidden. */
    raf(fn) {
      let id = 0;
      let last = 0;
      const loop = (time) => {
        const delta = last ? Math.min(64, time - last) : 16;
        last = time;
        id = requestAnimationFrame(loop);
        fn(time, delta);
      };
      id = requestAnimationFrame(loop);
      return add(() => cancelAnimationFrame(id));
    },
    dispose() {
      const all = [...stops];
      stops = new Set();
      for (const stop of all) {
        try {
          stop();
        } catch {
          // keep stopping the rest
        }
      }
    },
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** svg('circle', { cx: 10, cy: 10, r: 4 }, child, …) → SVG element. Children are elements or text; null is skipped. */
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs ?? {})) el.setAttribute(name, value);
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child);
  }
  return el;
}

/** el.animate(…) that never throws (old browsers, detached elements). → Animation or null. */
export function soft(el, frames, options) {
  try {
    return el.animate?.(frames, options) ?? null;
  } catch {
    return null;
  }
}

/** Has she touched the page yet? Vibration that is not the direct answer to a tap is only tried after that. */
export const touched = () => navigator.userActivation?.hasBeenActive !== false;

/** Resolves on the next painted frame. */
export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Opens WhatsApp with a ready message. No phone number: she picks the chat herself. Call inside a tap.
 * The address is api.whatsapp.com/send and not the short wa.me one, whose redirect loses every emoji of the message.
 */
export function openWhatsApp(message) {
  const link = h('a', { href: `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`, target: '_blank', rel: 'noopener noreferrer', hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
}

/** Gold buttons answer the finger: a ripple from the touch point. Installed once for the whole page. */
export function initButtons(reducedMotion) {
  if (reducedMotion) return;
  document.addEventListener(
    'pointerdown',
    (event) => {
      const button = event.target instanceof Element ? event.target.closest('.btn') : null;
      if (!button || button.disabled) return;
      const box = button.getBoundingClientRect();
      const size = Math.max(box.width, box.height) * 2.2;
      const ripple = document.createElement('span');
      ripple.className = 'btn__ripple';
      ripple.setAttribute('aria-hidden', 'true');
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - box.left - size / 2}px`;
      ripple.style.top = `${event.clientY - box.top - size / 2}px`;
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
      button.append(ripple);
      setTimeout(() => ripple.remove(), 1200);
    },
    { passive: true },
  );
}

/**
 * The standard layout of a screen: a body (picture and words) and an actions row (the main button).
 * buildScreen(root) → { col, body, actions }   — root is emptied first.
 */
export function buildScreen(root) {
  const body = h('div', { class: 'screen__body' });
  const actions = h('div', { class: 'screen__actions' });
  const col = h('div', { class: 'screen__col' }, body, actions);
  root.replaceChildren(col);
  return { col, body, actions };
}

/**
 * A tidy stand-in for a chapter that is not built yet: sticker, eyebrow, title, lead and the main button.
 * buildStub(root, { eyebrow, title, lead, sticker, button }) → { body, actions, button }
 * `sticker` is an element or null; `button` is the label of the main button.
 */
export function buildStub(root, { eyebrow, title, lead, sticker, button } = {}) {
  const { col, body, actions } = buildScreen(root);
  if (sticker) body.append(h('div', { class: 'sticker-slot reveal', attrs: { 'aria-hidden': 'true' } }, sticker));
  if (eyebrow) body.append(h('p', { class: 'eyebrow reveal d1', text: eyebrow }));
  if (title) body.append(h('h2', { class: 'title reveal d2' }, rich(title)));
  if (lead) body.append(h('p', { class: 'lead reveal d3' }, rich(lead)));
  let main = null;
  if (button) {
    main = h('button', { type: 'button', class: 'btn reveal d4', dataset: { qc: 'primary' }, text: button });
    actions.append(main);
  }
  return { col, body, actions, button: main };
}
