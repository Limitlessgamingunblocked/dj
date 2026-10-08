/*
 * SmartDJ set builder: anchors (artists, labels, genres), set length, energy
 * arc, transition style and discovery share in; an ordered set with energy
 * chart, transition guidance and scores out. The set can be fine-tuned (pin,
 * swap, move, remove, re-roll), loaded onto the decks track by track, saved as
 * a crate, written back as hot cues, and exported for other DJ software.
 */
import type { AppContext } from '../app/context';
import { camelotColor, formatKey } from '../analysis/keys';
import { loadSetting, saveSetting } from '../core/settings';
import type { HotCue, LibraryTrack } from '../core/types';
import { formatBpm, formatTime } from '../core/util';
import { ARCS, arcById, arcEnergy, type ArcId } from '../setbuilder/arcs';
import {
  alternativesFor,
  resolveArc,
  buildPool,
  describeSet,
  generateSet,
  normalize,
  parseAnchors,
  TRANSITION_STYLES,
  type Candidate,
  type SetOptions,
  type SetPlan,
  type TransitionStyle,
} from '../setbuilder/generate';
import { appleMusicSearchUrl, energyTen, spotifySearchUrl, toCsv, toM3U, toRekordboxXml, toTrackList, toTraktorNml, type ExportTarget } from '../setbuilder/export';
import { profileTrack, type TrackProfile } from '../setbuilder/profile';
import { STYLES, styleForAnchor } from '../setbuilder/styles';
import { clear, h, setClass } from './dom';
import { contextMenu, openModal } from './modal';
import { toast } from './toast';

interface BuilderSettings {
  anchors: string[];
  targetKind: 'minutes' | 'tracks';
  minutes: number;
  count: number;
  arc: ArcId;
  style: TransitionStyle;
  discovery: number;
  source: string;
  folder: string;
  journeyOrder: 'energy' | 'typed';
}

const DEFAULTS: BuilderSettings = {
  anchors: [],
  targetKind: 'minutes',
  minutes: 60,
  count: 15,
  arc: 'peak',
  style: 'blend',
  discovery: 0.25,
  source: 'all',
  folder: '',
  journeyOrder: 'energy',
};

const ROLE_LABEL: Record<Candidate['role'], string> = { anchor: 'Anchor', style: 'Genre', sound: 'Sound-alike', discovery: 'Discovery', library: 'Library', filler: 'Filler' };
const roleLabel = (c: Candidate) => (c.role === 'sound' && c.sound ? `≈ ${c.sound}` : ROLE_LABEL[c.role]);
const MIX_IN = 6;
const MIX_OUT = 7;

function download(name: string, text: string, mime: string): void {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    toast('Downloads are blocked here. Use Copy instead.', 'error');
  }
}

function copy(text: string, what: string): void {
  navigator.clipboard?.writeText(text).then(
    () => toast(`${what} copied`),
    () => toast('Copying is blocked here. Select the text and press Ctrl/⌘+C.', 'error'),
  );
}

function stop(el: HTMLElement): void {
  el.addEventListener('keydown', (e) => e.stopPropagation());
}

function scoreClass(score: number): string {
  return score >= 80 ? 'good' : score >= 60 ? 'ok' : 'weak';
}

export class SetBuilderPanel {
  readonly el: HTMLElement;
  private s: BuilderSettings = { ...DEFAULTS, ...loadSetting<Partial<BuilderSettings>>('setbuilder', {}) };
  private chips: HTMLElement;
  private anchorInput: HTMLInputElement;
  private suggestions: HTMLDataListElement;
  private sourceSel: HTMLSelectElement;
  private result: HTMLElement;
  private plan: SetPlan | null = null;
  private pool: Candidate[] = [];
  private seq: Candidate[] = [];
  private pinned = new Set<string>();
  private excluded = new Set<string>();
  private seed = 1;
  private cursor = -1;
  private name = '';
  private profiled = { usable: 0, waiting: 0 };

