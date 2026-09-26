import type { Vec2 } from '../core/math';
import type { CertId } from '../core/progression';

export type MissionStatus = 'running' | 'success' | 'failed';

export interface MissionResult {
  merit: number;
  lines: string[];
  failReason?: string;
  cert?: CertId;
}

export interface Mission {
  readonly id: string;
  readonly title: string;
  status: MissionStatus;
  start(): void;
  update(dt: number): void;
  /** One line of HUD text telling the player what to do now. */
  objective(): string;
  /** Where the GPS should lead, if anywhere. */
  gps(): Vec2 | null;
  /** Seconds left on the emergency timer, or null. */
  timeLeft(): number | null;
  timerLabel(): string;
  result(): MissionResult;
  cleanup(): void;
  /** Called when the player hits a civilian car. */
  onCarHit?(): void;
}

export interface MissionDef {
  id: string;
  title: string;
  kind: 'training' | 'scenario';
  blurb: string;
  requires: CertId[];
  grants?: CertId;
  reward: number;
}
