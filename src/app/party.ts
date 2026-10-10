/*
 * The party moments: HELL YEAH and the air horn.
 *
 * HELL YEAH: the air horn; HELL YEAH! stamped over the stage and in neon on
 * the LED walls; the dancers hold their sparkler bottles up; you throw your
 * signature move; the crowd cheers, jumps and flips its signs; CO2 and
 * confetti; beach balls into the crowd and someone crowd-surfing to the
 * front; and from a board angle the camera cuts to the room for two bars to
 * show it all, then back. When it fires is game/hellyeah.ts.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import { HellYeah, type Moment } from '../game/hellyeah';
import type { Stage } from '../three/Stage';
import { setSignMode } from '../three/venues/crowd';
import { h } from '../ui/dom';

const CREW = ['HELL YEAH!', 'That’s the one!', 'Absolute scenes!', 'Somebody stop this DJ!', 'GET IN!', 'Are you seeing this?!', 'Frame that one.'];
const SHOUTS = ['HELL YEAH!', 'HELL YEAH!', 'HELL YEAH!', 'LET’S GOOO!', 'ABSOLUTE SCENES'];

export interface PartyHost {
  engine: AudioEngine;
  stage: Stage;
  vibe(): number;
  bpm(): number;
  /** someone in the booth says it (the gig HUD), and the stream chat floods */
  crew(text: string): void;
}

export class Party {
  readonly rules = new HellYeah();
  private stamp: HTMLElement;
  private stampTimer = 0;
  private signsTimer = 0;
  private lastShout = '';

  constructor(private host: PartyHost) {
    this.stamp = h('div', { class: 'hellyeah', 'aria-hidden': 'true' });
    host.stage.el.append(this.stamp);
  }

  /** a moment that might deserve it; true if it fired */
  moment(what: Moment): boolean {
    this.rules.auto = this.host.stage.show.controls.hellyeah;
    if (!this.rules.ask(what, performance.now() / 1000)) return false;
    this.fire();
    return true;
  }

  private fire(): void {
    const { engine, stage } = this.host;
    const beat = 60 / (this.host.bpm() || 124);
    engine.sampler.playExtra('horn', 0.75);
    engine.crowd.play('cheer', Math.max(0.7, this.host.vibe()), this.host.bpm() || 124);
    stage.show.fireConfetti();
    stage.show.fireCo2();
    stage.show.accent(0.8);
    stage.dancers.cheer();
    stage.avatar.celebrate();
    stage.party.launch(2);
    stage.party.sendSurfer(stage.venue?.views.crowd.pos);
    const pool = SHOUTS.filter((s) => s !== this.lastShout || s === 'HELL YEAH!');
    const shout = pool[Math.floor(Math.random() * pool.length)];
    this.lastShout = shout;
    stage.visualizer.shout(shout, beat * 6);
    stage.hellYeahCam(Math.max(3, beat * 8));
    // the crowd's signs flip to the HELL YEAH set for a few bars
    setSignMode('hellyeah');
    clearTimeout(this.signsTimer);
    this.signsTimer = window.setTimeout(() => setSignMode('normal'), 9000);
    this.host.crew(CREW[Math.floor(Math.random() * CREW.length)]);
    this.showStamp(shout);
  }

  private showStamp(text: string): void {
    const el = this.stamp;
    el.textContent = text;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(this.stampTimer);
    this.stampTimer = window.setTimeout(() => el.classList.remove('on'), 2200);
  }

  /** the air horn: as often as you like (that's the joke) */
  airhorn(): void {
    if (!this.host.engine.sampler.playExtra('horn', 0.7)) return;
    if (Math.random() < 0.35) this.host.engine.crowd.play('whoa', this.host.vibe(), this.host.bpm() || 124);
  }
}
