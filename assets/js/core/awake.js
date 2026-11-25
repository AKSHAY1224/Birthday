// Keeps the screen awake while the story runs (a bonus: phones without the Wake Lock API just dim as usual).
// hold() from her first tap, release() in the menu. The browser drops the lock whenever the page is hidden,
// so it is asked for again each time the page comes back.

let wanted = false;
let lock = null;
let asking = false;
let listening = false;

async function acquire() {
  if (!wanted || lock || asking || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  asking = true;
  try {
    const got = await navigator.wakeLock.request('screen');
    if (!wanted) {
      got.release().catch(() => {}); // release() came while the request was under way
      return;
    }
    lock = got;
    got.addEventListener('release', () => {
      if (lock === got) lock = null;
    });
  } catch {
    // refused (battery saver, no permission): the screen simply follows its own timeout
  } finally {
    asking = false;
  }
}

export const awake = {
  /** Keeps the screen on from now on. Safe to call again and again. */
  hold() {
    wanted = true;
    if (!listening) {
      listening = true;
      document.addEventListener('visibilitychange', acquire);
    }
    acquire();
  },

  /** Lets the screen sleep again. */
  release() {
    wanted = false;
    const old = lock;
    lock = null;
    try {
      old?.release().catch(() => {});
    } catch {
      // already released
    }
  },

  /** True while the screen is really being kept on. */
  isHeld: () => lock !== null,
};
