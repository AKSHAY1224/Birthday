// Moves between the screens (waiting room, midnight), the eight chapters and the menu.
// One rule above all: while the phase is "countdown", nothing but the waiting room can be shown.
// The page address is never read: no query, hash or saved value can open a chapter early.
import { CHAPTERS, SCREEN_COUNTDOWN, SCREEN_MENU, SCREEN_START } from '../config.js';
import * as phase from './phase.js';
import { buildStub } from './dom.js';

const LEAVE_MS = 620;
const WORDS_IN_MS = 80;
const PRELOAD_AFTER_MS = 1200;
const NEXT_GUARD_MS = 700; // a second tap that lands on the next screen's button must not skip it
const UNWIND_MS = 600; // longest wait for the history step that belonged to a closed overlay

/**
 * modules: { countdown, start, menu, lamp, … }  each { id, mount, enter, exit, complete }
 * roots:   the same keys → the <section> of each
 * ctx:     the shared context given to every module (flow is added here)
 * hud:     { el, dots: [element per chapter] }
 */
export function createFlow({ modules, roots, ctx, hud, reducedMotion }) {
  const { store, stickers, content, awake } = ctx;
  let currentId = null;
  let mode = 'wait'; // wait | live | late | continue | replay
  let depth = 0; // number of the history entry we are on (0 = the base screen of this visit)
  let liveShown = false; // the live reveal plays at most once per visit
  let lastShowAt = -Infinity; // performance.now() of the last screen change
  let wordsTimer = 0;
  let preloadTimer = 0;
  let replaying = false; // a chapter opened again from the menu: its main button leads back to the menu
  let overlay = null; // { onBack } — what the current chapter has open on top of itself (a large photo, a coupon)
  let unwindTimer = 0; // runs while the history step of a closed overlay is being taken back
  const mounted = new Set();
  const hideTimers = new Map();

  const isChapter = (id) => CHAPTERS.includes(id);
  const locked = () => phase.get() === phase.COUNTDOWN;

  const safely = (fn) => {
    try {
      fn();
      return true;
    } catch {
      return false;
    }
  };

  // ── overlays: something a chapter opens on top of itself gets one history step, so Back closes it ──

  const onOverlayStep = () => window.history.state?.over === true;

  function pushOverlayStep() {
    const here = window.history.state;
    if (here?.vb !== currentId || here.over === true) return;
    safely(() => window.history.pushState({ ...here, over: true }, ''));
  }

  /** The history step of the overlay was taken back (or never will be): moving on is allowed again. */
  function unwound() {
    clearTimeout(unwindTimer);
    unwindTimer = 0;
    if (overlay) pushOverlayStep(); // another overlay was opened in the meantime: it gets its own step now
  }

  /** Leaves the history step of an overlay that is closed. Until that has happened, next() and goTo() wait. */
  function stepOffOverlay() {
    // While one step is already being taken back there is nothing more to leave: an overlay that was opened and
    // closed again in that moment never got a step of its own (a second step back would leave the chapter).
    if (!onOverlayStep() || unwindTimer) return;
    clearTimeout(unwindTimer);
    unwindTimer = setTimeout(unwound, UNWIND_MS);
    safely(() => window.history.back());
  }

  function hide(id) {
    const root = roots[id];
    root.classList.remove('is-active', 'is-in');
    clearTimeout(hideTimers.get(id));
    if (reducedMotion) {
      root.hidden = true;
      return;
    }
    root.classList.add('is-leaving');
    hideTimers.set(
      id,
      setTimeout(() => {
        root.hidden = true;
        root.classList.remove('is-leaving');
      }, LEAVE_MS),
    );
  }

  function reveal(id) {
    const root = roots[id];
    clearTimeout(hideTimers.get(id));
    root.classList.remove('is-leaving', 'is-in');
    root.hidden = false;
    root.scrollTop = 0;
    void root.offsetWidth; // so the fade starts from zero
    root.classList.add('is-active');
    clearTimeout(wordsTimer);
    wordsTimer = setTimeout(() => {
      if (currentId === id) root.classList.add('is-in');
    }, WORDS_IN_MS);
  }

  /** A chapter whose code failed still gets a calm screen with a way forward. */
  function mountFallback(id) {
    safely(() => {
      const stub = buildStub(roots[id], { title: content?.errors?.network, button: content?.common?.next });
      stub.button?.addEventListener('click', () => api.next());
    });
  }

  function updateHud(id) {
    if (!hud) return;
    hud.el.classList.toggle('has-rail', isChapter(id));
    hud.dots.forEach((dot, index) => {
      const chapter = CHAPTERS[index];
      dot.classList.toggle('is-now', chapter === id);
      dot.classList.toggle('is-done', chapter !== id && store.isFinished(chapter));
    });
  }

  function warmNext(id) {
    clearTimeout(preloadTimer);
    let upcoming;
    if (id === SCREEN_COUNTDOWN) upcoming = [SCREEN_START, CHAPTERS[0]];
    else if (id === SCREEN_START) upcoming = CHAPTERS.slice(0, 2);
    else if (isChapter(id)) upcoming = CHAPTERS.slice(CHAPTERS.indexOf(id) + 1, CHAPTERS.indexOf(id) + 3);
    else return;
    preloadTimer = setTimeout(() => safely(() => stickers.preload(upcoming)), PRELOAD_AFTER_MS);
  }

  /** remember: false shows a screen without moving her saved place (the Back gesture). */
  function show(id, { push = true, remember = true } = {}) {
    if (!roots[id] || !modules[id]) return false;
    if (locked() && id !== SCREEN_COUNTDOWN) return false;
    if (id === currentId) return true;

    const previous = currentId;
    if (previous) {
      overlay = null; // exit() closes whatever the screen had open
      safely(() => modules[previous].exit());
      hide(previous);
    }
    currentId = id;
    lastShowAt = performance.now();

    if (!mounted.has(id)) {
      mounted.add(id);
      if (!safely(() => modules[id].mount(roots[id], ctx))) mountFallback(id);
    }
    reveal(id);
    safely(() => modules[id].enter(ctx));

    if (isChapter(id) || id === SCREEN_MENU) {
      if (remember) store.setCurrent(id);
      if (push) {
        depth += 1;
        safely(() => window.history.pushState({ vb: id, n: depth }, '', `#c=${id}`));
      }
      // the screen stays awake through the story and may sleep again in the menu
      if (id === SCREEN_MENU) safely(() => awake?.release());
      else safely(() => awake?.hold());
    }
    updateHud(id);
    warmNext(id);
    return true;
  }

  /** The screen that fits the phase: the waiting room before the unlock, the midnight screen after it. */
  function showBase() {
    replaying = false;
    if (locked()) {
      mode = 'wait';
      return show(SCREEN_COUNTDOWN, { push: false });
    }
    // Already on the midnight screen: its mode stays. Coming back to it after the live reveal: the short version.
    if (currentId !== SCREEN_START) mode = store.revealSeen || liveShown ? 'continue' : 'late';
    return show(SCREEN_START, { push: false });
  }

  /** Where "Open your gift" leads: the menu once the story is finished; else the saved chapter, else the first one she has not finished. */
  function resumeTarget() {
    // finished is finished: the menu is home, wherever a second tab may have left the saved place
    if (store.allFinished()) return SCREEN_MENU;
    const { current } = store.progress();
    if (isChapter(current)) return current;
    return CHAPTERS.find((id) => !store.isFinished(id)) ?? SCREEN_MENU;
  }

  const api = {
    /** Shows the first screen. Call once, after the phase is known. */
    begin() {
      // A fresh address: whatever was typed after the page name plays no role.
      safely(() => window.history.replaceState(null, '', './'));
      window.addEventListener('popstate', (event) => {
        const id = event.state && typeof event.state.vb === 'string' ? event.state.vb : null;
        depth = Number.isInteger(event.state?.n) && event.state.n > 0 ? event.state.n : 0;
        if (mode === 'replay' && (currentId === SCREEN_START || currentId === SCREEN_COUNTDOWN) && !locked()) {
          // Back out of a replayed "Midnight" or "The waiting room". A replay has no history step of its own, so
          // this Back has already left the menu's step: she expects the menu, and gets it on a fresh step.
          mode = 'continue';
          replaying = false;
          show(SCREEN_MENU, { push: id !== SCREEN_MENU });
          return;
        }
        if (unwindTimer) {
          // the step of an overlay she closed herself has been taken back: nothing else changes
          unwound();
          if (id === currentId) return;
        }
        if (overlay) {
          // Back with something open on top of the chapter: it closes, and the chapter stays
          const { onBack } = overlay;
          overlay = null;
          safely(onBack);
          if (id === currentId && event.state.over !== true) return;
        }
        if (id && (isChapter(id) || id === SCREEN_MENU) && !locked()) {
          // a chapter reached by Back or Forward once the story is finished is a visit: its button leads to the menu
          replaying = isChapter(id) && store.allFinished();
          show(id, { push: false, remember: false });
          // an entry that belonged to an overlay which is not open any more: step off it
          if (event.state.over === true) stepOffOverlay();
        } else {
          showBase();
        }
      });
      phase.onChange((next, previous) => {
        if (next === phase.COUNTDOWN) {
          showBase();
        } else if (previous === phase.COUNTDOWN) {
          // she was watching when midnight came — the full reveal, once; after that the short version
          mode = liveShown ? 'continue' : 'live';
          liveShown = true;
          show(SCREEN_START, { push: false });
        }
      });
      return showBase();
    },

    /** Finishes the current screen or chapter and moves to the next one. */
    next() {
      if (locked()) return false;
      if (performance.now() - lastShowAt < NEXT_GUARD_MS) return false;
      if (unwindTimer) return false;
      if (currentId === SCREEN_START || currentId === SCREEN_COUNTDOWN) {
        const replayed = mode === 'replay';
        if (currentId === SCREEN_START && !replayed) store.revealSeen = true;
        const target = replayed ? SCREEN_MENU : resumeTarget();
        mode = 'continue';
        // a replay was opened from the menu without a history step of its own: the menu's step is still the
        // one we are on, so going back to it adds none (a second one would be a Back press that does nothing)
        const onMenuStep = replayed && window.history.state?.vb === SCREEN_MENU;
        return show(target, { push: !onMenuStep });
      }
      if (isChapter(currentId)) {
        if (replaying) {
          // opened from the menu: back to the menu, and her saved place does not move
          replaying = false;
          return show(SCREEN_MENU);
        }
        store.markFinished(currentId);
        const index = CHAPTERS.indexOf(currentId);
        return show(index + 1 < CHAPTERS.length ? CHAPTERS[index + 1] : SCREEN_MENU);
      }
      return false;
    },

    /** Opens a chapter, the menu, or replays 'start' / 'countdown' (only after the unlock). */
    goTo(id) {
      if (locked() || unwindTimer) return false;
      if (id === SCREEN_START || id === SCREEN_COUNTDOWN) {
        mode = 'replay';
        return show(id, { push: false });
      }
      // a chapter opened from the menu — or at any time once the story is finished — is a visit:
      // her saved place does not move and its main button leads back to the menu
      if (isChapter(id) && (currentId === SCREEN_MENU || store.allFinished())) {
        if (!show(id, { remember: false })) return false;
        replaying = true;
        return true;
      }
      replaying = false;
      return show(id);
    },

    /**
     * A chapter tells that it has opened something on top of itself (a large photo, an open coupon).
     * From then on the Back gesture calls onBack() — which must close it — and the chapter stays.
     * → a function the chapter calls when she closed it herself (cross, tap outside, Escape). Safe to call twice.
     */
    openOverlay(onBack) {
      if (overlay || !isChapter(currentId) || typeof onBack !== 'function') return () => {};
      const mine = { onBack };
      overlay = mine;
      if (!unwindTimer) pushOverlayStep(); // otherwise unwound() adds the step as soon as the old one is gone
      return () => {
        if (overlay !== mine) return;
        overlay = null;
        stepOffOverlay();
      };
    },

    /** One step back: the previous chapter, or the midnight screen from the first chapter. */
    back() {
      if (depth > 0) {
        window.history.back();
        return true;
      }
      return showBase();
    },

    /** wait | live | late | continue | replay — how the current screen was reached. */
    mode: () => mode,

    /** Id of what is on screen: 'countdown', 'start', a chapter id or 'menu'. */
    current: () => currentId,

    isLocked: locked,

    // ── for the QC handle ──
    currentChapter: () => (isChapter(currentId) ? currentId : null),
    jumpTo(id) {
      if (!isChapter(id) || locked()) return false;
      replaying = false;
      return show(id);
    },
    completeCurrent() {
      if (locked() || !isChapter(currentId)) return false;
      const id = currentId;
      lastShowAt = -Infinity; // not a tap: the checker may finish a chapter the moment it appears
      if (!safely(() => modules[id].complete(ctx)) && currentId === id) api.next();
      return true;
    },
  };

  ctx.flow = Object.freeze({
    next: api.next,
    goTo: api.goTo,
    openOverlay: api.openOverlay,
    back: api.back,
    mode: api.mode,
    current: api.current,
    isLocked: api.isLocked,
  });
  return api;
}
