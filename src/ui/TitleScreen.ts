/*
 * The title screen: the game's name in chrome with glowing sides, hanging in
 * front of a slow glide through the venue at night, the room's lights moving
 * over it. Any key, click, tap or a button on a controller starts: the name
 * flies past the camera and the camera walks you into the venue.
 *
 * Shown at launch (automated test browsers skip it; ?title forces it). At the
 * end of the launch cutscene it comes in on the drop with a white flash.
 */
import * as THREE from 'three';
import type { ControlRegistry } from '../core/controls';
import { logoGeometry } from '../three/logo3d';
import type { Stage } from '../three/Stage';
import { blobTexture } from '../three/venues/details';
import { h } from './dom';

/* where the name hangs in front of the camera (metres) */
const LOGO_Z = -0.9;
const LOGO_Y = 0.056;

export interface TitleHost {
  stage: Stage;
  /** the app's shell (gets the full-screen class while the title is up) */
  shell: HTMLElement;
  reg: ControlRegistry;
  /** the venue's accent colour */
  accent(): string;
  /** the title's gone: carry on into the app */
  start(): void;
}

export class TitleScreen {
  private el: HTMLElement | null = null;
  private logo: THREE.Group | null = null;
  private mats: THREE.Material[] = [];
  private t = 0;
  private leaving = -1;
  private raf = 0;
  private last = 0;
  private off: (() => void)[] = [];

  constructor(private host: TitleHost) {}

  get open(): boolean {
    return !!this.el;
  }

  show(o: { flash?: boolean } = {}): void {
    if (this.el) return;
    const { stage, shell } = this.host;
    const flash = !!o.flash && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    shell.classList.add('titling');
    // the camera's last move is over: the glide takes it
    stage.rig.shot = null;
    this.el = h(
      'div',
      { class: `title-screen${flash ? ' flash' : ''}`, role: 'dialog', 'aria-label': 'Deckhouse DJ' },
      h('p', { class: 'title-tag' }, 'From the bedroom to the main stage'),
      h('p', { class: 'title-prompt' }, matchMedia('(pointer: coarse)').matches ? 'Tap to start' : 'Press any key to start'),
    );
    stage.el.append(this.el);
    this.buildLogo();
    stage.rig.setFlyby(true);
    // any key (swallowed, so it doesn't also play a deck), a click or tap, a controller button
    const key = (e: KeyboardEvent) => {
      if (e.repeat) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.dismiss();
    };
    const tap = (e: Event) => {
      e.preventDefault();
      this.dismiss();
    };
    window.addEventListener('keydown', key, { capture: true });
    this.el.addEventListener('pointerdown', tap);
    const unsub = this.host.reg.on('activity', ({ source }) => source === 'midi' && this.dismiss());
    this.off = [() => window.removeEventListener('keydown', key, { capture: true }), unsub];
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.animate(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private buildLogo(): void {
    const stage = this.host.stage;
    const accent = new THREE.Color(this.host.accent());
    const face = new THREE.MeshPhysicalMaterial({ color: 0xf2f5fa, metalness: 1, roughness: 0.16, clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 2.6, transparent: true, opacity: 0 });
    const side = new THREE.MeshStandardMaterial({ color: 0x0b0c10, emissive: accent, emissiveIntensity: 2.4, roughness: 0.4, metalness: 0.3, transparent: true, opacity: 0 });
    const glow = new THREE.SpriteMaterial({ map: blobTexture(), color: accent, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mats = [face, side, glow];
    const g = new THREE.Group();
    const word = new THREE.Mesh(logoGeometry('DECKHOUSE', 1.7), [face, side]);
    g.add(word);
    const halo = new THREE.Sprite(glow);
    halo.scale.set(2.6, 0.9, 1);
    halo.position.z = -0.25;
    g.add(halo);
    // a light of its own, so the chrome catches something in a dark room
    const key = new THREE.PointLight(0xffffff, 2.5, 6, 2);
    key.position.set(0.6, 0.8, 1.2);
    word.renderOrder = 10;
    g.add(key);
    // close to the lens (a small room's walls can't come between), scaled to look the same size
    g.position.set(0, LOGO_Y, LOGO_Z);
    // ride with the camera
    if (!stage.camera.parent) stage.scene.add(stage.camera);
    stage.camera.add(g);
    this.logo = g;
  }

  private animate(dt: number): void {
    const g = this.logo;
    if (!g) return;
    this.t += dt;
    const t = this.t;
    let a = Math.min(1, t / 1.2);
    let s = (0.7 + 0.3 * (1 - (1 - a) ** 3)) * 0.35;
    g.rotation.set(Math.sin(t * 0.3) * 0.04, Math.sin(t * 0.4) * 0.14, 0);
    g.position.y = LOGO_Y + Math.sin(t * 0.8) * 0.007;
    if (this.leaving >= 0) {
      this.leaving += dt;
      const k = Math.min(1, this.leaving / 0.7);
      a *= 1 - k;
      s *= 1 + k * 0.8;
      g.position.z = LOGO_Z + k * 0.66;
      if (k >= 1) {
        this.finish();
        return;
      }
    }
    g.scale.setScalar(s);
    for (const m of this.mats) (m as THREE.Material & { opacity: number }).opacity = m instanceof THREE.SpriteMaterial ? a * 0.35 : a;
  }

  /** start: the name flies past, the camera walks in */
  dismiss(): void {
    if (!this.el || this.leaving >= 0) return;
    this.leaving = 0;
    for (const f of this.off) f();
    this.off = [];
    this.el.classList.add('leaving');
    this.host.shell.classList.remove('titling');
    this.host.stage.rig.setFlyby(false);
    this.host.start();
  }

  private finish(): void {
    cancelAnimationFrame(this.raf);
    this.logo?.removeFromParent();
    // (the sprite's geometry is shared by every sprite: only the word's own)
    this.logo?.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
    for (const m of this.mats) m.dispose();
    this.logo = null;
    this.mats = [];
    this.el?.remove();
    this.el = null;
  }
}
