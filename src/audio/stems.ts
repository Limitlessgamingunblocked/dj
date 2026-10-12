/*
 * Live stems on each channel: drums, bass, melody and vocals, each with its
 * own level. This is not true source separation (that needs a trained model
 * we don't ship): it's a split by filters that always adds back up to the
 * original, so with every stem at full the sound is untouched.
 *   bass    the lows (under 150 Hz): the bassline and the kick's weight
 *   drums   the highs (over 5.5 kHz): hats, cymbals, the snare's crack
 *   vocals  the centre of the mids (what's the same in both ears, 200 Hz to
 *           4 kHz): where a lead vocal usually sits
 *   melody  everything else: the mids that are wide in the stereo field
 * Each split is "the band" and "the input minus the band", so nothing is
 * lost or doubled where the bands meet. Untouched, the channel takes the dry
 * path and the split is bypassed.
 */
export const STEMS = ['drums', 'bass', 'melody', 'vocals'] as const;
export type Stem = (typeof STEMS)[number];

export const STEM_LABEL: Record<Stem, string> = { drums: 'Drums', bass: 'Bass', melody: 'Melody', vocals: 'Vocals' };
export const STEM_INFO: Record<Stem, string> = {
  drums: 'The highs: hats, cymbals and the snare’s crack',
  bass: 'The lows: the bassline and the kick’s weight',
  melody: 'The wide mids: synths, keys, guitars',
  vocals: 'The centre of the mids, where a lead vocal usually sits',
};

const BASS_X = 150;
const HIGH_X = 5500;
const VOX_LO = 200;
const VOX_HI = 4000;
const Q = Math.SQRT1_2;

export class Stems {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly levels: Record<Stem, number> = { drums: 1, bass: 1, melody: 1, vocals: 1 };
  private gains: Record<Stem, GainNode>;
  private dry: GainNode;
  private wet: GainNode;
  private split = false;

  constructor(private ctx: AudioContext) {
    const c = ctx;
    const g = (v = 1) => {
      const n = c.createGain();
      n.gain.value = v;
      return n;
    };
    const lr4 = (type: BiquadFilterType, f: number): [BiquadFilterNode, BiquadFilterNode] => {
      const a = c.createBiquadFilter();
      const b = c.createBiquadFilter();
      a.type = b.type = type;
      a.frequency.value = b.frequency.value = f;
      a.Q.value = b.Q.value = Q;
      a.connect(b);
      return [a, b];
    };
    this.input = g();
    this.output = g();
    this.dry = g(1);
    this.wet = g(0);
    this.input.connect(this.dry).connect(this.output);
    this.gains = { drums: g(), bass: g(), melody: g(), vocals: g() };

    // bass = the lows; rest = input − bass
    const [b1, b2] = lr4('lowpass', BASS_X);
    this.input.connect(b1);
    b2.connect(this.gains.bass);
    const rest = g();
    this.input.connect(rest);
    const negBass = g(-1);
    b2.connect(negBass).connect(rest);

    // drums = the highs of the rest; mid = rest − highs
    const [h1, h2] = lr4('highpass', HIGH_X);
    rest.connect(h1);
    h2.connect(this.gains.drums);
    const mid = g();
    rest.connect(mid);
    const negHigh = g(-1);
    h2.connect(negHigh).connect(mid);

    // vocals = the centre (mono) of the mid band; melody = mid − vocals
    const splitter = c.createChannelSplitter(2);
    mid.connect(splitter);
    const centre = c.createGain();
    centre.channelCount = 1;
    centre.channelCountMode = 'explicit';
    centre.gain.value = 0.5;
    splitter.connect(centre, 0);
    splitter.connect(centre, 1);
    const [v1, v2] = lr4('highpass', VOX_LO);
    const [v3, v4] = lr4('lowpass', VOX_HI);
    centre.connect(v1);
    v2.connect(v3);
    // the mono vocal goes to both ears (a mono node into a stereo one is copied to both channels)
    v4.connect(this.gains.vocals);
    const melody = g();
    mid.connect(melody);
    const negVox = g(-1);
    v4.connect(negVox).connect(melody);
    melody.connect(this.gains.melody);

    for (const s of STEMS) this.gains[s].connect(this.wet);
    this.wet.connect(this.output);
  }

  /** a stem's level, 0..1 (1 is untouched) */
  set(stem: Stem, v: number): void {
    const x = Math.max(0, Math.min(1, v));
    this.levels[stem] = x;
    const now = this.ctx.currentTime;
    this.gains[stem].gain.setTargetAtTime(x, now, 0.015);
    // take the split path while any stem is down; the dry path when all are back up
    const want = STEMS.some((s) => this.levels[s] < 0.999);
    if (want !== this.split) {
      this.split = want;
      this.dry.gain.setTargetAtTime(want ? 0 : 1, now, 0.02);
      this.wet.gain.setTargetAtTime(want ? 1 : 0, now, 0.02);
    }
  }

  /** a stem on or off (a mute) */
  toggle(stem: Stem): void {
    this.set(stem, this.levels[stem] > 0.5 ? 0 : 1);
  }

  /** every stem back to full */
  reset(): void {
    for (const s of STEMS) this.set(s, 1);
  }
}
