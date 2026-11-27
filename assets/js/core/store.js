// Remembers her progress on this phone. Storage can be blocked (private mode): then it lives in memory only.
// Nothing saved here can open the gift early; the lock only listens to the clock.
// The link can be open twice (the browser inside WhatsApp and Chrome): every save first takes in what the
// other tab has saved, so finished chapters, peeks and redeemed coupons of both are kept.
import { CHAPTERS, COUPONS_FRESH_AGAIN, SCREEN_MENU } from '../config.js';

const SAVE_NAME = 'vartika-birthday-v1';

// muted: null = she has not touched the sound button yet; true / false = her last choice
// coupons: the word from COUPONS_FRESH_AGAIN that this phone has already acted on
const blank = () => ({ place: null, finished: [], peeks: 0, reveal: false, hand: false, muted: null, coupons: null, chapters: {} });

let data = blank();

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** What is saved on the phone right now, cleaned of anything unexpected. → data object or null. */
function readSaved() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SAVE_NAME) ?? 'null');
    if (!isRecord(saved)) return null;
    const clean = blank();
    if (typeof saved.place === 'string' && (CHAPTERS.includes(saved.place) || saved.place === SCREEN_MENU)) clean.place = saved.place;
    if (Array.isArray(saved.finished)) clean.finished = CHAPTERS.filter((id) => saved.finished.includes(id));
    if (Number.isFinite(saved.peeks) && saved.peeks > 0) clean.peeks = Math.floor(saved.peeks);
    clean.reveal = saved.reveal === true;
    clean.hand = saved.hand === true;
    if (typeof saved.muted === 'boolean') clean.muted = saved.muted;
    if (typeof saved.coupons === 'string') clean.coupons = saved.coupons;
    if (isRecord(saved.chapters)) clean.chapters = saved.chapters;
    return clean;
  } catch {
    return null;
  }
}

/** Takes in what another tab has saved. Nothing is lost: lists are joined, this tab keeps its own place. */
function mergeSaved() {
  const other = readSaved();
  if (!other) return;
  const chapters = { ...other.chapters };
  for (const [id, own] of Object.entries(data.chapters)) {
    chapters[id] = isRecord(own) && isRecord(chapters[id]) ? { ...chapters[id], ...own } : own;
  }
  data = {
    place: data.place ?? other.place,
    finished: CHAPTERS.filter((id) => data.finished.includes(id) || other.finished.includes(id)),
    peeks: Math.max(data.peeks, other.peeks),
    reveal: data.reveal || other.reveal,
    hand: data.hand || other.hand,
    muted: data.muted ?? other.muted, // this tab keeps its own choice
    coupons: data.coupons ?? other.coupons,
    chapters,
  };
}

/**
 * Takes the REDEEMED stamps off once, when `COUPONS_FRESH_AGAIN` in config.js carries a word this phone has
 * not acted on yet. Her place in the story, the finished chapters and everything else stay exactly as they are.
 */
function freshCouponsOnce() {
  if (data.coupons === COUPONS_FRESH_AGAIN) return;
  const gifts = data.chapters.gifts;
  if (isRecord(gifts) && Array.isArray(gifts.redeemed) && gifts.redeemed.length > 0) {
    data.chapters = { ...data.chapters, gifts: { ...gifts, redeemed: [] } };
  }
  data.coupons = COUPONS_FRESH_AGAIN;
  save();
}

function save() {
  mergeSaved();
  try {
    window.localStorage.setItem(SAVE_NAME, JSON.stringify(data));
  } catch {
    // not being able to remember is fine
  }
}

mergeSaved();
freshCouponsOnce();
try {
  // another tab has saved: take it in at once
  window.addEventListener('storage', (event) => {
    if (event.key === SAVE_NAME) mergeSaved();
  });
} catch {
  // no window events: this tab simply keeps its own copy
}

export const store = {
  /** { current, finished } — current is a chapter id, 'menu' or null. */
  progress() {
    return { current: data.place, finished: [...data.finished] };
  },
  setCurrent(id) {
    if (data.place === id) return;
    data.place = id;
    save();
  },
  markFinished(id) {
    if (!CHAPTERS.includes(id) || data.finished.includes(id)) return;
    data.finished = CHAPTERS.filter((chapter) => chapter === id || data.finished.includes(chapter));
    save();
  },
  isFinished: (id) => data.finished.includes(id),
  allFinished: () => CHAPTERS.every((id) => data.finished.includes(id)),

  /** How often she tapped the locked gift before midnight. */
  get peekCount() {
    return data.peeks;
  },
  addPeek() {
    data.peeks += 1;
    save();
    return data.peeks;
  },

  /** True once she has seen the midnight reveal. */
  get revealSeen() {
    return data.reveal;
  },
  set revealSeen(value) {
    data.reveal = value === true;
    save();
  },

  /** True once she tapped "hold my hand" in the waiting room (sound was allowed). */
  get armed() {
    return data.hand;
  },
  set armed(value) {
    data.hand = value === true;
    save();
  },

  /**
   * Her choice on the sound button. It is kept, so that a page the phone had put away (she went to WhatsApp to
   * redeem a coupon) does not come back loud after she had made it silent.
   */
  get muted() {
    return data.muted === true;
  },
  set muted(value) {
    const next = value === true;
    if ((data.muted === true) === next) return; // nothing to remember until she really changes it
    data.muted = next;
    save();
  },

  /** Free data of one chapter, for example which coupons are redeemed. */
  chapterData(id) {
    const saved = data.chapters[id];
    return saved && typeof saved === 'object' ? { ...saved } : {};
  },
  setChapterData(id, patch) {
    data.chapters[id] = { ...this.chapterData(id), ...patch };
    save();
  },
};
