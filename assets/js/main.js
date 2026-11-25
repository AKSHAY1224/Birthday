// Starts everything, in order, behind the loader. One failed asset never stops the start.
import { CHAPTERS, SCREEN_COUNTDOWN, SCREEN_MENU, SCREEN_START } from './config.js';
import * as clock from './core/clock.js';
import * as phase from './core/phase.js';
import { store } from './core/store.js';
import { audio } from './core/audio.js';
import { awake } from './core/awake.js';
import { sfx } from './core/sfx.js';
import { haptics } from './core/haptics.js';
import { stickers } from './core/stickers.js';
import { createFlow } from './core/flow.js';
import { installHandle } from './core/qc-handle.js';
import { buildStub, h, initButtons, qs } from './core/dom.js';
import { sky } from './fx/sky.js';
import { confetti } from './fx/confetti.js';

const CONTENT = 'assets/data/content.json';
const WATCHDOG_MS = 10000;
const LOADER_LINE_MS = 1900;
const FONT_WAIT_MS = 2500;
const TOAST_MS = 2800;

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let ready = false;
let flow = null;
const NO_FLOW = { currentChapter: () => null, jumpTo: () => false, completeCurrent: () => false };

installHandle({ isReady: () => ready, flow: () => flow ?? NO_FLOW, audio });

// ───────────── loader ─────────────

const loader = {
  el: qs('[data-qc="loader"]'),
  line: qs('[data-role="loader-line"]'),
  fallback: qs('[data-role="loader-fallback"]'),
  fill: qs('[data-role="loader-fill"]'),
  total: 1,
  done: 0,
  timer: 0,
  step() {
    this.done += 1;
    this.fill?.style.setProperty('--p', String(Math.min(1, Math.max(0.04, this.done / this.total))));
  },
  /** Wraps a start-up job: counts it for the progress bar and never lets it throw. */
  track(job) {
    this.total += 1;
    return Promise.resolve()
      .then(job)
      .catch(() => undefined)
      .finally(() => this.step());
  },
  rotate(lines) {
    if (!this.line || !Array.isArray(lines) || lines.length === 0) return;
    let index = 0;
    this.line.textContent = lines[0];
    this.timer = setInterval(() => {
      index = (index + 1) % lines.length;
      this.line.classList.add('is-swapping');
      setTimeout(() => {
        this.line.textContent = lines[index];
        this.line.classList.remove('is-swapping');
      }, 400);
    }, LOADER_LINE_MS);
  },
  showFallback() {
    if (!this.fallback) return;
    clearInterval(this.timer);
    if (this.line) this.line.hidden = true;
    this.fallback.hidden = false;
  },
  hide() {
    clearInterval(this.timer);
    if (!this.el) return;
    this.el.classList.add('is-done');
    setTimeout(() => {
      this.el.hidden = true;
    }, 450);
  },
};

// ───────────── start-up jobs ─────────────

/** The words. Without them nothing can be shown, so this one keeps trying. */
async function loadContent() {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(CONTENT, attempt === 0 ? undefined : { cache: 'reload' });
      if (response.ok) return await response.json();
    } catch {
      // try again below
    }
    await wait(Math.min(3000, 500 * (attempt + 1)));
  }
}

function loadFonts() {
  if (!document.fonts?.load) return Promise.resolve();
  const wanted = ['500 1em "Bodoni Moda"', '400 1em "Jost"', '600 1em "Jost"', '600 1em "Caveat"', '400 1em "Pinyon Script"'];
  return Promise.race([Promise.allSettled(wanted.map((font) => document.fonts.load(font))), wait(FONT_WAIT_MS)]);
}

/** A stand-in for a screen whose file could not be loaded: the story still moves on. */
function fallbackModule(id) {
  return {
    id,
    mount(root, ctx) {
      const stub = buildStub(root, { title: ctx.content.errors?.network, button: ctx.content.common?.next });
      stub.button?.addEventListener('click', () => ctx.flow.next());
    },
    enter() {},
    exit() {},
    complete(ctx) {
      ctx.flow.next();
    },
  };
}

const usable = (module) => module && ['mount', 'enter', 'exit', 'complete'].every((name) => typeof module[name] === 'function');

function loadModules() {
  const files = {
    [SCREEN_COUNTDOWN]: () => import('./screens/waiting-room.js'),
    [SCREEN_START]: () => import('./screens/midnight.js'),
    lamp: () => import('./chapters/lamp.js'),
    frames: () => import('./chapters/frames.js'),
    question: () => import('./chapters/question.js'),
    reasons: () => import('./chapters/reasons.js'),
    letter: () => import('./chapters/letter.js'),
    cake: () => import('./chapters/cake.js'),
    gifts: () => import('./chapters/gifts.js'),
    finale: () => import('./chapters/finale.js'),
    [SCREEN_MENU]: () => import('./chapters/menu.js'),
  };
  const modules = {};
  const jobs = Object.entries(files).map(([id, load]) =>
    loader.track(async () => {
      try {
        const loaded = (await load()).default;
        modules[id] = usable(loaded) ? loaded : fallbackModule(id);
      } catch {
        modules[id] = fallbackModule(id);
      }
    }),
  );
  return Promise.all(jobs).then(() => modules);
}

function collectRoots() {
  const roots = {};
  for (const id of [SCREEN_COUNTDOWN, SCREEN_START, SCREEN_MENU]) roots[id] = qs(`[data-screen="${id}"]`);
  for (const id of CHAPTERS) roots[id] = qs(`[data-chapter="${id}"]`);
  return roots;
}

function makeToast() {
  const el = qs('[data-role="toast"]');
  let timer = 0;
  return (text, { ms = TOAST_MS } = {}) => {
    if (!el || !text) return;
    clearTimeout(timer);
    el.textContent = String(text);
    el.classList.add('is-on');
    timer = setTimeout(() => el.classList.remove('is-on'), ms);
  };
}

function makeHud() {
  const el = qs('.hud');
  const rail = qs('[data-role="rail"]');
  if (!el || !rail) return null;
  const dots = CHAPTERS.map(() => h('span', { class: 'hud__dot' }));
  rail.replaceChildren(...dots);
  return { el, dots };
}

// ───────────── start ─────────────

async function start() {
  const watchdog = setTimeout(() => {
    if (!ready) loader.showFallback();
  }, WATCHDOG_MS);

  try {
    sky.start(qs('.sky'), { reducedMotion });
    confetti.init({ reducedMotion });
    initButtons(reducedMotion);
    audio.init(qs('[data-qc="mute"]'));
    // the sound button as she left it: silent stays silent across a reload
    if (store.muted) audio.setMuted(true);
    audio.onChange(({ muted }) => {
      store.muted = muted;
    });
  } catch {
    // decoration and sound are never essential
  }

  const contentJob = loader.track(loadContent).then((content) => {
    loader.rotate(content?.loader?.lines);
    return content;
  });
  const modulesJob = loadModules();
  const [content, modules] = await Promise.all([
    contentJob,
    modulesJob,
    loader.track(() => stickers.load()),
    loader.track(loadFonts),
    loader.track(() => phase.start()),
  ]);

  const ctx = {
    content,
    store,
    clock,
    phase,
    audio,
    awake,
    sfx,
    haptics,
    stickers,
    fx: { sky, confetti },
    reducedMotion,
    toast: makeToast(),
    flow: null, // filled in by createFlow
  };
  flow = createFlow({ modules, roots: collectRoots(), ctx, hud: makeHud(), reducedMotion });
  flow.begin();

  loader.step();
  loader.hide();
  clearTimeout(watchdog);
  ready = true;
}

start().catch(() => loader.showFallback());
