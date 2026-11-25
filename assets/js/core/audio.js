// Background music: one player per track, cross-faded; one mute switch, never an error.
// Phones only allow sound after a tap, so unlock() must be called inside the first tap.
// Every track has its own player and is fetched once: a change of track never cuts off a download that is
// still running, and a track that comes back (the celebration at the cake) is there at once.
// A track that fails to load is tried again (after 1, 3 and 8 seconds and when the network returns);
// a track that the phone paused (a call, another app) starts again when she comes back or taps.
import { MUSIC } from '../config.js';
import { sfx } from './sfx.js';

const MUSIC_VOLUME = 0.6;
const DEFAULT_FADE_MS = 1200;
const RESUME_FADE_MS = 600;
const RETRY_AFTER_MS = [1000, 3000, 8000];
const MAX_FAILURES = RETRY_AFTER_MS.length + 1;
const STALL_AFTER_MS = 8000; // a download that has brought nothing at all by then is asked for again

const players = new Map(); // track id → { id, el, fade, on, retry, stall }; on = this track should be heard
let active = null; // the player that carries the wanted track
let wanted = null; // track id that should be playing
let level = 1; // 0 to 1: how much of its normal volume the music has right now (the menu plays it softly)
let unlocked = false;
let muted = false;
let muteButton = null;
const failures = new Map(); // track id → failed loads in a row
const changeListeners = new Set();

/** The wanted track is not running although it should (paused by the phone, refused, or not loadable). */
function interrupted() {
  return unlocked && Boolean(wanted) && Boolean(MUSIC[wanted]) && document.visibilityState !== 'hidden' && !audio.isPlaying();
}

function notify() {
  const quiet = muted || interrupted();
  if (muteButton) {
    muteButton.hidden = !unlocked;
    muteButton.classList.toggle('is-muted', quiet);
    muteButton.setAttribute('aria-pressed', String(quiet));
  }
  for (const listener of [...changeListeners]) {
    try {
      listener({ unlocked, muted, playing: audio.isPlaying() });
    } catch {
      // ignore
    }
  }
}

/** The volume a sounding track is brought to. */
const loudness = () => MUSIC_VOLUME * level;

/** Moves the volume of one player to `to` over `ms`, then calls `done`. */
function ramp(player, to, ms, done) {
  cancelAnimationFrame(player.fade);
  const from = player.el.volume;
  if (ms <= 0 || document.visibilityState === 'hidden') {
    player.el.volume = to;
    done?.();
    return;
  }
  const startedAt = performance.now();
  const step = (time) => {
    const t = Math.min(1, Math.max(0, (time - startedAt) / ms));
    player.el.volume = Math.min(1, Math.max(0, from + (to - from) * t));
    if (t < 1) player.fade = requestAnimationFrame(step);
    else done?.();
  };
  player.fade = requestAnimationFrame(step);
}

/** Starts (or starts again) the track of a player and brings its volume up. */
function run(player, fadeMs) {
  // Nothing starts behind her back (a timer or a retry while the phone is locked or another app is in front).
  // The player stays wanted: resume() starts it the moment she is back.
  if (document.visibilityState === 'hidden') return;
  player.el.muted = muted;
  watchForStall(player);
  player.el
    .play()
    .then(() => {
      if (player.on) ramp(player, loudness(), fadeMs);
      notify();
    })
    .catch(() => {
      // the browser refused or the file is not there yet: the site stays silent, nothing breaks
      notify();
    });
}

/**
 * A download that neither arrives nor fails (a connection that hangs) would mean silence without an end.
 * If not one usable byte has come after a while, the file is asked for again. A slow download that is
 * alive (the browser knows the track by then) is left alone.
 */
function watchForStall(player) {
  clearTimeout(player.stall);
  player.stall = setTimeout(() => {
    const { el } = player;
    if (!player.on || wanted !== player.id || el.error || el.readyState > 0 || document.visibilityState === 'hidden') return;
    const count = (failures.get(player.id) ?? 0) + 1;
    failures.set(player.id, count);
    if (count < MAX_FAILURES) {
      load(player); // a new request; the one that hangs is dropped
      run(player, DEFAULT_FADE_MS);
    } else {
      player.on = false; // given up for now, like a file that failed to load
    }
    notify();
  }, STALL_AFTER_MS);
}

/** Gives a player its file (again, after a failed load). The browser starts fetching it at once. */
function load(player) {
  clearTimeout(player.retry);
  player.el.src = MUSIC[player.id];
}

/** A file that did not load: try again a little later, a few times. */
function onLoadError(player) {
  const count = (failures.get(player.id) ?? 0) + 1;
  failures.set(player.id, count);
  clearTimeout(player.retry);
  if (count < MAX_FAILURES) {
    player.retry = setTimeout(() => reload(player), RETRY_AFTER_MS[count - 1]);
  } else {
    player.on = false; // given up for now; the network coming back or a tap on the sound button starts over
  }
  notify();
}

function reload(player) {
  if (!player.el.error) return;
  load(player);
  if (player.on && wanted === player.id) run(player, DEFAULT_FADE_MS);
}

function onOnline() {
  failures.clear();
  for (const player of players.values()) reload(player);
  if (interrupted()) begin(wanted, DEFAULT_FADE_MS);
}

