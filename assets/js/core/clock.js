// The one clock of the site. Everything asks now() for the time.
// It starts from the phone clock and corrects it with the time of our own web server.
// The clock is "trusted" only when the server has answered in this visit and the phone clock has not
// jumped since that answer (a date changed by hand, a long sleep). The gift never opens on a clock that
// is not trusted: the phase module waits, and this module keeps asking the server until it answers.
import { TARGET_MS } from '../config.js';

const TIME_FILE = './time.txt';
const SAMPLE_TIMEOUT_MS = 4000;
const MAX_SAMPLES = 3;
const GOOD_ROUND_TRIP_MS = 150;
const COARSE_TOLERANCE_MS = 2000; // the Date header only has whole seconds
const RESYNC_EVERY_MS = 5 * 60 * 1000;
const RESYNC_BEFORE_TARGET_MS = 20 * 1000;
const RETRY_MS = 3000; // while the clock is not trusted
const JUMP_MS = 2000;
const FIRST_ANSWER_WAIT_MS = 8500; // one HEAD and one GET may each take 4 seconds
const MAX_TIMER_MS = 2 ** 31 - 1;

let offsetMs = 0;
let synced = false; // the server has answered at least once
let suspect = false; // the phone clock jumped and the server has not answered since
let jumps = 0;
let running = null; // the sync that is under way
let lastAttemptAt = -Infinity; // performance.now() of the last finished attempt
let lastAnswerAt = -Infinity; // performance.now() of the last answer that was used
let sampleCount = 0;
let started = false;
let tickTimer = 0;
let targetTimer = 0;
let retryTimer = 0;
let lastDate = 0;
let lastPerf = 0;
const tickListeners = new Set();

let resolveFirst;
/** Resolves when the first question to the server has been answered or has failed. */
const firstAttempt = new Promise((resolve) => {
  resolveFirst = resolve;
});

/** The true time in milliseconds since 1970. */
export function now() {
  return Date.now() + offsetMs;
}

/** True once the server has answered at least one time question. */
export const isSynced = () => synced;

/** True while now() rests on an answer of the server and the phone clock has not jumped since. */
export const isTrusted = () => synced && !suspect;

/** True if a sync attempt (successful or not) finished within the last `ms` milliseconds. */
export const isFresh = (ms) => performance.now() - lastAttemptAt < ms;

/** True if the server itself answered within the last `ms` milliseconds. */
export const answeredWithin = (ms) => performance.now() - lastAnswerAt < ms;

/** "S1795804200.123456,VS0,VE1" → milliseconds, or NaN. */
function parseTimer(value) {
  const match = /S(\d+(?:\.\d+)?)/.exec(value ?? '');
  return match ? Number(match[1]) * 1000 : NaN;
}

/** Did the phone clock jump while the page was open (date changed by hand, or a long sleep)? */
function checkForJump() {
  const dateNow = Date.now();
  const perfNow = performance.now();
  const jumped = lastDate !== 0 && Math.abs(dateNow - lastDate - (perfNow - lastPerf)) > JUMP_MS;
  lastDate = dateNow;
  lastPerf = perfNow;
  if (jumped) {
    jumps += 1;
    suspect = true; // only a new answer of the server clears this
  }
  return jumped;
}

/** Asks the server once. → { roundTrip, diff, precise, jumps } or null. */
async function ask(method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAMPLE_TIMEOUT_MS);
  try {
    sampleCount += 1;
    checkForJump(); // a jump before the question is covered by its answer
    const jumpsBefore = jumps;
    const sentPerf = performance.now();
    const response = await fetch(`${TIME_FILE}?s=${Date.now().toString(36)}-${sampleCount}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
    });
    const roundTrip = Math.max(0, performance.now() - sentPerf);
    checkForJump();
    if (jumps !== jumpsBefore) return null; // the phone clock moved while we were asking: worthless
    const deviceAtServer = Date.now() - roundTrip / 2;
    const fine = parseTimer(response.headers.get('x-timer'));
    const coarse = Date.parse(response.headers.get('date') ?? '');
    const fineUsable = Number.isFinite(fine) && (!Number.isFinite(coarse) || Math.abs(fine - coarse) < COARSE_TOLERANCE_MS);
    if (fineUsable) return { roundTrip, diff: fine - deviceAtServer, precise: true, jumps };
    if (Number.isFinite(coarse)) return { roundTrip, diff: coarse + 500 - deviceAtServer, precise: false, jumps };
    return null;
  } catch {
    return null; // offline, blocked or too slow
  } finally {
    clearTimeout(timer);
  }
}

/** One question: a HEAD request, and a plain GET of the same file if that fails. */
async function sample() {
  return (await ask('HEAD')) ?? (await ask('GET'));
}

function apply(best) {
  // A whole-second answer cannot improve a clock that is already within two seconds.
  offsetMs = best.precise || Math.abs(best.diff) >= COARSE_TOLERANCE_MS ? best.diff : 0;
  synced = true;
  suspect = false;
  lastAnswerAt = performance.now();
}

/**
 * Corrects the clock with up to three answers of the server (the fastest answer wins).
 * Resolves with true if the server answered. While the clock is not trusted it asks again every 3 seconds.
 */
export function sync() {
  if (running) return running;
  clearTimeout(retryTimer);
  running = (async () => {
    let best = null;
    for (let i = 0; i < MAX_SAMPLES; i++) {
      const answer = await sample();
      // an answer from before a jump of the phone clock is never kept
      if (answer && (!best || answer.jumps !== best.jumps || answer.roundTrip < best.roundTrip)) {
        best = answer;
        apply(best);
      }
      if (i === 0) resolveFirst();
      if (!answer || best.roundTrip <= GOOD_ROUND_TRIP_MS) break;
    }
    lastAttemptAt = performance.now();
    armTargetSync();
    if (!isTrusted()) retryTimer = setTimeout(sync, RETRY_MS);
    if (started) tick();
    return best !== null;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** One more look at the server clock 20 seconds before the unlock. */
function armTargetSync() {
  clearTimeout(targetTimer);
  const wait = TARGET_MS - RESYNC_BEFORE_TARGET_MS - now();
  if (wait > 0) targetTimer = setTimeout(sync, Math.min(wait, MAX_TIMER_MS));
}

function tick() {
  clearTimeout(tickTimer);
  if (checkForJump()) sync();
  const time = now();
  for (const listener of [...tickListeners]) {
    try {
      listener(time);
    } catch {
      // one broken listener must not stop the clock
    }
  }
  tickTimer = setTimeout(tick, 1000 - (now() % 1000) + 4);
}

/** Calls back on every second boundary with the true time. Returns a function that stops it. */
export function onTick(callback) {
  tickListeners.add(callback);
  return () => tickListeners.delete(callback);
}

/**
 * Starts the clock: first sync, the second ticker and the re-sync triggers. Call once.
 * Resolves when the server has answered the first question, or when that question has failed
 * (about 8 seconds at most). Check isTrusted() afterwards.
 */
export function start() {
  if (started) return firstAttempt;
  started = true;
  lastDate = Date.now();
  lastPerf = performance.now();
  setTimeout(resolveFirst, FIRST_ANSWER_WAIT_MS);
  sync();
  tick();
  setInterval(sync, RESYNC_EVERY_MS);
  const wake = () => {
    if (document.visibilityState === 'hidden') return;
    tick();
    sync();
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pageshow', wake);
  window.addEventListener('online', wake);
  return firstAttempt;
}
