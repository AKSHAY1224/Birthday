// Small sounds made with the Web Audio API — no files. play(name) does nothing until sound is
// unlocked (the first tap) and while the site is muted.

const MASTER = 0.5;

let context = null;
let master = null;
let muted = false;
let noiseBuffer = null;

function noise() {
  if (!noiseBuffer) {
    noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/** One note. { type, from, to, at, length, gain, attack } */
function tone({ type = 'sine', from, to = from, at = 0, length = 0.2, gain = 0.3, attack = 0.005 }) {
  const start = context.currentTime + at;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + length);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(envelope).connect(master);
  oscillator.start(start);
  oscillator.stop(start + length + 0.03);
}

/** A breath of filtered noise. { filter, from, to, at, length, gain, q } */
function hiss({ filter = 'bandpass', from = 1000, to = from, at = 0, length = 0.3, gain = 0.25, q = 0.8, attack = 0.02 }) {
  const start = context.currentTime + at;
  const source = context.createBufferSource();
  const shape = context.createBiquadFilter();
  const envelope = context.createGain();
  source.buffer = noise();
  source.loop = true;
  shape.type = filter;
  shape.Q.value = q;
  shape.frequency.setValueAtTime(from, start);
  if (to !== from) shape.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + length);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
  source.connect(shape).connect(envelope).connect(master);
  source.start(start, Math.random() * 0.5);
  source.stop(start + length + 0.03);
}

const SOUNDS = {
  tap() {
    tone({ type: 'triangle', from: 660, to: 520, length: 0.07, gain: 0.18 });
  },
  pop() {
    tone({ from: 320, to: 760, length: 0.11, gain: 0.3 });
  },
  chime() {
    [880, 1318.5, 1760].forEach((note, i) => tone({ from: note, at: i * 0.09, length: 1.1, gain: 0.16, attack: 0.01 }));
  },
  sparkle() {
    [2093, 2637, 3136, 3951, 3136].forEach((note, i) => tone({ type: 'triangle', from: note, at: i * 0.055, length: 0.22, gain: 0.08 }));
  },
  whoosh() {
    hiss({ from: 300, to: 2600, length: 0.5, gain: 0.22, q: 0.6, attack: 0.18 });
  },
  tick() {
    tone({ type: 'square', from: 1400, length: 0.03, gain: 0.07, attack: 0.002 });
  },
  heartbeat() {
    tone({ from: 70, to: 42, length: 0.16, gain: 0.7, attack: 0.01 });
    tone({ from: 62, to: 38, at: 0.24, length: 0.2, gain: 0.55, attack: 0.01 });
  },
  puff() {
    hiss({ filter: 'lowpass', from: 1500, to: 220, length: 0.36, gain: 0.3, attack: 0.03 });
  },
  boom() {
    tone({ from: 130, to: 34, length: 0.9, gain: 0.8, attack: 0.008 });
    hiss({ filter: 'lowpass', from: 900, to: 90, length: 0.8, gain: 0.35, attack: 0.008 });
  },
  crackle() {
    for (let i = 0; i < 14; i++) {
      hiss({ filter: 'highpass', from: 3200 + Math.random() * 2600, at: 0.05 + Math.random() * 0.8, length: 0.035, gain: 0.1 + Math.random() * 0.12, attack: 0.002 });
    }
  },
};

export const sfx = {
  names: Object.freeze(Object.keys(SOUNDS)),

  /** Called by audio.unlock() inside the first tap. */
  unlock() {
    if (context) {
      context.resume().catch(() => {});
      return;
    }
    try {
      const Context = window.AudioContext ?? window.webkitAudioContext;
      if (!Context) return;
      context = new Context();
      master = context.createGain();
      master.gain.value = muted ? 0 : MASTER;
      master.connect(context.destination);
      context.resume().catch(() => {});
    } catch {
      context = null;
    }
  },

  /** Plays one of: tap, pop, chime, sparkle, whoosh, tick, heartbeat, puff, boom, crackle. */
  play(name) {
    if (!context || muted || context.state !== 'running' || !Object.hasOwn(SOUNDS, name)) return;
    try {
      SOUNDS[name]();
    } catch {
      // a sound that cannot be made is simply skipped
    }
  },

  setMuted(value) {
    muted = value === true;
    if (master) master.gain.value = muted ? 0 : MASTER;
  },

  suspend() {
    if (context && context.state === 'running') context.suspend().catch(() => {});
  },

  resume() {
    if (context && context.state === 'suspended') context.resume().catch(() => {});
  },
};
