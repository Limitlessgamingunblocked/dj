/*
 * Recording in the app (Sections 11, 12): the REC button, the count-in,
 * what the camera does while recording, saving to My Sets, and the logs the
 * replay buffer and recordings cut their tracklists and markers from.
 *
 *   rec.toggle    REC (Shift+R)
 *   replay.save   SAVE THAT MIX (Shift+S)
 *   replay.clip   CLIP IT (Shift+C)
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { ControlRegistry } from '../core/controls';
import type { Career } from '../game/Career';
import { nameService } from '../name/NameService';
import { nameStyleFor } from '../name/venueStyles';
import { MarkerLog, TracklistLog, type NowTrack } from '../media/logs';
import { persistStorage } from '../media/MediaStore';
import { SetLibrary } from '../media/sets';
import { DEFAULT_RECORD, Studio, type RecordSettings, type Take } from '../media/Studio';
import type { Recording } from '../core/models';
import type { Stage } from '../three/Stage';
import type { ViewId } from '../three/CameraRig';
import { openRecordPanel, type ReplaySettings } from '../ui/RecordPanel';
import { openSetView } from '../ui/SetView';
import { openTrimEditor } from '../ui/TrimEditor';
import { h, setClass, setText } from '../ui/dom';
import { toast } from '../ui/toast';
import { DEFAULT_OVERLAYS } from '../media/Compositor';
import { RESOLUTIONS } from '../media/MediaWriter';
import { defaultReplay, Replay, replayBytes, type ReplaySnap } from '../media/Replay';
import { muxBuffer, renderClip } from '../media/reencode';
import type { DemuxedVideo } from '../media/demux';

export interface DeskHost {
  engine: AudioEngine;
  stage: Stage;
  career: Career;
  reg: ControlRegistry;
  venue(): { id: string; name: string };
  venueName(id: string): string;
  /** the audio clock of what's on screen (heard now) */
  pictureTime(): number;
  /** what the set is: "Peak time" in a gig, "Free play" otherwise */
  setLabel(): string;
  record: { get(): unknown; save(s: RecordSettings): void };
  replay: { get(): unknown; save(r: ReplaySettings): void };
  director: { on(): boolean; set(on: boolean): void; goTo(v: ViewId): void };
  /** bar lines as they're heard (the beat clock) */
  onBar(fn: () => void): void;
  /** open the trim editor */
  trim(r: Recording, at?: number): void;
}

/** the replay buffer's saved settings, defaults by device */
export function cleanReplay(raw: unknown): ReplaySettings {
  const d = { ...defaultReplay(), clip: 30 as 30 | 60 };
  if (typeof raw !== 'object' || !raw) return d;
  const r = raw as Record<string, unknown>;
  if ([0, 2, 5, 10, 15, 30].includes(r.minutes as number)) d.minutes = r.minutes as number;
  if (typeof r.video === 'boolean') d.video = r.video;
  if (r.clip === 30 || r.clip === 60) d.clip = r.clip;
  return d;
}

/** saved settings over the defaults, unknown values dropped */
export function cleanRecord(raw: unknown): RecordSettings {
  const d = structuredClone(DEFAULT_RECORD);
  if (typeof raw !== 'object' || !raw) return d;
  const r = raw as Record<string, unknown>;
  const pick = <T>(v: unknown, ok: readonly T[], fb: T): T => (ok.includes(v as T) ? (v as T) : fb);
  d.mode = pick(r.mode, ['audio', 'video', 'booth'] as const, d.mode);
  d.resolution = pick(r.resolution, RESOLUTIONS.map((x) => x.id), d.resolution);
  d.fps = pick(r.fps, [30, 60] as const, d.fps);
  d.aspect = pick(r.aspect, ['16:9', '9:16', '1:1'] as const, d.aspect);
  d.director = pick(r.director, ['auto', 'locked', 'live'] as const, d.director);
  if (typeof r.countdown === 'boolean') d.countdown = r.countdown;
  const o = (typeof r.overlays === 'object' && r.overlays ? r.overlays : {}) as Record<string, unknown>;
  for (const k of ['watermark', 'venueDate', 'nowPlaying', 'tracklist', 'vhs'] as const) if (typeof o[k] === 'boolean') d.overlays[k] = o[k] as boolean;
  d.overlays.corner = pick(o.corner, ['tl', 'tr', 'bl', 'br'] as const, DEFAULT_OVERLAYS.corner);
  if (typeof o.style === 'string' && /^[a-z_]{2,20}$/.test(o.style)) d.overlays.style = o.style as RecordSettings['overlays']['style'];
  return d;
}