/** The player of a track. It is made, and its file asked for, the first time the track is needed. */
function playerFor(id) {
  let player = players.get(id);
  if (player) return player;
  const el = new Audio();
  el.preload = 'auto';
  el.loop = true;
  el.volume = 0;
  player = { id, el, fade: 0, on: false, retry: 0, stall: 0 };
  el.addEventListener('error', () => {
    clearTimeout(player.stall);
    onLoadError(player);
  });
  el.addEventListener('canplay', () => {
    clearTimeout(player.stall);
    failures.delete(id);
  });
  // the players' own word on whether they run: keeps the sound button honest
  el.addEventListener('play', notify);
  el.addEventListener('pause', notify);
  players.set(id, player);
  load(player);
  return player;
}

function silence(player, ms) {
  if (!player.on) return;
  player.on = false;
  clearTimeout(player.stall);
  ramp(player, 0, ms, () => {
    if (!player.on) player.el.pause();
  });
}

function begin(id, fadeMs) {
  if (!MUSIC[id] || (failures.get(id) ?? 0) >= MAX_FAILURES) return;
  const player = playerFor(id);
  for (const other of players.values()) if (other !== player) silence(other, fadeMs);
  active = player;
  if (player.el.error) load(player);
  if (player.on && !player.el.paused && !player.el.error) {
    ramp(player, loudness(), fadeMs);
    return;
  }
  cancelAnimationFrame(player.fade);
  // A track that comes back goes on from where it stopped: what it had already loaded is still there, so it is
  // heard at once and nothing depends on the network of that moment. (Starting it again from its first bar was
  // tried on 25 Nov: the browser has let go of the beginning by then and fetches the whole file a second time,
  // exactly at the cake.) One that had faded out completely fades in from silence; one that is still fading out
  // turns round where it is.
  if (!player.on && player.el.paused) player.el.volume = 0;
  player.on = true;
  run(player, fadeMs);
}

/** Starts the wanted track again if it is not running. → true if there was something to restart. */
function resume() {
  if (!interrupted()) return false;
  begin(wanted, RESUME_FADE_MS);
  return true;
}

function onVisibility() {
  if (players.size === 0) return;
  if (document.visibilityState === 'hidden') {
    for (const player of players.values()) {
      cancelAnimationFrame(player.fade);
      if (!player.el.paused) player.el.pause();
    }
    sfx.suspend();
  } else {
    sfx.resume();
    // whoever paused the wanted track (we while hidden, or the phone for a call): it starts again
    resume();
    notify();
  }
}

/** Her next tap anywhere brings back music that the phone paused. The sound button does it itself. */
function onTap(event) {
  if (muteButton && event.target instanceof Node && muteButton.contains(event.target)) return;
  resume();
}

export const audio = {
  /** Connects the mute button of the top bar. Call once at start-up. */
  init(button) {
    muteButton = button ?? null;
    if (muteButton) {
      muteButton.addEventListener('click', () => {
        // a button that shows "silent" because the music was interrupted brings it back; otherwise it mutes
        if (!muted && interrupted()) {
          failures.delete(wanted);
          resume();
        } else {
          audio.toggleMute();
          // un-muting also brings back a track that the phone had paused in the meantime (a call)
          if (!muted) resume();
        }
      });
    }
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerup', onTap, { passive: true });
    window.addEventListener('online', onOnline);
    notify();
  },

  /** Call inside a tap. Allows sound from now on and starts the track that was asked for earlier. */
  unlock() {
    if (!unlocked) {
      unlocked = true;
      sfx.unlock();
      sfx.setMuted(muted);
    }
    if (wanted) begin(wanted, DEFAULT_FADE_MS);
    notify();
  },

  isUnlocked: () => unlocked,

  /** Cross-fades to a track of the music table. Before unlock() it only remembers the wish. */
  playMusic(id, { fadeMs = DEFAULT_FADE_MS } = {}) {
    wanted = id;
    // every request of a chapter starts the tries afresh: a network that was down may be back without saying so
    failures.delete(id);
    if (unlocked) begin(id, fadeMs);
    notify();
  },

  /**
   * Fetches a track ahead of time, without playing it, so that starting it later does not depend on the
   * network of that moment. Only after unlock(); safe to call again (it retries a failed load).
   */
  preload(id) {
    if (!unlocked || !MUSIC[id]) return;
    const known = players.has(id);
    const player = playerFor(id);
    if (known && player.el.error) {
      failures.delete(id);
      load(player);
    }
  },

  stopMusic({ fadeMs = DEFAULT_FADE_MS } = {}) {
    wanted = null;
    for (const player of players.values()) silence(player, fadeMs);
    active = null;
    notify();
  },

  /**
   * How loud the music is: 1 = its normal volume, 0.5 = half of it, reached smoothly over fadeMs.
   * It stays until it is set again, also for the tracks that follow. The small sounds are not changed.
   */
  setLevel(value, { fadeMs = DEFAULT_FADE_MS } = {}) {
    const next = Math.min(1, Math.max(0, Number(value)));
    if (!Number.isFinite(next) || next === level) return;
    level = next;
    if (active?.on && !active.el.paused) ramp(active, loudness(), fadeMs);
  },

  setMuted(value) {
    muted = value === true;
    for (const player of players.values()) player.el.muted = muted;
    sfx.setMuted(muted);
    notify();
  },

  toggleMute() {
    audio.setMuted(!muted);
    return muted;
  },

  /** True while a music track is really running. */
  isPlaying() {
    if (!active) return false;
    const { el, on } = active;
    return on && !el.paused && !el.ended && !el.error;
  },

  isMuted: () => muted,

  /** callback({ unlocked, muted, playing }) on every change. Returns a function that stops it. */
  onChange(callback) {
    changeListeners.add(callback);
    return () => changeListeners.delete(callback);
  },
};
