// A living flame made of three soft SVG layers. No canvas and no loop in JS: the motion is CSS
// (transform and opacity only), so it costs almost nothing and stops by itself when hidden.
// Used by the lamp chapter; made for the cake too (the one flame that never goes out).
//
//   import { create } from '../fx/flame.js';
//   const flame = create({ size: '5rem', lit: false, reducedMotion: ctx.reducedMotion });
//   wickTip.append(flame);          // the box is size x 0.56 wide and size tall; its bottom centre is the wick tip
//   flame.light();                  // catches with a small leap          flame.light({ instant: true })
//   flame.extinguish();             // shrinks away                       flame.extinguish({ instant: true })
//   flame.pause();  flame.resume(); // freeze and continue the flicker (tab hidden, screen left)
//   flame.isLit()                   // true or false
//
// Options: size (CSS length or a number of px, the height), lit (start burning), halo (the soft
// round light around it, default true), reducedMotion (no flicker and no sway, plain fades).
// The styles are the ".flame" block in assets/css/shared.css.

const SVG_NS = 'http://www.w3.org/2000/svg';
// One teardrop, pointed at the top, drawn in a 60 x 100 box.
const TEARDROP = 'M30 1 C33 21 55 41 55 67 C55 86 44 99 30 99 C16 99 5 86 5 67 C5 41 27 21 30 1 Z';

let serial = 0;

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}

function span(className, ...children) {
  const el = document.createElement('span');
  el.className = className;
  el.append(...children);
  return el;
}

/** One layer: the teardrop filled with a top-to-bottom gradient whose colours come from the CSS. */
function layer(kind, stops, id) {
  const gradientId = `flame-${id}-${kind}`;
  const svg = svgEl('svg', { class: `flame__layer flame__layer--${kind}`, viewBox: '0 0 60 100', preserveAspectRatio: 'none', focusable: 'false' });
  const gradient = svgEl('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' });
  stops.forEach((offset, index) => gradient.append(svgEl('stop', { offset: String(offset), class: `flame__stop flame__stop--${kind}-${index + 1}` })));
  const defs = svgEl('defs');
  defs.append(gradient);
  svg.append(defs, svgEl('path', { d: TEARDROP, fill: `url(#${gradientId})` }));
  return svg;
}

/**
 * Builds one flame. → <span class="flame"> with light(), extinguish(), pause(), resume(), isLit().
 */
export function create({ size, lit = false, halo = true, reducedMotion = false } = {}) {
  serial += 1;
  const root = span('flame');
  root.setAttribute('aria-hidden', 'true');
  if (size != null) root.style.setProperty('--flame-size', typeof size === 'number' ? `${size}px` : String(size));
  if (reducedMotion) root.classList.add('flame--calm');

  const body = span(
    'flame__catch',
    span('flame__sway', layer('outer', [0, 0.3, 0.72, 1], serial), layer('mid', [0, 0.55, 1], serial), layer('core', [0, 1], serial)),
  );
  if (halo) root.append(span('flame__halo'));
  root.append(body);

  let burning = false;

  // An instant change keeps the class flame--still, which switches the entrance and the fade off.
  const set = (on, instant) => {
    burning = on;
    root.classList.toggle('flame--still', instant);
    root.classList.toggle('is-lit', on);
  };

  root.light = ({ instant = false } = {}) => set(true, instant);
  root.extinguish = ({ instant = false } = {}) => set(false, instant);
  root.pause = () => root.classList.add('is-paused');
  root.resume = () => root.classList.remove('is-paused');
  root.isLit = () => burning;

  if (lit) set(true, true);
  return root;
}

export default { create };
