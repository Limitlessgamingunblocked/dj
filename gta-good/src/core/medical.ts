import { clamp } from './math';

export type ToolId = 'epi' | 'aed' | 'inhaler' | 'trauma' | 'glucose' | 'oxygen';
export type ConditionId = 'anaphylaxis' | 'cardiac' | 'asthma' | 'trauma' | 'hypoglycemia' | 'smoke' | 'evacuee';
export type CheckId = 'look' | 'breathing' | 'pulse' | 'ask';

export interface Tool {
  id: ToolId;
  name: string;
  short: string;
  key: string;
  /** Certification needed to carry it. */
  cert?: 'als';
  hint: string;
}

export const TOOLS: Tool[] = [
  { id: 'epi', name: 'Epinephrine auto-injector', short: 'Epi', key: '1', hint: 'Outer mid-thigh. Severe allergic reactions.' },
  { id: 'inhaler', name: 'Inhaler + spacer', short: 'Inhaler', key: '2', hint: 'Mouth, on the in-breath. Asthma attacks.' },
  { id: 'aed', name: 'AED defibrillator', short: 'AED', key: '3', cert: 'als', hint: 'Pads upper-right chest and lower-left side. No pulse, not breathing.' },
  { id: 'trauma', name: 'Trauma kit (tourniquet)', short: 'Trauma', key: '4', hint: 'High and tight above the wound. Heavy bleeding.' },
  { id: 'glucose', name: 'Oral glucose gel', short: 'Glucose', key: '5', hint: 'Inside the cheek. Low blood sugar, still able to swallow.' },
  { id: 'oxygen', name: 'Oxygen mask', short: 'O₂', key: '6', hint: 'Over nose and mouth. Smoke or breathing trouble.' },
];

export const toolById = (id: ToolId) => TOOLS.find((t) => t.id === id)!;

export interface Condition {
  id: ConditionId;
  label: string;
  tool: ToolId | null;
  /** Stability lost per second before treatment and after. */
  decay: number;
  treatedDecay: number;
  /** Needs a hospital after on-scene treatment. */
  transport: boolean;
  signs: Record<CheckId, string>;
  wrongTool: string;
}

export const CONDITIONS: Record<ConditionId, Condition> = {
  anaphylaxis: {
    id: 'anaphylaxis',
    label: 'Anaphylaxis',
    tool: 'epi',
    decay: 1.25,
    treatedDecay: 0.05,
    transport: true,
    signs: {
      look: 'Hives on the neck and arms, lips and eyelids swelling.',
      breathing: 'Noisy and wheezy, throat feels tight.',
      pulse: 'Fast and weak — about 135.',
      ask: '“They ate something at the picnic. They’re allergic to peanuts!”',
    },
    wrongTool: 'That barely helps. The hives and swelling point to a severe allergic reaction.',
  },
  cardiac: {
    id: 'cardiac',
    label: 'Cardiac arrest',
    tool: 'aed',
    decay: 1.6,
    treatedDecay: 0.08,
    transport: true,
    signs: {
      look: 'Unresponsive on the ground, skin grey.',
      breathing: 'Not breathing — only an occasional gasp.',
      pulse: 'No pulse.',
      ask: '“They just grabbed their chest and collapsed!”',
    },
    wrongTool: 'No change. No pulse and no breathing means the heart needs a shock — AED.',
  },
  asthma: {
    id: 'asthma',
    label: 'Asthma attack',
    tool: 'inhaler',
    decay: 0.75,
    treatedDecay: 0.02,
    transport: false,
    signs: {
      look: 'Sitting up, leaning forward, no rash or swelling.',
      breathing: 'Wheezing on every breath out, can only say a few words.',
      pulse: 'Fast — about 115.',
      ask: '“Asthma… left… my inhaler…”',
    },
    wrongTool: 'Not the right call. Wheezing with no rash or swelling sounds like asthma.',
  },
  trauma: {
    id: 'trauma',
    label: 'Severe bleeding',
    tool: 'trauma',
    decay: 1.0,
    treatedDecay: 0.06,
    transport: true,
    signs: {
      look: 'Deep cut on the arm, bleeding heavily.',
      breathing: 'Fast but clear.',
      pulse: 'Fast and weak — about 125.',
      ask: '“I slipped and went through the glass…”',
    },
    wrongTool: 'The bleeding hasn’t slowed. Stop it with a tourniquet above the wound.',
  },
  hypoglycemia: {
    id: 'hypoglycemia',
    label: 'Low blood sugar',
    tool: 'glucose',
    decay: 0.6,
    treatedDecay: 0.02,
    transport: false,
    signs: {
      look: 'Pale, sweaty and confused. Wearing a diabetic ID bracelet.',
      breathing: 'Normal.',
      pulse: 'A bit fast — about 105.',
      ask: '“Skipped lunch… took my insulin…” (slurred)',
    },
    wrongTool: 'No improvement. The bracelet and confusion point to low blood sugar.',
  },
  smoke: {
    id: 'smoke',
    label: 'Smoke inhalation',
    tool: 'oxygen',
    decay: 0.8,
    treatedDecay: 0.02,
    transport: false,
    signs: {
      look: 'Soot around the nose and mouth.',
      breathing: 'Coughing, hoarse and short of breath.',
      pulse: 'Fast — about 110.',
      ask: '“The smoke came so fast…”',
    },
    wrongTool: 'Still struggling. They breathed in smoke and need oxygen.',
  },
  evacuee: {
    id: 'evacuee',
    label: 'Needs evacuation',
    tool: null,
    decay: 0,
    treatedDecay: 0,
    transport: true,
    signs: { look: 'Shaken but unhurt.', breathing: 'Normal.', pulse: 'Normal.', ask: '“Please get us out of here.”' },
    wrongTool: 'They are unhurt — just give them a ride to the safety zone.',
  },
};

