/*
 * Word-exact lyrics for the demo tracks' synthesised vocal chops ("yeah",
 * "hey!", "ohh"). Mirrors the arrangement in audio/synth.ts, so the kinetic
 * typography can be tried without importing anything.
 */
import type { DemoSpec } from '../../src/core/types';
import type { Lyrics, LyricLine } from '../../src/lyrics/lyrics';

export function demoLyrics(spec: DemoSpec): Lyrics | null {
  if (spec.style !== 'techhouse' && spec.style !== 'rave' && spec.style !== 'rolling') return null;
  const beat = 60 / spec.bpm;
  const bar = beat * 4;
  const offset = 0.05;
  const B = spec.bars;
  const within = (from: number, to: number) => (b: number) => b >= Math.round(B * from) && b < Math.round(B * to);
  const groove = within(0.125, 0.5);
  const breakdown = within(0.5, 0.625);
  const drop = within(0.625, 0.875);
  const chops: { t: number; d: number; text: string; hook: boolean; phrase: number }[] = [];
  for (let b = 0; b < B; b++) {
    const t0 = offset + b * bar;
    const phrase = Math.floor(b / 4);
    if (spec.style === 'techhouse') {
      if ((groove(b) || drop(b)) && b % 2 === 1) chops.push(drop(b) ? { t: t0 + beat * 3.5, d: beat * 0.45, text: 'hey!', hook: true, phrase } : { t: t0 + beat * 3.5, d: beat * 0.7, text: 'yeah', hook: false, phrase });
      if (breakdown(b) && b % 2 === 0) chops.push({ t: t0, d: beat * 1.8, text: 'ohh', hook: false, phrase });
    } else if (spec.style === 'rave') {
      if (drop(b)) for (const q of [1.5, 3.5]) chops.push({ t: t0 + q * beat, d: beat * 0.45, text: 'hey!', hook: true, phrase: Math.floor(b / 2) });
      if (breakdown(b) && b % 2 === 1) chops.push({ t: t0, d: beat * 1.8, text: 'ohh', hook: false, phrase });
    } else if ((groove(b) || drop(b)) && b % 4 === 2) chops.push({ t: t0 + beat * 0.5, d: beat * 1.8, text: 'oh', hook: false, phrase });
  }
  if (!chops.length) return null;
  const lines: LyricLine[] = [];
  for (const c of chops) {
    const cur = lines[lines.length - 1];
    const same = cur && (cur as LyricLine & { phrase?: number }).phrase === c.phrase && cur.hook === c.hook;
    if (same) {
      cur.words.push({ t: c.t, end: c.t + c.d, text: c.text });
      cur.text += ` ${c.text}`;
      cur.end = c.t + c.d;
    } else {
      const l: LyricLine & { phrase?: number } = { t: c.t, end: c.t + c.d, text: c.text, words: [{ t: c.t, end: c.t + c.d, text: c.text }], hook: c.hook, phrase: c.phrase };
      lines.push(l);
    }
  }
  for (const l of lines) delete (l as LyricLine & { phrase?: number }).phrase;
  // lines stay up through their phrase (up to two bars after the last chop), never past the next line
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1]?.t ?? Infinity;
    l.end = Math.min(next, l.end + bar * 2);
    const w = l.words[l.words.length - 1];
    w.end = Math.max(w.t + 0.05, Math.min(w.end, l.end));
  }
  return { source: 'demo', timing: 'word', offset: 0, lines, raw: lines.map((l) => l.text).join('\n') };
}
