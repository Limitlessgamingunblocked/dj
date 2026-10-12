/*
 * The crazy rooms' own notes (the Laser Grid's beams play one when someone
 * breaks them): a soft, short pluck in the track's key, played straight to
 * the output at a polite level, never into the mix or a recording.
 */
let ctx: AudioContext | null = null;
let bus: GainNode | null = null;

export function setRoomAudio(c: AudioContext): void {
  ctx = c;
  bus = null;
}

/** a pluck at a midi note, 0..1 */
export function roomNote(midi: number, vel: number): void {
  if (!ctx || ctx.state !== 'running') return;
  if (!bus) {
    bus = ctx.createGain();
    bus.gain.value = 0.12;
    bus.connect(ctx.destination);
  }
  const t = ctx.currentTime + 0.005;
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = f;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(f * 6, t);
  lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.01, vel), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  osc.connect(lp).connect(g).connect(bus);
  osc.start(t);
  osc.stop(t + 0.75);
}
