// The menu after the finale — a calm home she can come back to for ever.
// Her name, one short line, and the ten parts of the story as small cards with a drawn icon each.
// A tap replays that part: the two screens ('countdown', 'start') as replays that lead back here,
// a chapter from its beginning, whose main button leads back here. The screen may sleep again here;
// the last track plays, more softly, and the music gets its full volume back when she leaves.
// Interface: mount builds the DOM once, enter runs each time it is shown, exit restores the music level.
import { buildScreen, h, svg } from '../core/dom.js';

const DECOR = { 'aria-hidden': 'true' };
const STAGGER_MS = 60;
const MUSIC_LEVEL = 0.55; // of the normal music volume: a home to stay in, not a show
const MUSIC_LEVEL_MS = 1600;

let audio = null;

// One small line drawing per part, in a 24 x 24 box (stroked, never filled).
const ICONS = {
  countdown: ['M19.5 14.2A8 8 0 1 1 9.8 4.5a6.4 6.4 0 0 0 9.7 9.7z'], // moon
  start: ['M11 4l1.7 5.3L18 11l-5.3 1.7L11 18l-1.7-5.3L4 11l5.3-1.7z', 'M18.5 3.5v3M17 5h3', 'M18.5 16.5v3M17 18h3'], // spark
  lamp: ['M4 13.5h16c0 3.4-3.6 5.8-8 5.8s-8-2.4-8-5.8z', 'M12 4.2c1.7 1.9 2.3 3.2 2.3 4.4a2.3 2.3 0 0 1-4.6 0c0-1.2.6-2.5 2.3-4.4z'], // lamp
  frames: ['M5 4.5h14a.5.5 0 0 1 .5.5v14a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5z', 'M4.8 15.5l4.2-4 3.2 3 2.3-2.2 4.7 4.4', 'M15 8.6h.01'], // frame
  question: ['M12 19.6C6.3 15.4 3.5 12.2 3.5 8.9 3.5 6.4 5.4 4.6 7.7 4.6c1.7 0 3.1.9 4.3 2.6 1.2-1.7 2.6-2.6 4.3-2.6 2.3 0 4.2 1.8 4.2 4.3 0 3.3-2.8 6.5-8.5 10.7z'], // heart
  reasons: ['M6.5 8h9A1.5 1.5 0 0 1 17 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18.5v-9A1.5 1.5 0 0 1 6.5 8z', 'M8 5h10.5A1.5 1.5 0 0 1 20 6.5V17', 'M8.5 12h5M8.5 15.5h3'], // cards
  letter: ['M4.5 6.5h15a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5h-15A.5.5 0 0 1 4 17V7a.5.5 0 0 1 .5-.5z', 'M4.3 7.2l7.7 6 7.7-6'], // envelope
  cake: ['M5 12.5h14v6.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5z', 'M5 15.6c1.5 1.1 3.1 1.1 4.6 0s3.2-1.1 4.8 0 3.1 1.1 4.6 0', 'M12 12.5V9', 'M12 4.4c1 1.1 1 2.1 0 2.9-1-.8-1-1.8 0-2.9z'], // cake
  gifts: ['M5 11.5h14v7.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5z', 'M4 8h16v3.5H4z', 'M12 8v11.5', 'M12 8C10.2 4.6 7.2 4.9 7.6 6.6 7.9 7.9 10.4 8 12 8z', 'M12 8c1.8-3.4 4.8-3.1 4.4-1.4C16.1 7.9 13.6 8 12 8z'], // gift
  finale: ['M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z'], // star
};

function icon(id) {
  const paths = ICONS[id] ?? ICONS.finale;
  return svg('svg', { viewBox: '0 0 24 24', focusable: 'false', ...DECOR }, paths.map((d) => svg('path', { d })));
}

export default {
  id: 'menu',

  mount(root, ctx) {
    const { content, stickers } = ctx;
    audio = ctx.audio;
    const text = content.menu ?? {};
    const items = (Array.isArray(text.items) ? text.items : []).filter((item) => item && item.id && item.label);
    const { col, body, actions } = buildScreen(root);
    col.classList.add('menu');
    actions.remove();

    const stickerKey = stickers.forChapter('countdown')[0] ?? stickers.forChapter('finale')[2];
    const head = h(
      'header',
      { class: 'menu__head' },
      h('div', { class: 'sticker-slot menu__sticker reveal', attrs: DECOR }, stickerKey ? stickers.el(stickerKey) : null),
      content.midnight?.name ? h('p', { class: 'name-script menu__name reveal d1', text: content.midnight.name }) : null,
      text.title ? h('h1', { class: 'hand menu__title reveal d2', text: text.title }) : null,
      h('hr', { class: 'rule reveal d3', attrs: DECOR }),
    );

    const cards = items.map((item, index) => {
      const card = h(
        'button',
        { type: 'button', class: 'menu-card reveal' },
        h('span', { class: 'menu-card__icon', attrs: DECOR }, icon(item.id)),
        h('span', { class: 'menu-card__label', text: item.label }),
      );
      card.style.setProperty('--delay', `${420 + index * STAGGER_MS}ms`);
      card.addEventListener('click', () => {
        ctx.audio.unlock();
        ctx.sfx.play('tap');
        ctx.haptics.tap();
        ctx.flow.goTo(item.id);
      });
      return h('li', { class: 'menu__item' }, card);
    });
    const list = h('ul', { class: 'menu__grid' }, cards);

    const foot = h(
      'footer',
      { class: 'menu__foot reveal' },
      text.credits ? h('a', { class: 'menu__credits', href: 'credits.txt', target: '_blank', rel: 'noopener', text: text.credits }) : null,
    );
    foot.style.setProperty('--delay', `${520 + items.length * STAGGER_MS}ms`);

    body.append(head, list, foot);
  },

  enter(ctx) {
    ctx.awake.release(); // the story is over: the screen may sleep again
    // home always sounds the same: the calm last track, softly — also on a return visit ("Open your gift" starts
    // the celebration) and after a replayed chapter. Coming from the finale it simply goes on.
    ctx.audio.setLevel(MUSIC_LEVEL, { fadeMs: MUSIC_LEVEL_MS });
    ctx.audio.playMusic('finale', { fadeMs: 3000 });
  },

  exit() {
    audio?.setLevel(1);
  },

  complete() {},
};
