// Dudu-Bubu stickers. They are decoration: shown straight from Tenor, never needed for layout or flow.
// A sticker that cannot load removes itself without a trace.
import { STICKER_GROUPS } from '../config.js';

const LIST = 'assets/data/stickers.json';

let byKey = new Map();
let all = [];
const warmed = new Map(); // key → Image kept alive so the browser cache stays warm

const groupsOf = (id) => STICKER_GROUPS[id] ?? [id];

const SIDES = ['top', 'right', 'bottom', 'left'];
const FADE_BOTTOM = 'linear-gradient(#000 76%, transparent 98%)';

/**
 * Optional trims of stickers.json. The picture box keeps its size, so the layout never changes.
 * crop: { top, right, bottom, left } — shares (0 to 0.5) of the square box to hide, for a caption drawn into the picture.
 *       A crop on the left or right also moves the picture so that what is left stays in the middle.
 * fade: 'bottom' — a picture whose body is cut off straight at the lower edge melts into the night instead.
 */
function trim(img, { crop, fade }) {
  if (crop && typeof crop === 'object') {
    const share = Object.fromEntries(SIDES.map((side) => [side, Math.min(0.5, Math.max(0, Number(crop[side]) || 0))]));
    img.style.clipPath = `inset(${SIDES.map((side) => `${+(share[side] * 100).toFixed(2)}%`).join(' ')})`;
    if (share.left !== share.right) img.style.translate = `${+((share.right - share.left) * 50).toFixed(2)}% 0`;
  }
  if (fade === 'bottom') {
    img.style.setProperty('-webkit-mask-image', FADE_BOTTOM);
    img.style.setProperty('mask-image', FADE_BOTTOM);
  }
}

export const stickers = {
  /** Reads the sticker list. A failure only means: no stickers. */
  async load() {
    try {
      const response = await fetch(LIST);
      if (!response.ok) return;
      const data = await response.json();
      all = (Array.isArray(data.stickers) ? data.stickers : []).filter(
        (sticker) => sticker && typeof sticker.key === 'string' && typeof sticker.media === 'string' && sticker.media.startsWith('https:'),
      );
      byKey = new Map(all.map((sticker) => [sticker.key, sticker]));
    } catch {
      all = [];
      byKey = new Map();
    }
  },

  has: (key) => byKey.has(key),

  /** Keys of the stickers of a screen or chapter (for example 'question' → the "No", "Yes" and prize stickers). */
  forChapter(id) {
    const groups = groupsOf(id);
    return all.filter((sticker) => groups.includes(sticker.chapter)).map((sticker) => sticker.key);
  },

  /** Keys of one sticker group exactly as named in stickers.json (for example 'question-no'). */
  forGroup(group) {
    return all.filter((sticker) => sticker.chapter === group).map((sticker) => sticker.key);
  },

  /**
   * An <img class="sticker"> for a key, or null if the key is unknown.
   * size: CSS length (number = px). The picture fades in when loaded and removes itself if it fails.
   * A "crop" or "fade" of stickers.json is applied here (see trim above).
   */
  el(key, { size } = {}) {
    const sticker = byKey.get(key);
    if (!sticker) return null;
    const img = document.createElement('img');
    img.className = 'sticker';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.decoding = 'async';
    img.draggable = false;
    img.referrerPolicy = 'no-referrer';
    if (size != null) img.style.setProperty('--sticker-size', typeof size === 'number' ? `${size}px` : String(size));
    trim(img, sticker);
    img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = sticker.media;
    return img;
  },

  /** Warms the cache for the stickers of these screens or chapters. Never throws, never waits. */
  preload(ids) {
    for (const id of [].concat(ids ?? [])) {
      for (const key of stickers.forChapter(id)) {
        if (warmed.has(key)) continue;
        try {
          const img = new Image();
          img.decoding = 'async';
          img.referrerPolicy = 'no-referrer';
          img.src = byKey.get(key).media;
          warmed.set(key, img);
        } catch {
          // decoration only
        }
      }
    }
  },
};
