// The fixed facts of the site. The unlock moment is written here and nowhere else.

/** 28 November 2026, 00:00 India time, as an absolute instant. */
export const TARGET_UTC = '2026-11-27T18:30:00Z';
export const TARGET_MS = Date.parse(TARGET_UTC);

/** 12 April 2022, 00:00 India time: the day she said yes. */
export const SINCE_YES_UTC = '2022-04-11T18:30:00Z';
export const SINCE_YES_MS = Date.parse(SINCE_YES_UTC);

/** The birthday phase lasts 24 hours after the unlock; after that the site is a keepsake. */
export const BIRTHDAY_LENGTH_MS = 24 * 60 * 60 * 1000;

/**
 * Giving the coupons back. A redeemed coupon keeps its REDEEMED stamp on her phone for good; this is the way
 * to take the stamps off again — for example when one was redeemed by mistake. Write a new word here (the date
 * is the simplest one), and the next time the page opens on a phone every stamp is forgotten, once. A phone
 * that has already forgotten them for this word does nothing. Nothing else she has done is touched.
 */
export const COUPONS_FRESH_AGAIN = '2026-11-28';

/** Chapters in the order she sees them. */
export const CHAPTERS = Object.freeze(['lamp', 'frames', 'question', 'reasons', 'letter', 'cake', 'gifts', 'finale']);

/** The two screens that are not chapters, and the menu after the finale. */
export const SCREEN_COUNTDOWN = 'countdown';
export const SCREEN_START = 'start';
export const SCREEN_MENU = 'menu';

/**
 * Music table: track id → file inside the site. An empty entry means "this track is not delivered yet";
 * asking for it does nothing. Fill in the path when the file is added (each file 6 MB or smaller).
 */
export const MUSIC = Object.freeze({
  waiting: 'assets/audio/music/waiting.mp3',
  celebration: 'assets/audio/music/celebration.mp3',
  story: 'assets/audio/music/story.mp3',
  letter: 'assets/audio/music/letter.mp3',
  finale: 'assets/audio/music/finale.mp3',
});

/** Which sticker groups (the "chapter" field of stickers.json) belong to which screen or chapter. */
export const STICKER_GROUPS = Object.freeze({
  countdown: ['waiting-room'],
  start: ['midnight'],
  question: ['question-no', 'question-yes', 'scratch-prize'],
});
