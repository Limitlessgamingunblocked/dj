/*
 * Scratch and juggle challenges on screen (opt-in, from the menu): pick a
 * pattern, a bar of clicks counts you in, then four bars to play it. The
 * lane shows what's coming; every hit is judged as you play it.
 *   – strokes: the jog wheel (your controller, the board on the stage, or
 *     the record here: drag it round), or ← → on the keyboard
 *   – cuts: the channel 1 fader or the crossfader, the Cut button, or Space
 *   – drops: deck 1 and 2 starting (hot cue or cue and play), the buttons,
 *     or 1 and 2 on the keyboard
 * Deck 1's track is what you hear scratched (load one first for the sound).
 */
import type { AudioEngine } from '../audio/AudioEngine';
import { BAND_POINTS, Judge, WINDOW, keepBest, loadBests, PATTERNS, schedule, StrokeDetector, type Band, type HitKind, type ScratchPattern } from '../game/scratch';
import { h } from './dom';
import { openModal, type ModalHandle } from './modal';

export interface ScratchHooks {
  engine: AudioEngine;
}

const REPEATS = 4;
const BAND_COLOR: Record<Band, string> = { perfect: '#ffd23f', good: '#3ddc97', ok: '#4cc9f0', miss: '#ff3b5c' };
const BAND_TEXT: Record<Band, string> = { perfect: 'Perfect', good: 'Good', ok: 'OK', miss: 'Miss' };

