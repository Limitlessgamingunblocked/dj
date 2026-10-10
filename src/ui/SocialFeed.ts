/*
 * The phone in your hub (Section 9.6): the social feed. Fans' posts about
 * your sets with your name and handle, the promoters and the papers, and
 * your saved clips as posts with likes and comments. Your followers on top.
 */
import type { FeedSave, Post } from '../core/models';
import { handleFor } from '../game/social';
import { h } from './dom';
import { openModal, type ModalHandle } from './modal';

export interface FeedHooks {
  feed: FeedSave;
  dj: string;
  followers: number;
  /** open a clip post's recording in My Sets */
  watch?(recordingId: string): void;
}

const KIND_BADGE: Record<Post['kind'], string> = { fan: '', clip: '🎥', promoter: '📣', rival: '🎧', news: '📰', you: '' };

/** "3m", "2h", "4d" */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

/** a round avatar with initials, coloured by the handle */
function avatar(name: string, handle: string): HTMLElement {
  let hsh = 0;
  for (const ch of handle) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return h('span', { class: 'sf-av', style: `--h:${hsh % 360}`, 'aria-hidden': 'true' }, name.slice(0, 1).toUpperCase());
}

export function openFeed(o: FeedHooks): ModalHandle {
  const me = handleFor(o.dj);
  const liked = new Set<string>();
  const list = h('div', { class: 'sf-list', role: 'feed', 'aria-label': 'Your feed' });
  const post = (p: Post) => {
    const like = h('button', { type: 'button', class: 'sf-like', 'aria-pressed': 'false', title: 'Like' }, `♥ ${short(p.likes)}`);
    like.addEventListener('click', () => {
      const on = !liked.has(p.id);
      on ? liked.add(p.id) : liked.delete(p.id);
      like.setAttribute('aria-pressed', String(on));
      like.textContent = `♥ ${short(p.likes + (on ? 1 : 0))}`;
    });
    const clip = p.clip
      ? (() => {
          const b = h('button', { type: 'button', class: 'sf-clip', title: 'Watch it in My Sets' }, h('span', { class: 'sf-play' }, '▶'), h('span', {}, 'Your clip'));
          b.addEventListener('click', () => o.watch?.(p.clip!));
          return b;
        })()
      : null;
    return h(
      'article',
      { class: `sf-post k-${p.kind}`, 'aria-label': `${p.author}: ${p.text}` },
      avatar(p.author, p.handle),
      h(
        'div',
        { class: 'sf-body' },
        h('div', { class: 'sf-who' }, h('b', {}, p.author), h('span', {}, ` ${p.handle} · ${ago(p.date)}`), KIND_BADGE[p.kind] ? h('i', {}, ` ${KIND_BADGE[p.kind]}`) : null),
        h('p', {}, p.text),
        clip,
        h('div', { class: 'sf-acts' }, like, h('span', {}, `💬 ${p.comments.length}`)),
        ...(p.comments.length ? [h('div', { class: 'sf-comments' }, ...p.comments.slice(0, 3).map((c) => h('p', {}, h('b', {}, c.handle), ' ', c.text)))] : []),
      ),
    );
  };
  if (o.feed.posts.length) list.append(...o.feed.posts.map(post));
  else list.append(h('p', { class: 'sf-empty' }, 'Nothing yet. Play a set and the fans will start posting. Save a clip and it goes up here too.'));
  const phone = h(
    'div',
    { class: 'sf-phone' },
    h('div', { class: 'sf-notch', 'aria-hidden': 'true' }),
    h('header', { class: 'sf-head' }, h('b', {}, 'Feed'), h('span', {}, me), h('span', { class: 'sf-fol' }, `${short(o.followers)} followers`)),
    list,
  );
  return openModal('Your phone', h('div', { class: 'sf-wrap' }, phone));
}