export class RecordingDesk {
  readonly studio: Studio;
  readonly sets: SetLibrary;
  readonly tracklist = new TracklistLog();
  readonly markers = new MarkerLog();
  /** bar lines heard (audio clock), the last hour */
  readonly bars: number[] = [];
  readonly replay: Replay;
  replaySettings: ReplaySettings;
  settings: RecordSettings;
  private saving = false;
  private countEl: HTMLElement;
  private stream: MediaStreamAudioDestinationNode | null = null;
  /** the director's state before a recording changed it */
  private before: { director: boolean } | null = null;
  /** a gig's grade, if one finished while recording */
  private grade: Recording['grade'] = null;
  private slow = 0;
  private vibeHist: number[] = [];

  constructor(private host: DeskHost) {
    this.settings = cleanRecord(host.record.get());
    this.sets = new SetLibrary(host.career.saves);
    const e = host.engine;
    this.studio = new Studio({
      capture: e.capture,
      frameHooks: host.stage.frameHooks,
      setRecordSize: (s) => host.stage.setRecordSize(s),
      audioTime: () => e.ctx.currentTime,
      pictureTime: () => host.pictureTime(),
      overlay: () => {
        const v = host.venue();
        return { name: nameService.named ? nameService.text : '', venueStyle: nameStyleFor(v.id).booth, venue: v.name };
      },
      tracklist: this.tracklist,
      markers: this.markers,
      beat: () => this.beat(),
      masterStream: () => {
        if (!this.stream) {
          this.stream = e.ctx.createMediaStreamDestination();
          e.mixer.masterOut.connect(this.stream);
        }
        return this.stream.stream;
      },
    });
    this.replay = new Replay(e.capture, host.stage.frameHooks, () => host.pictureTime());
    this.replaySettings = cleanReplay(host.replay.get());
    void this.replay.configure(this.replaySettings.minutes, this.replaySettings.video);
    host.onBar(() => {
      this.bars.push(host.pictureTime());
      if (this.bars.length > 4000) this.bars.splice(0, 1000);
    });
    this.countEl = h('div', { class: 'rec-count', 'aria-live': 'assertive', hidden: true });
    host.stage.el.append(this.countEl);
    const reg = host.reg;
    reg.register({ id: 'rec.toggle', label: 'Record: start / stop', kind: 'button', press: () => void this.toggle(), lit: () => (this.studio.state === 'recording' ? '#ff2e2e' : this.studio.state === 'countdown' ? { color: '#ff2e2e', blink: true, level: 1 } : false) });
    reg.register({ id: 'replay.save', label: 'Save That Mix (the replay buffer)', kind: 'button', press: () => void this.saveMix(), lit: () => (this.replay.on ? '#3ddc97' : false) });
    reg.register({ id: 'replay.clip', label: 'Clip It (the last 30 or 60 seconds, vertical)', kind: 'button', press: () => void this.clip(), lit: () => (this.replay.on ? '#ff2e88' : false) });
    window.addEventListener('beforeunload', (ev) => {
      if (this.studio.state === 'recording') {
        ev.preventDefault();
        ev.returnValue = '';
      }
    });
  }

  /** the master's next downbeat and beat length (audio clock) */
  private beat(): { downbeat: number; period: number } | null {
    const d = this.host.engine.masterDeck;
    if (!d?.playing || !d.analysis || d.bpm <= 0) return null;
    const period = 60 / d.bpm;
    const bp = d.beatPosition();
    const toBar = (4 - (((bp % 4) + 4) % 4)) % 4;
    return { downbeat: this.host.engine.ctx.currentTime + toBar * period, period };
  }

  /** the track the room hears most right now */
  nowTrack(): NowTrack | null {
    const e = this.host.engine;
    let best: NowTrack | null = null;
    let loud = 0.08;
    for (let i = 0; i < e.deckCount; i++) {
      const d = e.decks[i];
      if (!d.playing || !d.track) continue;
      const ch = e.channels[i];
      const lvl = ch.state.fader * ch.xfGain;
      if (lvl > loud) {
        loud = lvl;
        best = { id: d.track.id, title: d.track.meta.title || d.track.fileName, artist: d.track.meta.artist || '' };
      }
    }
    return best;
  }