  constructor(private app: AppContext) {
    this.suggestions = h('datalist', { id: 'sb-anchor-suggestions' });
    this.anchorInput = h('input', { class: 'search', list: 'sb-anchor-suggestions', placeholder: 'Artist, label or genre — Enter to add', 'aria-label': 'Add an anchor artist, label or genre' }) as HTMLInputElement;
    this.anchorInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        this.addAnchors(this.anchorInput.value);
      } else if (e.key === 'Backspace' && !this.anchorInput.value && this.s.anchors.length) {
        this.s.anchors.pop();
        this.renderChips();
      }
    });
    this.anchorInput.addEventListener('change', () => {
      // picking from the suggestion list fires change without Enter
      if (this.anchorInput.value.trim()) this.addAnchors(this.anchorInput.value);
    });
    this.anchorInput.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') ?? '';
      if (/[,;\n]/.test(text)) {
        e.preventDefault();
        this.addAnchors(text);
      }
    });
    this.chips = h('div', { class: 'sb-chips' });
    this.sourceSel = h('select', { 'aria-label': 'Tracks to build from' }) as HTMLSelectElement;
    this.sourceSel.addEventListener('change', () => {
      this.s.source = this.sourceSel.value;
      this.save();
    });
    this.result = h('div', { class: 'sb-result' });
    this.el = h('div', { class: 'setbuilder' }, this.buildForm(), this.result);
    this.renderChips();
    this.refreshLibraryData();
    this.renderResult();
    app.library.on('changed', () => this.refreshLibraryData());
    for (const d of app.engine.decks) d.on('loaded', () => this.markLoaded());
  }

  private save(): void {
    saveSetting('setbuilder', this.s);
  }

  /* ------------------------------------------------------------------ */
  /* form                                                                 */
  /* ------------------------------------------------------------------ */

  private buildForm(): HTMLElement {
    const s = this.s;
    const field = (title: string, ...body: (Node | string)[]) => h('div', { class: 'sb-field' }, h('h3', {}, title), ...body);

    // length
    const num = h('input', { type: 'number', class: 'sb-num', 'aria-label': 'Set length' }) as HTMLInputElement;
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Set length in' });
    const kinds: [BuilderSettings['targetKind'], string][] = [
      ['minutes', 'Minutes'],
      ['tracks', 'Tracks'],
    ];
    const syncLength = () => {
      num.value = String(s.targetKind === 'minutes' ? s.minutes : s.count);
      num.min = s.targetKind === 'minutes' ? '10' : '2';
      num.max = s.targetKind === 'minutes' ? '360' : '100';
      for (const b of seg.children) setClass(b, 'active', b.getAttribute('data-k') === s.targetKind);
    };
    for (const [k, label] of kinds) {
      const b = h('button', { class: 'btn', 'data-k': k, type: 'button' }, label);
      b.addEventListener('click', () => {
        s.targetKind = k;
        syncLength();
        this.save();
      });
      seg.append(b);
    }
    num.addEventListener('change', () => {
      const v = Math.round(parseFloat(num.value));
      if (!isFinite(v)) return syncLength();
      if (s.targetKind === 'minutes') s.minutes = Math.min(360, Math.max(10, v));
      else s.count = Math.min(100, Math.max(2, v));
      syncLength();
      this.save();
    });
    stop(num);
    syncLength();

    // energy arc
    const arcs = h('div', { class: 'sb-arcs', role: 'radiogroup', 'aria-label': 'Energy arc' });
    const order = h('div', { class: 'seg sb-order', role: 'group', 'aria-label': 'Journey order' });
    const syncArcs = () => {
      for (const b of arcs.children) {
        const on = b.getAttribute('data-arc') === s.arc;
        setClass(b, 'active', on);
        b.setAttribute('aria-checked', String(on));
      }
      order.hidden = s.arc !== 'journey';
      for (const b of order.children) setClass(b, 'active', b.getAttribute('data-o') === s.journeyOrder);
    };
    this.syncArcs = syncArcs;
    for (const [id, label] of [
      ['energy', 'Deep → peak'],
      ['typed', 'In my order'],
    ] as [BuilderSettings['journeyOrder'], string][]) {
      const b = h('button', { class: 'btn small', type: 'button', 'data-o': id, title: id === 'energy' ? 'Visit the styles from the deepest to the most peak-time' : 'Visit the styles in the order you added them' }, label);
      b.addEventListener('click', () => {
        s.journeyOrder = id;
        syncArcs();
        this.save();
      });
      order.append(b);
    }
    for (const a of ARCS) {
      const pts = Array.from({ length: 33 }, (_, i) => `${(i / 32) * 100},${28 - arcEnergy(a, i / 32) * 24}`).join(' ');
      const spark = h('span', { class: 'sb-spark' });
      spark.innerHTML = `<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
      const b = h('button', { class: 'sb-arc', role: 'radio', type: 'button', 'data-arc': a.id, title: a.blurb }, spark, h('span', { class: 'nm' }, a.name));
      b.addEventListener('click', () => {
        s.arc = a.id;
        syncArcs();
        this.save();
      });
      arcs.append(b);
    }
    syncArcs();

    // transitions
    const styles = h('div', { class: 'seg sb-styles', role: 'group', 'aria-label': 'Transition style' });
    const styleNote = h('p', { class: 'note' });
    const syncStyles = () => {
      for (const b of styles.children) setClass(b, 'active', b.getAttribute('data-s') === s.style);
      styleNote.textContent = TRANSITION_STYLES[s.style].blurb;
    };
    for (const [id, def] of Object.entries(TRANSITION_STYLES) as [TransitionStyle, (typeof TRANSITION_STYLES)[TransitionStyle]][]) {
      const b = h('button', { class: 'btn', type: 'button', 'data-s': id }, def.name);
      b.addEventListener('click', () => {
        s.style = id;
        syncStyles();
        this.save();
        // timings depend on the style: refresh an existing set in place
        if (this.plan) this.update();
      });
      styles.append(b);
    }
    syncStyles();

    // discovery
    const disc = h('input', { type: 'range', min: 0, max: 50, step: 5, value: Math.round(s.discovery * 100), 'aria-label': 'Discovery share' }) as HTMLInputElement;
    const discVal = h('span', { class: 'mono sb-val' });
    const syncDisc = () => (discVal.textContent = `${Math.round(s.discovery * 100)}%`);
    disc.addEventListener('input', () => {
      s.discovery = parseInt(disc.value, 10) / 100;
      syncDisc();
      this.save();
    });
    stop(disc);
    syncDisc();

    const go = h('button', { class: 'btn primary sb-go', type: 'button' }, 'Generate set');
    go.addEventListener('click', () => this.generate(true));

    // sound-lane presets
    const presets = h('div', { class: 'sb-presets' });
    for (const st of STYLES) {
      const b = h('button', { class: 'btn small', type: 'button', title: `The ${st.name} sound: ${st.sound}, ${st.bpm[0]}–${st.bpm[1]} BPM` }, `≈ ${st.name}`);
      b.addEventListener('click', () => {
        const has = this.s.anchors.findIndex((a) => styleForAnchor(a) === st);
        if (has >= 0) this.s.anchors.splice(has, 1);
        else this.s.anchors.push(st.name);
        this.renderChips();
      });
      presets.append(b);
    }
    const all = h('button', { class: 'btn small primary', type: 'button', title: 'A Style Journey through all four sounds, deep grooves to rave peak' }, 'All four → journey');
    all.addEventListener('click', () => {
      this.s.anchors = STYLES.map((x) => x.name);
      this.s.arc = 'journey';
      this.s.journeyOrder = 'energy';
      this.syncArcs?.();
      this.renderChips();
      this.generate(true);
    });
    presets.append(all);

    return h(
      'div',
      { class: 'sb-form pane' },
      field('Anchors', this.chips, this.anchorInput, this.suggestions, h('p', { class: 'note' }, 'Artists, labels or genres that set the sound. Leave empty to use the whole library. Artists marked ≈ also match by sound, so they work even without their records in your library.'), h('div', { class: 'sb-presets-label label' }, 'In the style of'), presets),
      field('Length', h('div', { class: 'sb-row' }, seg, num)),
      field('Energy arc', arcs, order),
      field('Transitions', styles, styleNote),
      field('Discovery', h('div', { class: 'sb-row' }, disc, discVal), h('p', { class: 'note' }, 'Share of tracks by other artists that sound like your anchors, favouring ones you rarely play.')),
      field('Build from', this.sourceSel),
      go,
    );
  }

  private syncArcs: (() => void) | null = null;
  private journeyOffered = false;

  private addAnchors(text: string): void {
    for (const a of parseAnchors(text)) if (!this.s.anchors.some((x) => normalize(x) === normalize(a))) this.s.anchors.push(a);
    this.anchorInput.value = '';
    this.renderChips();
  }

  private renderChips(): void {
    clear(this.chips);
    for (const a of this.s.anchors) {
      const x = h('button', { class: 'x', type: 'button', 'aria-label': `Remove ${a}` }, '×');
      x.addEventListener('click', () => {
        this.s.anchors = this.s.anchors.filter((y) => y !== a);
        this.renderChips();
      });
      const st = styleForAnchor(a);
      this.chips.append(h('span', { class: `sb-chip${st ? ' sound' : ''}`, title: st ? `Matches by sound too: ${st.sound}, ${st.bpm[0]}–${st.bpm[1]} BPM` : undefined }, st ? `≈ ${a}` : a, x));
    }
    if (this.s.anchors.filter((a) => styleForAnchor(a)).length >= 2 && this.s.arc !== 'journey' && !this.journeyOffered) {
      this.journeyOffered = true;
      toast('Two or more artist sounds: try the “Style Journey” energy arc to travel through them.');
    }
    this.chips.hidden = !this.s.anchors.length;
    this.save();
  }

  /** Anchor suggestions and the crate list follow the library. */
  private refreshLibraryData(): void {
    const counts = new Map<string, { label: string; n: number }>();
    const add = (v: string | undefined) => {
      for (const part of (v ?? '').split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?)\s*/i)) {
        const k = normalize(part);
        if (k.length < 2) continue;
        const c = counts.get(k);
        if (c) c.n++;
        else counts.set(k, { label: part.trim(), n: 1 });
      }
    };
    for (const t of this.app.library.list()) {
      add(t.meta.artist);
      add(t.meta.label);
      add(t.meta.genre);
    }
    clear(this.suggestions);
    for (const st of STYLES) this.suggestions.append(h('option', { value: st.name }, `≈ sound: ${st.sound}`));
    for (const c of [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 300)) this.suggestions.append(h('option', { value: c.label }));
    const cur = this.s.source;
    clear(this.sourceSel);
    this.sourceSel.append(h('option', { value: 'all' }, 'Whole collection'));
    for (const c of this.app.library.crates.filter((x) => x.kind === 'crate')) this.sourceSel.append(h('option', { value: c.id }, `Crate: ${c.name}`));
    this.sourceSel.value = [...this.sourceSel.options].some((o) => o.value === cur) ? cur : 'all';
  }

  /* ------------------------------------------------------------------ */
  /* generation & editing                                                 */
  /* ------------------------------------------------------------------ */

  private options(): SetOptions {
    const s = this.s;
    return {
      anchors: [...s.anchors],
      target: s.targetKind === 'minutes' ? { kind: 'minutes', minutes: s.minutes } : { kind: 'tracks', count: s.count },
      arc: s.arc,
      style: s.style,
      discovery: s.discovery,
      seed: this.seed,
      pinned: [...this.pinned],
      exclude: [...this.excluded],
      journeyOrder: s.journeyOrder,
    };
  }

  private profiles(): TrackProfile[] {
    const lib = this.app.library;
    let tracks: LibraryTrack[] = lib.list();
    if (this.s.source !== 'all') {
      const c = lib.crate(this.s.source);
      if (c) tracks = c.trackIds.map((id) => lib.get(id)).filter((t): t is LibraryTrack => !!t);
    }
    const out: TrackProfile[] = [];
    let waiting = 0;
    for (const t of tracks) {
      const p = profileTrack(t);
      if (p) out.push(p);
      else if (t.status === 'new' || t.status === 'analyzing') waiting++;
    }
    this.profiled = { usable: out.length, waiting };
    return out;
  }

  private generate(fresh: boolean): void {
    if (this.anchorInput.value.trim()) this.addAnchors(this.anchorInput.value);
    if (fresh) {
      this.seed = 1;
      this.pinned.clear();
      this.excluded.clear();
      this.cursor = -1;
    }
    const profiles = this.profiles();
    const opts = this.options();
    const plan = generateSet(profiles, opts);
    this.pool = buildPool(profiles, opts).candidates;
    this.seq = plan.entries.map((e) => this.pool.find((c) => c.profile.id === e.profile.id) ?? e);
    this.plan = plan;
    const arc = arcById(opts.arc).name;
    this.name = plan.journey.length >= 2 && opts.arc === 'journey' ? `SmartDJ · ${plan.journey.join(' → ')}` : `SmartDJ · ${arc}${opts.anchors.length ? ` · ${opts.anchors.slice(0, 2).join(', ')}` : ''}`;
    this.renderResult();
  }

  /** Re-describe the current order after an edit (keeps the generator's warnings). */
  private update(): void {
    if (!this.plan) return;
    this.plan = describeSet(this.seq, this.options(), this.plan.warnings, this.plan.notes, this.plan.options.arc === this.s.arc ? this.plan.arcPoints : undefined);
    this.renderResult();
  }

  private move(i: number, d: number): void {
    const j = i + d;
    if (j < 0 || j >= this.seq.length) return;
    [this.seq[i], this.seq[j]] = [this.seq[j], this.seq[i]];
    this.update();
  }

  private remove(i: number): void {
    const [c] = this.seq.splice(i, 1);
    this.excluded.add(c.profile.id);
    this.pinned.delete(c.profile.id);
    if (this.cursor >= i) this.cursor--;
    this.update();
  }

  private togglePin(i: number): void {
    const id = this.seq[i].profile.id;
    if (this.pinned.has(id)) this.pinned.delete(id);
    else this.pinned.add(id);
    this.update();
  }

  private swapMenu(i: number, e: MouseEvent): void {
    if (!this.plan) return;
    const alts = alternativesFor(this.plan, this.pool, i, 8);
    if (!alts.length) {
      toast('No other tracks fit here.');
      return;
    }
    contextMenu(
      e.clientX,
      e.clientY,
      alts.map(({ candidate: c }) => ({
        label: `${c.profile.artist ? `${c.profile.artist} – ` : ''}${c.profile.title} · ${formatBpm(c.profile.bpm)} · ${c.profile.key ? formatKey(c.profile.key) : '?'}${c.role === 'discovery' ? ' · discovery' : ''}`,
        action: () => {
          this.seq[i] = c;
          this.update();
        },
      })),
    );
  }

  /* ------------------------------------------------------------------ */
  /* decks, crates, cues                                                  */
  /* ------------------------------------------------------------------ */

  private freeSideDeck(): number | null {
    const e = this.app.engine;
    const L = this.app.sideDeck('L');
    const R = this.app.sideDeck('R');
    const lp = e.deck(L).playing;
    const rp = e.deck(R).playing;
    if (!lp && !rp) return e.deck(L).loaded ? R : L;
    if (!lp) return L;
    if (!rp) return R;
    return null;
  }

  private async loadStart(): Promise<void> {
    if (!this.plan?.entries.length) return;
    const e = this.app.engine;
    const L = this.app.sideDeck('L');
    const R = this.app.sideDeck('R');
    if (e.deck(L).playing || e.deck(R).playing) {
      toast('A deck is playing. Use “Load next” to feed the set into the free deck.');
      return;
    }
    await this.app.loadTrack(L, this.plan.entries[0].profile.id);
    if (this.plan.entries[1]) await this.app.loadTrack(R, this.plan.entries[1].profile.id);
    this.cursor = Math.min(1, this.plan.entries.length - 1);
    this.renderResult();
  }

  private async loadNext(): Promise<void> {
    if (!this.plan) return;
    const next = this.cursor + 1;
    const entry = this.plan.entries[next];
    if (!entry) {
      toast('That was the last track in the set.');
      return;
    }
    const deck = this.freeSideDeck();
    if (deck === null) {
      toast('Both decks are playing. Pause the outgoing deck, then load the next track.');
      return;
    }
    await this.app.loadTrack(deck, entry.profile.id);
    this.cursor = next;
    toast(`Deck ${deck}: #${next + 1} “${entry.profile.title}” — mix in at ${formatTime(entry.cueIn)}`);
    this.renderResult();
  }

  private saveCrate(): void {
    if (!this.plan?.entries.length) return;
    const lib = this.app.library;
    let folder = lib.crates.find((c) => c.kind === 'folder' && c.parent === null && c.name === 'Sets');
    if (!folder) folder = lib.createCrate('Sets', 'folder', null);
    const crate = lib.createCrate(this.name, 'crate', folder.id);
    lib.addToCrate(
      crate.id,
      this.plan.entries.map((e) => e.profile.id),
    );
    toast(`Saved “${this.name}” in Library › Sets`);
  }

  /** Mix-in / mix-out as hot cues G and H, without touching cues the DJ set themselves. */
  private writeCues(): void {
    if (!this.plan) return;
    let written = 0;
    let skipped = 0;
    const free = (c: HotCue | null) => !c || /^MIX (IN|OUT)$/.test(c.name);
    this.plan.entries.forEach((e, i) => {
      const t = this.app.library.get(e.profile.id);
      if (!t) return;
      const want: [number, number | null, string, string][] = [
        [MIX_IN, e.cueIn, 'MIX IN', '#3ddc97'],
        [MIX_OUT, i < this.plan!.entries.length - 1 ? e.mixOut : null, 'MIX OUT', '#ff3b5c'],
      ];
      const deck = this.app.engine.decks.find((d) => d.track?.id === t.id);
      const hot = deck ? deck.hotCues.slice() : Array.from({ length: 8 }, (_, k) => t.cues.hot[k] ?? null);
      let changed = false;
      for (const [slot, pos, name, color] of want) {
        if (pos === null) continue;
        if (!free(hot[slot])) {
          skipped++;
          continue;
        }
        hot[slot] = { pos, name, color };
        changed = true;
        written++;
      }
      if (!changed) return;
      if (deck) {
        deck.hotCues = hot;
        deck.saveCues();
      } else this.app.library.updateCues(t, { cue: t.cues.cue, hot });
    });
    toast(`Wrote ${written} mix cues to hot cues G and H${skipped ? ` · ${skipped} skipped (those pads already hold your own cues)` : ''}`);
  }

  private markLoaded(): void {
    const loaded = new Set(this.app.engine.decks.filter((d) => d.track).map((d) => d.track!.id));
    for (const row of this.result.querySelectorAll<HTMLElement>('.sb-track')) setClass(row, 'loaded', loaded.has(row.dataset.id ?? ''));
  }

  /* ------------------------------------------------------------------ */
  /* export                                                               */
  /* ------------------------------------------------------------------ */

  private openExport(): void {
    const plan = this.plan;
    if (!plan?.entries.length) return;
    const nameIn = h('input', { class: 'search', value: this.name, 'aria-label': 'Playlist name' }) as HTMLInputElement;
    const folderIn = h('input', { class: 'search', value: this.s.folder, placeholder: 'e.g. /Users/you/Music/Techno  or  D:\\Music', 'aria-label': 'Music folder on your computer' }) as HTMLInputElement;
    stop(nameIn);
    stop(folderIn);
    const target = (): ExportTarget => {
      this.s.folder = folderIn.value.trim();
      this.name = nameIn.value.trim() || this.name;
      this.save();
      return { name: this.name, folder: this.s.folder };
    };
    const slug = () => this.name.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'smartdj-set';
    const files = plan.entries.filter((e) => e.profile.format !== 'SYNTH').length;
    const synth = plan.entries.length - files;
    const fmt = (label: string, note: string, make: () => void, needsFiles = true) => {
      const b = h('button', { class: 'btn', type: 'button', disabled: needsFiles && !files }, label);
      b.addEventListener('click', make);
      return h('div', { class: 'sb-export-row' }, b, h('span', { class: 'note' }, note));
    };
    const real = plan.entries.filter((e) => e.profile.format !== 'SYNTH');
    const links = h('ol', { class: 'sb-links' });
    for (const e of real) {
      links.append(
        h(
          'li',
          {},
          h('span', { class: 'nm' }, `${e.profile.artist ? `${e.profile.artist} – ` : ''}${e.profile.title}`),
          h('a', { href: spotifySearchUrl(e), target: '_blank', rel: 'noopener' }, 'Spotify'),
          h('a', { href: appleMusicSearchUrl(e), target: '_blank', rel: 'noopener' }, 'Apple Music'),
        ),
      );
    }
    const listBtn = h('button', { class: 'btn', type: 'button' }, 'Copy track list');
    listBtn.addEventListener('click', () => copy(toTrackList({ ...plan, entries: real }), 'Track list'));
    listBtn.disabled = !real.length;
    openModal(
      'Export set',
      h(
        'div',
        { class: 'sb-export' },
        h('label', { class: 'sb-label' }, 'Playlist name', nameIn),
        h('label', { class: 'sb-label' }, 'Music folder on the computer running your DJ software', folderIn),
        h('p', { class: 'note' }, 'The browser only knows file names, not where the files live. Put the folder that holds these files here so the DJ software can find them — or leave it empty and relocate the files after import.'),
        synth ? h('p', { class: 'note' }, `${synth} built-in demo track${synth > 1 ? 's are' : ' is'} generated in the browser and left out of file exports.`) : null,
        h('h3', {}, 'DJ software'),
        fmt('rekordbox XML', 'Beat grid, key and SmartDJ mix-in / mix-out memory cues. rekordbox: File › Import › rekordbox xml.', () => download(`${slug()}.xml`, toRekordboxXml(plan, target()), 'application/xml')),
        fmt('Traktor NML', 'Beat grid, key and mix cues. Import it from the Playlists tree in Traktor.', () => download(`${slug()}.nml`, toTraktorNml(plan, target()), 'application/xml')),
        fmt('M3U8 playlist', 'Serato DJ (drag onto Crates), VirtualDJ, Engine DJ and media players. Order only — no cues.', () => download(`${slug()}.m3u8`, toM3U(plan, target()), 'audio/x-mpegurl')),
        fmt('CSV cue sheet', 'Every track with start time, mix points, tempo and key moves, and transition notes.', () => download(`${slug()}.csv`, toCsv(plan), 'text/csv'), false),
        h('h3', {}, 'Streaming'),
        h('p', { class: 'note' }, real.length ? 'Copy the list into a playlist-transfer service to build it on Spotify or Apple Music, or open each track below.' : 'The demo tracks only exist in Deckhouse, so there is nothing to find on streaming services.'),
        h('div', {}, listBtn),
        links,
      ),
      { wide: false },
    );
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                            */
  /* ------------------------------------------------------------------ */

  /** For Auto DJ: the next track of the set (moving the set along), or null with no set or at its end. */
  takeNext(): string | null {
    const entry = this.plan?.entries[this.cursor + 1];
    if (!entry) return null;
    this.cursor++;
    this.renderResult();
    return entry.profile.id;
  }

  private renderResult(): void {
    clear(this.result);
    const plan = this.plan;
    if (!plan || !plan.entries.length) {
      this.result.append(
        h(
          'div',
          { class: 'empty sb-empty' },
          h('strong', {}, plan ? 'No set could be built' : 'Build a set from your library'),
          ...(plan?.warnings.length ? plan.warnings.map((w) => h('span', {}, w)) : []),
          plan ? null : 'Add anchor artists, labels or genres, choose a length and an energy arc, then Generate. SmartDJ orders the tracks for harmonic, beat-matched mixing and tells you where and how to mix each one.',
          plan ? null : h('span', { class: 'note' }, 'Try “All four → journey” for a set that travels through the four sounds — Deep & Groovy, Rolling Minimal, Bouncy Tech House and Rave Energy; the demo crate has tracks in each. Or anchor on demo artists like Kora Vance and labels like Tidal Room.'),
        ),
      );
      return;
    }
    const discoveries = plan.entries.filter((e) => e.role === 'discovery').length;
    const stat = (label: string, value: string, title?: string) => h('div', { class: 'sb-stat', title }, h('span', { class: 'v' }, value), h('span', { class: 'l' }, label));
    const stats = h(
      'div',
      { class: 'sb-stats' },
      stat('Tracks', String(plan.entries.length)),
      stat('Length', formatTime(plan.duration)),
      stat('BPM', plan.bpmMin === plan.bpmMax ? formatBpm(plan.bpmMin) : `${Math.round(plan.bpmMin)}–${Math.round(plan.bpmMax)}`),
      stat('Harmonic', `${plan.harmonicScore}`, 'Average key compatibility of the transitions, out of 100'),
      stat('Flow', `${plan.flowScore}`, 'Average transition score (key, tempo and energy fit), out of 100'),
      stat('Discoveries', String(discoveries)),
    );
    const btn = (label: string, fn: () => void, cls = 'btn', title?: string) => {
      const b = h('button', { class: cls, type: 'button', title }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const next = plan.entries[this.cursor + 1];
    const actions = h(
      'div',
      { class: 'sb-actions' },
      btn('Re-roll', () => {
        this.seed++;
        this.generate(false);
      }, 'btn', 'Another set with the same settings, keeping pinned tracks'),
      btn('Load first two', () => void this.loadStart(), 'btn primary', 'Load tracks 1 and 2 onto the left and right decks'),
      btn(next ? `Load next · #${this.cursor + 2}` : 'Load next', () => void this.loadNext(), 'btn', next ? `Load “${next.profile.title}” onto the deck that isn't playing` : undefined),
      h('span', { class: 'spacer' }),
      btn('Save as crate', () => this.saveCrate()),
      btn('Write mix cues', () => this.writeCues(), 'btn', 'Store each track’s mix-in and mix-out points on hot cues G and H'),
      btn('Export…', () => this.openExport(), 'btn primary'),
    );
    const extra: HTMLElement[] = [];
    if (this.excluded.size) {
      const restore = btn(`Bring back ${this.excluded.size} removed`, () => {
        this.excluded.clear();
        toast('Removed tracks can appear again on the next re-roll');
        this.renderResult();
      }, 'btn small ghost');
      extra.push(restore);
    }
    if (this.profiled.waiting) extra.push(h('span', { class: 'note' }, `${this.profiled.waiting} track${this.profiled.waiting > 1 ? 's are' : ' is'} still being analysed and not used yet.`));
    this.result.append(
      h('div', { class: 'sb-head' }, h('h3', { class: 'sb-title' }, this.name), stats),
      ...plan.notes.map((w) => h('div', { class: 'sb-info', role: 'note' }, '≈ ', w)),
      ...plan.warnings.map((w) => h('div', { class: 'sb-warn', role: 'note' }, '⚠ ', w)),
      this.chart(plan),
      actions,
    );
    if (extra.length) this.result.append(h('div', { class: 'sb-row' }, ...extra));
    this.result.append(this.list(plan));
    this.markLoaded();
  }

  /** Energy across the set: the arc's target as a line, each track as a dot on one energy axis. */
  private chart(plan: SetPlan): HTMLElement {
    // match the drawing width to the panel so axis text stays readable on phones
    const W = Math.round(Math.min(900, Math.max(320, (this.result.clientWidth || 664) - 24)));
    const H = 150;
    const L = 34;
    const R = 10;
    const T = 10;
    const B = 22;
    const total = Math.max(1, plan.duration);
    const x = (sec: number) => L + (sec / total) * (W - L - R);
    const y = (e: number) => T + (1 - e) * (H - T - B);
    const arc = resolveArc(plan.options, plan.arcPoints);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'sb-chart-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Energy across the set compared with the ${arc.name} arc`);
    const el = (tag: string, attrs: Record<string, string | number>) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      svg.append(n);
      return n;
    };
    for (const [v, label] of [
      [0, '1'],
      [0.5, '5'],
      [1, '10'],
    ] as [number, string][]) {
      el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' });
      el('text', { x: L - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }).textContent = label;
    }
    const step = total > 3600 ? 1200 : total > 1500 ? 600 : total > 600 ? 300 : 60;
    for (let s = 0; s <= total + 1; s += step) el('text', { x: x(s), y: H - 6, class: 'tick', 'text-anchor': s === 0 ? 'start' : 'middle' }).textContent = formatTime(s);
    const pts = Array.from({ length: 81 }, (_, i) => `${x((i / 80) * total)},${y(arcEnergy(arc, i / 80))}`).join(' ');
    el('polyline', { points: pts, class: 'target' });
    const tip = h('div', { class: 'sb-tip', hidden: true });
    const wrap = h('div', { class: 'sb-chart' });
    plan.entries.forEach((e, i) => {
      const len = i < plan.entries.length - 1 ? plan.entries[i + 1].startAt - e.startAt : plan.duration - e.startAt;
      const cx = x(e.startAt + len / 2);
      const cy = y(e.level);
      el('line', { x1: x(e.startAt) + 1, x2: x(e.startAt + len) - 1, y1: cy, y2: cy, class: 'span' });
      const dot = el('circle', { cx, cy, r: 5, class: `dot${e.role === 'discovery' ? ' disc' : ''}` });
      const hit = el('circle', { cx, cy, r: 12, class: 'hit', tabindex: 0 });
      const show = () => {
        tip.hidden = false;
        tip.textContent = `#${i + 1} ${e.profile.title}${e.profile.artist ? ` — ${e.profile.artist}` : ''} · energy ${energyTen(e.level)} (arc ${energyTen(e.target)}) · ${formatBpm(e.profile.bpm)} BPM · ${e.profile.key ? formatKey(e.profile.key) : 'key ?'} · starts ${formatTime(e.startAt)}`;
        const bw = wrap.clientWidth || W;
        const px = (cx / W) * bw;
        tip.style.left = `${Math.min(Math.max(px, 90), bw - 90)}px`;
        tip.style.top = `${(cy / H) * (wrap.clientHeight || H)}px`;
        dot.classList.add('on');
      };
      const hide = () => {
        tip.hidden = true;
        dot.classList.remove('on');
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
    });
    const legend = h(
      'div',
      { class: 'sb-legend' },
      h('span', {}, h('i', { class: 'lg-target' }), `${arc.name} target`),
      h('span', {}, h('i', { class: 'lg-dot' }), 'Track energy'),
      h('span', {}, h('i', { class: 'lg-dot disc' }), 'Discovery'),
      h('span', { class: 'note' }, 'Energy is relative to the tracks you build from (1–10).'),
    );
    wrap.append(svg, tip);
    return h('div', { class: 'sb-chart-box' }, legend, wrap);
  }

  private list(plan: SetPlan): HTMLElement {
    const ol = h('ol', { class: 'sb-list' });
    plan.entries.forEach((e, i) => {
      const p = e.profile;
      const iconBtn = (label: string, title: string, fn: (ev: MouseEvent) => void, disabled = false, pressed?: boolean) => {
        const b = h('button', { class: 'btn small icon', type: 'button', title, 'aria-label': title, disabled, 'aria-pressed': pressed === undefined ? undefined : String(pressed) }, label);
        b.addEventListener('click', (ev) => fn(ev as MouseEvent));
        return b;
      };
      const energyBar = h(
        'span',
        { class: 'sb-energy', title: `Energy ${energyTen(e.level)} · the arc asks for ${energyTen(e.target)}` },
        h('span', { class: 'fill', style: { width: `${e.level * 100}%` } }),
        h('span', { class: 'mark', style: { left: `${e.target * 100}%` } }),
      );
      const row = h(
        'li',
        { class: `sb-track${i <= this.cursor ? ' done' : ''}`, 'data-id': p.id },
        h('span', { class: 'idx mono' }, String(i + 1)),
        h('span', { class: 'mono start' }, formatTime(e.startAt)),
        p.key ? h('span', { class: 'chip key', style: { background: camelotColor(p.key) }, title: p.key.name }, formatKey(p.key)) : h('span', { class: 'chip' }, '—'),
        h('span', { class: 'who' }, h('span', { class: 'title' }, p.title), h('span', { class: 'artist' }, p.artist || '—')),
        h('span', { class: `sb-role ${e.role}`, title: e.why }, e.pinned ? `📌 ${roleLabel(e)}` : roleLabel(e)),
        h('span', { class: 'mono bpm' }, formatBpm(p.bpm)),
        energyBar,
        h(
          'span',
          { class: 'tools' },
          iconBtn('📌', e.pinned ? 'Unpin (a re-roll may replace it)' : 'Pin (keep it when re-rolling)', () => this.togglePin(i), false, e.pinned),
          iconBtn('⇄', 'Swap for a similar track', (ev) => this.swapMenu(i, ev)),
          iconBtn('↑', 'Move up', () => this.move(i, -1), i === 0),
          iconBtn('↓', 'Move down', () => this.move(i, 1), i === plan.entries.length - 1),
          iconBtn('✕', 'Remove from the set', () => this.remove(i)),
        ),
      );
      row.addEventListener('dblclick', () => {
        const t = this.app.library.get(p.id);
        if (t) this.app.select(t);
      });
      ol.append(row);
      const t = plan.transitions[i];
      if (!t) return;
      const pitch = Math.abs(t.pitchPct) < 0.05 ? '±0%' : `${t.pitchPct > 0 ? '+' : '−'}${Math.abs(t.pitchPct).toFixed(1)}%`;
      ol.append(
        h(
          'li',
          { class: 'sb-trans', 'aria-label': `Transition ${i + 1} to ${i + 2}` },
          h('span', { class: `sb-score ${scoreClass(t.score)}`, title: 'Transition score: key, tempo and energy fit' }, String(t.score)),
          h(
            'span',
            { class: 'facts' },
            h('span', {}, `${t.bars}-bar ${plan.options.style === 'cut' ? 'cut' : 'blend'} at ${formatTime(t.outAt)}`),
            h('span', { class: 'mono' }, `${formatBpm(t.bpmFrom)} → ${formatBpm(t.bpmTo)} (${pitch}${t.tempoMode !== 'direct' ? `, ${t.tempoMode} time` : ''})`),
            h('span', { class: `keymove ${t.key.kind}` }, `${t.keyFrom ? formatKey(t.keyFrom) : '?'} → ${t.keyTo ? formatKey(t.keyTo) : '?'} ${t.key.label}`),
            h('span', {}, `energy ${t.energyDelta >= 0.05 ? '↗' : t.energyDelta <= -0.05 ? '↘' : '→'}`),
          ),
          h('span', { class: 'tip' }, t.tip),
        ),
      );
    });
    return ol;
  }
}