export interface Patient {
  name: string;
  age: number;
  condition: ConditionId;
  stability: number;
  treated: boolean;
  /** 0..1, how well the treatment went. */
  quality: number;
  revealed: CheckId[];
  /** Training dummies don't deteriorate. */
  training: boolean;
  lost: boolean;
  story?: string;
}

export function newPatient(condition: ConditionId, opts: Partial<Patient> = {}): Patient {
  return {
    name: 'Patient',
    age: 40,
    condition,
    stability: condition === 'evacuee' ? 100 : 70,
    treated: condition === 'evacuee',
    quality: 1,
    revealed: [],
    training: false,
    lost: false,
    ...opts,
  };
}

export interface RideInput {
  /** Smoothed lateral and longitudinal acceleration in g. */
  gLat: number;
  gLong: number;
  /** Collision speed change this step (m/s), 0 if none. */
  jolt: number;
  /** Multiplier on ride damage from the vehicle and upgrades (lower is gentler). */
  comfort: number;
}

/** Acceleration a patient can take without harm (g). */
export const G_LIMIT = 0.45;

/** Stability lost from a rough ride over dt seconds. */
export function rideDamage(r: RideInput, dt: number): number {
  const g = Math.hypot(r.gLat, r.gLong);
  const excess = Math.max(0, g - G_LIMIT);
  const hit = Math.max(0, r.jolt - 2);
  return (excess ** 1.5 * 30 * dt + hit * 1.6) * r.comfort;
}

/** Advances a patient over dt. `ride` is set while they are aboard a moving vehicle. */
export function updatePatient(p: Patient, dt: number, ride?: RideInput): void {
  if (p.lost || p.training || p.condition === 'evacuee') return;
  const c = CONDITIONS[p.condition];
  const rate = p.treated ? c.treatedDecay * (1.6 - 0.6 * p.quality) : c.decay;
  let loss = rate * dt;
  if (ride) loss += rideDamage(ride, dt);
  p.stability = clamp(p.stability - loss, 0, 100);
  if (p.stability <= 0) p.lost = true;
}

export interface TreatResult {
  ok: boolean;
  message: string;
}

/** Applies a tool. Quality (0..1) comes from the targeting interface. */
export function treat(p: Patient, tool: ToolId, quality: number): TreatResult {
  const c = CONDITIONS[p.condition];
  if (p.treated) return { ok: true, message: 'Already stable.' };
  if (tool !== c.tool) {
    if (!p.training) p.stability = clamp(p.stability - 8, 0, 100);
    return { ok: false, message: c.wrongTool };
  }
  const q = clamp(quality, 0, 1);
  p.treated = true;
  p.quality = q;
  p.stability = clamp(p.stability + 22 + 22 * q, 0, 100);
  return { ok: true, message: `${c.label} treated.` };
}

/** A missed or clumsy application still costs the patient. */
export function missedApplication(p: Patient): void {
  if (!p.training) p.stability = clamp(p.stability - 4, 0, 100);
}

export interface Vitals {
  hr: number;
  spo2: number;
  rr: number;
  rhythm: 'sinus' | 'vf' | 'tachy' | 'flat';
}

/** Display vitals derived from condition and stability. */
export function vitalsOf(p: Patient): Vitals {
  const s = p.stability / 100;
  if (p.lost) return { hr: 0, spo2: 0, rr: 0, rhythm: 'flat' };
  if (p.condition === 'cardiac' && !p.treated) return { hr: 0, spo2: Math.round(60 + 20 * s), rr: 0, rhythm: 'vf' };
  if (p.condition === 'evacuee') return { hr: 88, spo2: 98, rr: 16, rhythm: 'sinus' };
  const stress = p.treated ? 0.35 * (1 - s) : 1 - s * 0.6;
  const hr = Math.round(72 + 70 * stress);
  const breathing = p.condition === 'anaphylaxis' || p.condition === 'asthma' || p.condition === 'smoke';
  const spo2 = Math.round(breathing && !p.treated ? 84 + 12 * s : 94 + 5 * s);
  const rr = Math.round(14 + 16 * stress);
  return { hr, spo2, rr, rhythm: hr > 110 ? 'tachy' : 'sinus' };
}

export function stabilityLabel(s: number): string {
  if (s >= 75) return 'Stable';
  if (s >= 45) return 'Serious';
  if (s >= 20) return 'Critical';
  return 'Crashing';
}