  get recording(): { on: boolean; elapsed: number; counting: boolean; buffer: boolean } {
    return { on: this.studio.state === 'recording', elapsed: this.studio.elapsed, counting: this.studio.state === 'countdown', buffer: this.replay.on };
  }

  /** every frame, with the vibe (0..1) */
  update(dt: number, vibe = 0): void {
    this.slow += dt;
    if (this.slow >= 0.25) {
      this.slow = 0;
      const t = this.host.pictureTime();
      this.tracklist.update(t, this.nowTrack());
      // a vibe spike: up 12 points or more within about six seconds (Section 12.5)
      this.vibeHist.push(vibe);
      if (this.vibeHist.length > 24) this.vibeHist.shift();
      if (vibe - Math.min(...this.vibeHist) >= 0.12 && vibe > 0.5) {
        this.markers.add(t, 'vibe', 'Vibe spike', 20);
        this.vibeHist.length = 0;
      }
    }
    const c = this.studio.count;
    this.countEl.hidden = c === null;
    if (c !== null && this.countEl.textContent !== String(c)) {
      setText(this.countEl, String(c));
      setClass(this.countEl, 'pulse', false);
      void this.countEl.offsetWidth;
      setClass(this.countEl, 'pulse', true);
    }
  }

  /** a moment for the smart markers (Section 12.5) */
  mark(kind: Recording['markers'][number]['kind'], label: string): void {
    this.markers.add(this.host.pictureTime(), kind, label);
  }

  /** a gig ended: its grade goes on the recording running over it */
  gigFinished(grade: Recording['grade']): void {
    this.grade = grade;
  }

  /** REC: one tap starts (with the count-in if it's on), the next stops and saves */
  async toggle(): Promise<void> {
    const st = this.studio.state;
    if (st === 'recording' || st === 'countdown') return this.stop();
    if (st !== 'idle') return;
    if (!this.host.engine.capture.supported) {
      toast('Recording isn’t available in this browser.', 'error');
      return;
    }
    await this.host.engine.resume();
    this.applyCamera();
    this.grade = null;
    this.replay.wantStills = true;
    const ok = await this.studio.start(this.settings);
    if (!ok) {
      this.replay.wantStills = false;
      this.restoreCamera();
      if (this.studio.state === 'idle') toast('Couldn’t start recording here.', 'error');
      return;
    }
    void persistStorage();
    toast(this.settings.mode === 'audio' ? 'Recording the master (24-bit / 48 kHz)' : `Recording ${this.settings.resolution} · ${this.settings.fps} fps · ${this.settings.aspect}`);
  }

  async stop(): Promise<void> {
    const take = await this.studio.stop();
    this.replay.wantStills = false;
    this.restoreCamera();
    if (!take) return;
    if (take.dropped > take.seconds * 3) toast(`Your machine dropped ${take.dropped} frames: try 30 fps or a lower resolution next time.`);
    await this.keep(take, 'rec', 'Your set');
  }

  /** save a take to My Sets and open it */
  async keep(take: Take, source: Recording['source'], headline: string | null): Promise<Recording | null> {
    const v = this.host.venue();
    try {
      const strip = await this.strip(take.start, take.start + take.seconds);
      const rec = await this.sets.add({
        take,
        bars: this.bars.filter((b) => b >= take.start && b <= take.start + take.seconds).map((b) => b - take.start),
        strip,
        venueId: v.id,
        venueName: v.name,
        title: `${v.name} · ${this.host.setLabel()}`,
        grade: this.grade,
        source,
        cover: { name: nameService.named ? nameService.text : '', nameStyle: nameStyleFor(v.id).booth, venueId: v.id, venue: v.name, date: take.date, seconds: take.seconds, sub: this.host.setLabel() },
      });
      if (headline) this.view(rec, headline);
      return rec;
    } catch (e) {
      toast(`Couldn’t save the recording: ${(e as Error).message}`, 'error');
      return null;
    }
  }

