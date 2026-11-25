// The starfield behind every screen: soft twinkling stars and, rarely, a shooting star.
// Still picture when the phone asks for less motion; paused while the tab is hidden.

const MAX_PIXEL_RATIO = 2;
const FRAME_MS = 1000 / 30;
const STAR_COLOURS = ['245, 239, 226', '245, 239, 226', '246, 227, 174', '200, 214, 255'];

let canvas = null;
let pen = null;
let stars = [];
let width = 0;
let height = 0;
let frame = 0;
let lastDraw = 0;
let still = false;
let running = false;
let shooting = null;
let nextShootingAt = 0;
let resizeTimer = 0;

function seedStars() {
  const count = Math.round(Math.min(170, Math.max(70, (width * height) / 3600)));
  stars = Array.from({ length: count }, () => {
    const depth = Math.random();
    return {
      x: Math.random() * width,
      y: Math.random() ** 1.25 * height,
      r: 0.35 + depth * depth * 1.25,
      base: 0.25 + depth * 0.6,
      speed: 0.4 + Math.random() * 1.3,
      phase: Math.random() * Math.PI * 2,
      colour: STAR_COLOURS[Math.floor(Math.random() * STAR_COLOURS.length)],
    };
  });
}

function resize() {
  const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  pen.setTransform(ratio, 0, 0, ratio, 0, 0);
  seedStars();
  draw(performance.now());
}

function drawShooting(time) {
  if (!shooting) {
    if (time > nextShootingAt) {
      shooting = { x: width * (0.15 + Math.random() * 0.6), y: height * (0.05 + Math.random() * 0.25), born: time, life: 900, angle: Math.PI * (0.18 + Math.random() * 0.1) };
      nextShootingAt = time + 14000 + Math.random() * 22000;
    }
    return;
  }
  const t = (time - shooting.born) / shooting.life;
  if (t >= 1) {
    shooting = null;
    return;
  }
  const travel = 220 * t;
  const headX = shooting.x + Math.cos(shooting.angle) * travel;
  const headY = shooting.y + Math.sin(shooting.angle) * travel;
  const tailX = headX - Math.cos(shooting.angle) * 70;
  const tailY = headY - Math.sin(shooting.angle) * 70;
  const fade = Math.sin(Math.PI * t);
  const trail = pen.createLinearGradient(tailX, tailY, headX, headY);
  trail.addColorStop(0, 'rgba(246, 227, 174, 0)');
  trail.addColorStop(1, `rgba(255, 246, 220, ${0.8 * fade})`);
  pen.strokeStyle = trail;
  pen.lineWidth = 1.4;
  pen.lineCap = 'round';
  pen.beginPath();
  pen.moveTo(tailX, tailY);
  pen.lineTo(headX, headY);
  pen.stroke();
}

function draw(time) {
  pen.clearRect(0, 0, width, height);
  const seconds = time / 1000;
  for (const star of stars) {
    const twinkle = still ? 1 : 0.62 + 0.38 * Math.sin(star.phase + seconds * star.speed);
    pen.fillStyle = `rgba(${star.colour}, ${(star.base * twinkle).toFixed(3)})`;
    pen.beginPath();
    pen.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    pen.fill();
  }
  if (!still) drawShooting(time);
}

function loop(time) {
  frame = requestAnimationFrame(loop);
  if (time - lastDraw < FRAME_MS) return;
  lastDraw = time;
  draw(time);
}

function play() {
  if (still || running || !pen || document.visibilityState === 'hidden') return;
  running = true;
  frame = requestAnimationFrame(loop);
}

function pause() {
  running = false;
  cancelAnimationFrame(frame);
}

export const sky = {
  /** Starts the sky on the given canvas. A canvas that cannot be drawn on is simply left empty. */
  start(target, { reducedMotion = false } = {}) {
    try {
      if (!target || pen) return;
      canvas = target;
      pen = canvas.getContext('2d');
      if (!pen) return;
      still = reducedMotion;
      nextShootingAt = performance.now() + 6000 + Math.random() * 8000;
      resize();
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 150);
      });
      document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? pause() : play()));
      play();
    } catch {
      pen = null;
    }
  },

  /** Sends one shooting star now (for a special moment). */
  shoot() {
    if (!still) nextShootingAt = 0;
  },

  pause,
  resume: play,
};
