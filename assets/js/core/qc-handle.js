// window.__BDAY__ — the small handle the QC checker uses to walk through the site
// (the "Testability contract" in qc/README.md). It cannot open anything before the unlock:
// goTo() and completeCurrent() ask the flow, and the flow refuses while the countdown runs.
import { CHAPTERS } from '../config.js';

export function installHandle({ isReady, flow, audio }) {
  const handle = Object.freeze({
    get ready() {
      return isReady() === true;
    },
    chapters: Object.freeze([...CHAPTERS]),
    current: () => flow().currentChapter(),
    goTo: (id) => flow().jumpTo(id),
    completeCurrent: () => flow().completeCurrent(),
    audio: Object.freeze({
      isPlaying: () => audio.isPlaying(),
      isMuted: () => audio.isMuted(),
    }),
  });
  Object.defineProperty(window, '__BDAY__', { value: handle, writable: false, configurable: false });
  return handle;
}