  view(r: Recording, headline?: string): void {
    openSetView(r, { sets: this.sets, djName: nameService.named ? nameService.text : '', venueName: (id) => this.host.venueName(id), headline, trim: (x, at) => this.host.trim(x, at) });
  }

  /** a film strip of the stills between two times (up to 120, 12 across), for the trim editor */
  private async strip(from: number, to: number): Promise<{ blob: Blob; every: number } | null> {
    const stills = this.replay.stillsBetween(from, to);
    if (!stills.length) return null;
    const n = Math.min(120, stills.length);
    const pick = Array.from({ length: n }, (_, i) => stills[Math.floor((i * stills.length) / n)]);
    const every = (to - from) / n;
    const c = document.createElement('canvas');
    const tw = 160;
    const th = 90;
    c.width = tw * Math.min(12, n);
    c.height = th * Math.ceil(n / 12);
    const g = c.getContext('2d')!;
    for (let i = 0; i < n; i++) {
      try {
        const bmp = await createImageBitmap(pick[i].blob);
        g.drawImage(bmp, (i % 12) * tw, Math.floor(i / 12) * th, tw, th);
        bmp.close();
      } catch {
        /* a bad still: leave its tile dark */
      }
    }
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.75));
    return blob ? { blob, every } : null;
  }

  /* ------------------------------------------------------------------ */
  /* the replay buffer (Section 12)                                       */
  /* ------------------------------------------------------------------ */

  /** a take from a buffer snapshot (video muxed with its audio when the buffer keeps video) */
  private async takeFromSnap(snap: ReplaySnap): Promise<Take> {
    const video = snap.video ? await muxBuffer(snap.video, snap.pcm, snap.rate) : undefined;
    const mid = snap.stills[Math.floor(snap.stills.length / 2)];
    return {
      mode: snap.video ? 'video' : 'audio',
      start: snap.from,
      seconds: snap.to - snap.from,
      date: new Date(Date.now() - (this.host.engine.ctx.currentTime - snap.from) * 1000),
      pcm: new Blob([snap.pcm as BlobPart]),
      rate: snap.rate,
      video,
      aspect: '16:9',
      tracklist: this.tracklist.window(snap.from, snap.to),
      markers: this.markers.window(snap.from, snap.to),
      thumb: mid?.blob,
      dropped: 0,
    };
  }

  /** SAVE THAT MIX: the whole buffer into My Sets. Returns the set once it's saved. */
  async saveMix(quiet = false): Promise<Recording | null> {
    if (!this.replay.on) {
      if (!quiet) toast('The replay buffer is off: turn it on in the recording settings (▾ next to REC).');
      return null;
    }
    if (this.saving) return null;
    const snap = this.replay.snapshot();
    if (!snap) {
      if (!quiet) toast('Nothing in the buffer yet.');
      return null;
    }
    if (!quiet) toast('Mix saved. That one’s a keeper.');
    this.saving = true;
    try {
      return await this.keep(await this.takeFromSnap(snap), 'buffer', null);
    } catch (e) {
      toast(`Couldn’t save the mix: ${(e as Error).message}`, 'error');
      return null;
    } finally {
      this.saving = false;
    }
  }

  /** CLIP IT: the last 30 or 60 seconds as a vertical clip, with your overlays */
  async clip(): Promise<Recording | null> {
    if (!this.replay.on) {
      toast('The replay buffer is off: turn it on in the recording settings (▾ next to REC).');
      return null;
    }
    const secs = this.replaySettings.clip;
    const snap = this.replay.snapshot(secs);
    if (!snap) {
      toast('Nothing in the buffer yet.');
      return null;
    }
    toast(`Clipped: the last ${Math.round(snap.to - snap.from)} seconds, vertical. It’ll be in My Sets in a moment.`);
    try {
      const v = this.host.venue();
      const video: DemuxedVideo | null = snap.video
        ? { codec: snap.video.config.codec, width: snap.video.plan.width, height: snap.video.plan.height, description: snap.video.config.description ? new Uint8Array(snap.video.config.description as ArrayBuffer) : undefined, chunks: snap.video.chunks.map((c) => ({ ...c, t: c.t - snap.from })) }
        : null;
      const stills = [];
      for (const st of snap.stills) {
        try {
          stills.push({ t: st.t - snap.from, img: await createImageBitmap(st.blob) });
        } catch {
          /* skip */
        }
      }
      const len = snap.to - snap.from;
      const res = await renderClip({
        from: 0,
        to: len,
        video,
        stills,
        pcm: snap.pcm,
        rate: snap.rate,
        aspect: '9:16',
        resolution: '720p',
        fps: 30,
        overlays: this.settings.overlays,
        overlay: { name: nameService.named ? nameService.text : '', venueStyle: nameStyleFor(v.id).booth, venue: v.name, date: new Date() },
        tracklist: this.tracklist.window(snap.from, snap.to),
        fadeIn: 0.3,
        fadeOut: 1,
      });
      for (const st of stills) st.img.close();
      const take: Take = {
        mode: 'video',
        start: snap.from,
        seconds: len,
        date: new Date(),
        pcm: new Blob([res.pcm as BlobPart]),
        rate: snap.rate,
        video: res.video,
        aspect: '9:16',
        tracklist: this.tracklist.window(snap.from, snap.to),
        markers: this.markers.window(snap.from, snap.to),
        thumb: snap.stills.at(-1)?.blob,
        dropped: 0,
      };
      return await this.keep(take, 'clip', null);
    } catch (e) {
      toast(`Couldn’t make the clip: ${(e as Error).message}`, 'error');
      return null;
    }
  }

  /** save the buffer, then open the trim editor on the latest moment with this label */
  async replayMoment(label: string): Promise<void> {
    const rec = await this.saveMix(true);
    if (!rec) {
      toast('Nothing to replay: the replay buffer is off or empty.');
      return;
    }
    const m = [...rec.markers].reverse().find((x) => x.label === label) ?? rec.markers.at(-1);
    this.host.trim(rec, m?.at);
  }

  /** the trim editor on a saved set (Section 12.4) */
  async trim(r: Recording, at?: number): Promise<void> {
    await openTrimEditor(
      r,
      {
        sets: this.sets,
        ctx: this.host.engine.ctx,
        djName: nameService.named ? nameService.text : '',
        venueName: (id) => this.host.venueName(id),
        venueStyle: (id) => nameStyleFor(id).booth,
        overlays: this.settings.overlays,
        keep: (take, from, a, b) => this.keepTrim(take, from, a, b),
      },
      at,
    );
  }

  /** a clip cut from a saved set becomes a set of its own */
  private async keepTrim(take: Take, from: Recording, a: number, b: number): Promise<Recording | null> {
    const venueName = this.host.venueName(from.venue);
    try {
      return await this.sets.add({
        take,
        venueId: from.venue,
        venueName,
        title: `${from.title} (clip)`.slice(0, 80),
        grade: from.grade,
        source: 'trim',
        cover: { name: nameService.named ? nameService.text : '', nameStyle: nameStyleFor(from.venue).booth, venueId: from.venue, venue: venueName, date: new Date(from.date), seconds: take.seconds, sub: 'Clip' },
        bars: from.bars.filter((x) => x >= a && x <= b).map((x) => x - a),
      });
    } catch (e) {
      toast(`Couldn’t save the clip: ${(e as Error).message}`, 'error');
      return null;
    }
  }

  setReplay(r: ReplaySettings): void {
    this.replaySettings = r;
    this.host.replay.save(r);
    void this.replay.configure(r.minutes, r.video);
  }

  /** the camera while recording: auto-cinematic, one locked angle, your own switching, or the booth cam */
  private applyCamera(): void {
    const d = this.host.director;
    this.before = { director: d.on() };
    if (this.settings.mode === 'booth') {
      d.set(false);
      d.goTo('booth');
    } else if (this.settings.director === 'auto') d.set(true);
    else d.set(false);
  }

  private restoreCamera(): void {
    if (!this.before) return;
    this.host.director.set(this.before.director);
    this.before = null;
  }

  openSettings(): void {
    openRecordPanel({
      settings: this.settings,
      replay: this.replaySettings,
      replayBytes: (m, v) => replayBytes(m, v, this.host.engine.capture.rate),
      change: (s) => {
        this.settings = s;
        this.host.record.save(s);
      },
      changeReplay: (r) => this.setReplay(r),
      start: () => void this.toggle(),
      recording: this.studio.state !== 'idle',
    });
  }
}