export function openScratchChallenges(o: ScratchHooks): ModalHandle {
  const body = h('div', { class: 'scratch' });
  let stop: (() => void) | null = null;

  const list = () => {
    stop?.();
    stop = null;
    const bests = loadBests();
    body.replaceChildren(
      h('p', { class: 'gs-note' }, 'Opt-in challenges for your hands: a pattern against a click, scored on timing. Use your controller’s jog, the board on the stage, or drag the record on screen. Load a track on deck 1 to hear it.'),
      h(
        'div',
        { class: 'sc-list' },
        ...PATTERNS.map((p) => {
          const b = bests[p.id];
          const go = h('button', { type: 'button', class: 'sc-card' }, h('span', { class: 'sc-lvl', title: `Level ${p.level}` }, '●'.repeat(p.level) + '○'.repeat(3 - p.level)), h('b', {}, p.name), h('small', {}, `${p.bpm} BPM · ${p.input === 'jog' ? 'Jog' : p.input === 'fader' ? 'Fader' : 'Two decks'}`), h('span', { class: 'sc-best' }, b ? `${'★'.repeat(b.stars)}${'☆'.repeat(3 - b.stars)} ${b.points.toLocaleString()}` : 'Not played'));
          go.addEventListener('click', () => play(p));
          return go;
        }),
      ),
    );
  };

  const play = (p: ScratchPattern) => {
    stop?.();
    const e = o.engine;
    const ctx = e.ctx;
    const d1 = e.decks[0];
    const d2 = e.decks[1];
    const beat = 60 / p.bpm;
    const countIn = p.beats * beat;
    const start = ctx.currentTime + 0.4;
    const now = () => ctx.currentTime - start - countIn;
    const exp = schedule(p, REPEATS);
    const judge = new Judge(exp);
    const det = new StrokeDetector();
    const flashes: { t: number; band: Band; i: number }[] = [];
    let combo = 0;
    let best = 0;
    let last: { text: string; color: string; at: number } | null = null;

    // the click: a bar to count in, then the pattern's bars
    const clicks: OscillatorNode[] = [];
    const totalBeats = p.beats * (REPEATS + 1);
    for (let b = 0; b < totalBeats; b++) {
      const t = start + b * beat;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = b % p.beats === 0 ? 1760 : 1100;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(b < p.beats ? 0.22 : 0.12, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.08);
      clicks.push(osc);
    }

    const hit = (kind: HitKind, dir: 1 | -1 | 0, deck?: 1 | 2) => {
      const t = now();
      if (t < -0.2) return;
      const r = judge.input(t, kind, dir, deck);
      if (r) {
        flashes.push({ t: exp[r.i].t, band: r.band, i: r.i });
        combo++;
        best = Math.max(best, combo);
        last = { text: BAND_TEXT[r.band], color: BAND_COLOR[r.band], at: performance.now() };
      }
    };
    // the jog: every jog movement on deck 1 becomes strokes
    const prevJog = d1.onJog;
    d1.onJog = (revs) => {
      const s = det.feed(ctx.currentTime, revs);
      if (s) hit('stroke', s.dir);
    };

    // the lane and the record
    const lane = h('canvas', { class: 'sc-lane', width: 900, height: 170, 'aria-label': 'What’s coming' }) as HTMLCanvasElement;
    const rec = h('canvas', { class: 'sc-rec', width: 220, height: 220, 'aria-label': 'Drag the record round to scratch', tabindex: 0 }) as HTMLCanvasElement;
    let angle = 0;
    let dragA: number | null = null;
    const ang = (ev: PointerEvent) => {
      const r = rec.getBoundingClientRect();
      return Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2));
    };
    rec.addEventListener('pointerdown', (ev) => {
      rec.setPointerCapture(ev.pointerId);
      dragA = ang(ev);
      d1.jogTouch('top');
    });
    rec.addEventListener('pointermove', (ev) => {
      if (dragA === null) return;
      const a = ang(ev);
      let da = a - dragA;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      dragA = a;
      angle += da;
      d1.jogTurn(da / (Math.PI * 2));
    });
    const up = () => {
      if (dragA === null) return;
      dragA = null;
      d1.jogTouch(null);
    };
    rec.addEventListener('pointerup', up);
    rec.addEventListener('pointercancel', up);

    // the keyboard, the cut and drop buttons
    const keyStroke = (dir: 1 | -1) => {
      hit('stroke', dir);
      // and a little scratch to hear it
      d1.jogTouch('top');
      const prev = d1.onJog;
      d1.onJog = null;
      d1.jogTurn(dir * 0.12);
      d1.onJog = prev;
      setTimeout(() => d1.jogTouch(null), 80);
      angle += dir * 0.75;
    };
    let cutOpen = false;
    const cut = (open: boolean) => {
      if (open && !cutOpen) hit('cut', 0);
      cutOpen = open;
    };
    const onKey = (ev: KeyboardEvent) => {
      if (!body.isConnected) return;
      if (ev.key === 'ArrowRight') keyStroke(1);
      else if (ev.key === 'ArrowLeft') keyStroke(-1);
      else if (ev.key === ' ' && !ev.repeat) cut(true);
      else if (ev.key === '1') hit('drop', 0, 1);
      else if (ev.key === '2') hit('drop', 0, 2);
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === ' ') cut(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp, true);
    const cutBtn = h('button', { type: 'button', class: 'btn sc-cut' }, 'Cut (Space)');
    cutBtn.addEventListener('pointerdown', () => cut(true));
    cutBtn.addEventListener('pointerup', () => cut(false));
    cutBtn.addEventListener('pointerleave', () => cut(false));
    const drop1 = h('button', { type: 'button', class: 'btn' }, 'Deck 1 (1)');
    const drop2 = h('button', { type: 'button', class: 'btn' }, 'Deck 2 (2)');
    drop1.addEventListener('click', () => hit('drop', 0, 1));
    drop2.addEventListener('click', () => hit('drop', 0, 2));

    // the real fader and decks
    let faderOpen = false;
    const deckState = [d1, d2].map((d) => ({ playing: d.playing, pos: d.position() }));
    const pollHardware = () => {
      const ch = e.channels[0];
      const open = ch.state.fader * ch.xfGain > 0.35;
      if (open && !faderOpen) hit('cut', 0);
      faderOpen = open;
      [d1, d2].forEach((d, i) => {
        const s = deckState[i];
        const pos = d.position();
        const restarted = (d.playing && !s.playing) || (d.playing && pos < s.pos - 0.25);
        if (restarted) hit('drop', 0, (i + 1) as 1 | 2);
        s.playing = d.playing;
        s.pos = pos;
      });
    };

    const scoreEl = h('b', { class: 'sc-score' }, '0');
    const comboEl = h('span', { class: 'sc-combo' });
    const back = h('button', { type: 'button', class: 'btn ghost' }, '← Challenges');
    back.addEventListener('click', list);
    const controls = p.input === 'jog' ? h('div', { class: 'sc-controls' }, rec, h('p', { class: 'gs-note' }, 'Drag the record (clockwise is forward), use your jog wheel, or ← →.')) : p.input === 'fader' ? h('div', { class: 'sc-controls' }, rec, h('div', {}, cutBtn, h('p', { class: 'gs-note' }, 'Keep the record moving and cut with the channel 1 fader, the crossfader, the button or Space.'))) : h('div', { class: 'sc-controls' }, h('div', { class: 'gs-actions' }, drop1, drop2), h('p', { class: 'gs-note' }, 'Hit hot cue 1 on each deck in turn (or cue and play). The buttons and 1 / 2 count too.'));
    // the first downbeat on the audio clock (for anything that wants to play along in time)
    body.dataset.downbeat = String(start + countIn);
    body.replaceChildren(h('div', { class: 'sc-head' }, back, h('div', {}, h('b', {}, p.name), h('small', { class: 'gs-note' }, ` · ${p.how}`)), h('span', { class: 'spacer' }), comboEl, scoreEl), lane, controls);

    const g = lane.getContext('2d')!;
    const rg = rec.getContext('2d')!;
    const W = lane.width;
    const H = lane.height;
    const hitX = W * 0.18;
    const ahead = 2.6;
    const pxs = (W - hitX) / ahead;
    let finished = false;
    const frame = () => {
      if (!body.isConnected || finished) return;
      const t = now();
      det.idle(ctx.currentTime);
      pollHardware();
      for (const i of judge.tick(t)) {
        flashes.push({ t: exp[i].t, band: 'miss', i });
        combo = 0;
        last = { text: 'Miss', color: BAND_COLOR.miss, at: performance.now() };
      }
      // the lane
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#0b1020';
      g.fillRect(0, 0, W, H);
      // beats
      for (let b = Math.floor((t - 1) / beat); b < (t + ahead) / beat; b++) {
        const x = hitX + (b * beat - t) * pxs;
        g.fillStyle = b % p.beats === 0 ? 'rgb(255 255 255 / 22%)' : 'rgb(255 255 255 / 8%)';
        g.fillRect(x, 10, b % p.beats === 0 ? 2 : 1, H - 20);
      }
      g.fillStyle = 'rgb(255 255 255 / 70%)';
      g.fillRect(hitX - 1, 6, 3, H - 12);
      // the notes
      exp.forEach((e2, i) => {
        const x = hitX + (e2.t - t) * pxs;
        if (x < -20 || x > W + 20) return;
        const res = judge.results[i];
        const y = e2.hit.kind === 'stroke' ? (e2.hit.dir === 1 ? H * 0.36 : H * 0.64) : H / 2;
        g.globalAlpha = res === 'miss' ? 0.3 : res ? 0.45 : 1;
        g.fillStyle = res ? BAND_COLOR[res] : e2.hit.kind === 'stroke' ? (e2.hit.dir === 1 ? '#4cc9f0' : '#ff9f1c') : e2.hit.kind === 'cut' ? '#b6ff3b' : '#c77dff';
        if (e2.hit.kind === 'stroke') {
          const s = e2.hit.dir === 1 ? -1 : 1;
          g.beginPath();
          g.moveTo(x - 12, y - s * 8);
          g.lineTo(x, y + s * 10);
          g.lineTo(x + 12, y - s * 8);
          g.closePath();
          g.fill();
        } else if (e2.hit.kind === 'cut') {
          g.fillRect(x - 4, H * 0.28, 8, H * 0.44);
        } else {
          g.beginPath();
          g.arc(x, y, 16, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#0b1020';
          g.font = '800 16px system-ui';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(String(e2.hit.deck ?? ''), x, y + 1);
        }
        g.globalAlpha = 1;
      });
      g.font = '600 11px system-ui';
      g.textAlign = 'left';
      g.fillStyle = 'rgb(255 255 255 / 45%)';
      if (p.input === 'jog') {
        g.fillText('FORWARD', 8, H * 0.36);
        g.fillText('BACK', 8, H * 0.64);
      }
      // count-in
      if (t < 0) {
        const n = Math.ceil(-t / beat);
        g.fillStyle = '#fff';
        g.font = '800 64px system-ui';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(n <= p.beats ? String(n) : '', W * 0.6, H / 2);
      }
      // feedback
      const fb = last as { text: string; color: string; at: number } | null;
      if (fb && performance.now() - fb.at < 500) {
        g.globalAlpha = 1 - (performance.now() - fb.at) / 500;
        g.fillStyle = fb.color;
        g.font = '800 26px system-ui';
        g.textAlign = 'center';
        g.fillText(fb.text, hitX, 26);
        g.globalAlpha = 1;
      }
      const sc = judge.score();
      scoreEl.textContent = sc.points.toLocaleString();
      comboEl.textContent = combo >= 3 ? `${combo} in a row` : '';
      // the record
      if (p.input !== 'decks') {
        const R = 105;
        rg.clearRect(0, 0, 220, 220);
        rg.save();
        rg.translate(110, 110);
        rg.rotate(angle);
        rg.fillStyle = '#111';
        rg.beginPath();
        rg.arc(0, 0, R, 0, Math.PI * 2);
        rg.fill();
        rg.strokeStyle = 'rgb(255 255 255 / 8%)';
        for (let r = 40; r < R; r += 6) {
          rg.beginPath();
          rg.arc(0, 0, r, 0, Math.PI * 2);
          rg.stroke();
        }
        rg.fillStyle = '#ff3b5c';
        rg.beginPath();
        rg.arc(0, 0, 34, 0, Math.PI * 2);
        rg.fill();
        rg.fillStyle = '#fff';
        rg.fillRect(-2, -R + 4, 4, 26);
        rg.restore();
      }
      if (t > exp[exp.length - 1].t + 0.4) {
        finished = true;
        done();
        return;
      }
      requestAnimationFrame(frame);
    };

    const cleanup = () => {
      d1.onJog = prevJog;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKeyUp, true);
      for (const c of clicks)
        try {
          c.stop();
        } catch {
          // already done
        }
      if (dragA !== null) d1.jogTouch(null);
    };
    stop = () => {
      finished = true;
      cleanup();
    };

    const done = () => {
      cleanup();
      stop = null;
      const sc = judge.score();
      const isBest = keepBest(p.id, sc.points, sc.stars);
      const again = h('button', { type: 'button', class: 'btn primary' }, 'Again');
      const back2 = h('button', { type: 'button', class: 'btn' }, 'Other challenges');
      again.addEventListener('click', () => play(p));
      back2.addEventListener('click', list);
      body.replaceChildren(
        h(
          'div',
          { class: 'sc-result' },
          h('div', { class: 'sc-stars', 'aria-label': `${sc.stars} of 3 stars` }, '★'.repeat(sc.stars) + '☆'.repeat(3 - sc.stars)),
          h('h3', {}, p.name),
          h('b', { class: 'sc-big' }, sc.points.toLocaleString()),
          h('p', {}, `${Math.round(sc.accuracy * 100)}% · ${sc.counts.perfect} perfect · ${sc.counts.good} good · ${sc.counts.ok} ok · ${sc.counts.miss} missed${judge.extra ? ` · ${judge.extra} extra` : ''} · best run ${best}`),
          isBest && sc.points > 0 ? h('p', { class: 'sc-new' }, 'New best!') : null,
          h('p', { class: 'gs-note' }, `Perfect is within ${Math.round(WINDOW.perfect * 1000)} ms of the click (${BAND_POINTS.perfect} points), good within ${Math.round(WINDOW.good * 1000)} ms.`),
          h('div', { class: 'gs-actions' }, back2, again),
        ),
      );
    };
    requestAnimationFrame(frame);
  };

  list();
  const modal = openModal('Scratch challenges', body, { wide: true });
  // closing mid-challenge puts the jog back
  const watch = window.setInterval(() => {
    if (body.isConnected) return;
    clearInterval(watch);
    stop?.();
  }, 300);
  return modal;
}
