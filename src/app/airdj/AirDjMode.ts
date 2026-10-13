/*
 * Air DJ: play the decks with your hands in front of the webcam. The camera
 * and the hand model are in tracker.ts, the gestures in gestures.ts and the
 * window on the stage in ui/AirDjPanel.ts; this ties them to the controls.
 *
 * It goes through the control registry like MIDI does, so the 3D board's
 * knobs, faders and platters move with your hands and Auto DJ hands the
 * mix back when you take over.
 */
import type { ControlRegistry, JogControl } from '../../core/controls';
import { toast } from '../../ui/toast';
import { AirDjPanel } from '../../ui/AirDjPanel';
import { introSeen, openAirDjGuide } from '../../ui/AirDjIntro';
import { AirDJ, type AirTarget, type Side } from './gestures';
import { HandTracker, startError } from './tracker';

/** the controls Air DJ works, by the deck on each side */
export function bindTarget(reg: ControlRegistry): AirTarget {
  const jog = (side: Side) => {
    const c = reg.get(`deck.${side}.jog`);
    return c && c.kind === 'jog' ? (c as JogControl) : null;
  };
  const ch = (side: Side) => `ch.${reg.layers[side]}`;
  return {
    touchJog: (side, on) => {
      jog(side)?.touch(on ? 'top' : null);
      reg.mark(`deck.${side}.jog`, 'air');
    },
    turnJog: (side, revs) => {
      jog(side)?.turn(revs, 'top');
      reg.mark(`deck.${side}.jog`, 'air');
    },
    filter: (side) => reg.value(`${ch(side)}.filter`),
    setFilter: (side, v) => reg.setValue(`${ch(side)}.filter`, v, 'air'),
    fx: (side, on) => (on ? reg.press(`fx.paddle.${reg.layers[side]}`, 'air') : reg.release(`fx.paddle.${reg.layers[side]}`, 'air')),
    setFxDepth: (v) => reg.setValue('fx.depth', v, 'air'),
    crossfader: () => reg.value('mixer.xfader'),
    setCrossfader: (v) => reg.setValue('mixer.xfader', v, 'air'),
    handsUp: () => reg.press('dj.move.1', 'air'),
  };
}

export class AirDjMode {
  on = false;
  private tracker = new HandTracker();
  private air: AirDJ;
  private panel: AirDjPanel;

  constructor(
    reg: ControlRegistry,
    private stageEl: HTMLElement,
    private changed: (on: boolean) => void = () => {},
  ) {
    this.air = new AirDJ(bindTarget(reg));
    this.panel = new AirDjPanel(this.tracker.video, { close: () => this.set(false), guide: () => openAirDjGuide() });
    this.tracker.onStatus = (s) => this.panel.setStatus(s);
    this.tracker.onHands = (hands, dt) => this.panel.draw(this.air.update(hands, dt), this.air.handsUpFlash > 0);
  }

  set(on: boolean): void {
    if (on === this.on) return;
    if (on && !navigator.mediaDevices?.getUserMedia) {
      toast('Air DJ needs a webcam, and a browser that lets this page use it.', 'error');
      return;
    }
    // the first time, the guide explains it all before the camera asks
    if (on && !introSeen()) return openAirDjGuide(() => this.set(true));
    this.on = on;
    if (on) {
      this.panel.recolor();
      this.panel.showHelp(false);
      this.stageEl.append(this.panel.el);
      this.tracker.start().catch((e) => {
        const msg = startError(e);
        this.panel.setStatus('error', msg);
        toast(msg, 'error');
      });
    } else {
      this.tracker.stop();
      this.air.release();
      this.panel.el.remove();
    }
    this.changed(this.on);
  }
}
