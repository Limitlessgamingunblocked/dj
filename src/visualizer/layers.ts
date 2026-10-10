/*
 * The music's three layers over whatever mode is playing, one pass after the
 * mode (and its transition), before the lyrics and the bloom:
 *   drums   punch: the picture punches in on the kick, the edges lift on the snare
 *           rings: a ring leaves the centre on every kick, a finer one on the snare
 *           bars: light bars down the sides flare on the kick, top and bottom on the snare
 *           shatter: the picture jumps in slices on the snare, splits on the kick
 *           and in every style, the hats sparkle
 *   melody  ribbon: a line of light draws the melody's last few seconds, high notes high
 *           aurora: curtains of light from the top, as tall as the melody is high
 *           orbit: a light goes round the circle of notes to the one being played
 *           in the colour of the note (the song's colours, round the wheel)
 *   vocals  halo: a ring round the centre breathes with the voice, wider for high notes
 *           wave: a line of light across the lower third, its ripples the voice's pitch
 *           rays: light rays from the centre while someone sings
 * The song's look picks one style of each and how strong; changing song
 * crossfades the styles. Additive light, held back where the picture is
 * already bright so nothing washes out; with "reduce flashing" the hits are
 * softer and the sparkles calmer.
 */
import * as THREE from 'three';
import type { Features } from './AudioFeatures';
import { PALETTE } from './modes';
import { DRUM_STYLES, MELODY_STYLES, VOCAL_STYLES, type SongLook } from './songLook';

const HIST = 128;

export const LayersShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tMel: { value: null as THREE.Texture | null },
    uAsp: { value: 16 / 9 },
    uTime: { value: 0 },
    uHue: { value: 0 },
    uI: { value: 1 },
    uSafe: { value: 0 },
    uKick: { value: 0 },
    uSnare: { value: 0 },
    uHat: { value: 0 },
    uKickT: { value: 9 },
    uSnareT: { value: 9 },
    uHatSeed: { value: 0 },
    uSnareSeed: { value: 0 },
    uMel: { value: 0 },
    uMelHue: { value: 0 },
    uMelPitch: { value: 0.5 },
    uMelPulse: { value: 0 },
    uVoc: { value: 0 },
    uVocOn: { value: 0 },
    uVocPitch: { value: 0.5 },
    uDrumW: { value: new THREE.Vector4(1, 0, 0, 0) },
    uMelW: { value: new THREE.Vector3(1, 0, 0) },
    uVocW: { value: new THREE.Vector3(1, 0, 0) },
    uAmt: { value: new THREE.Vector3(0.8, 0.75, 0.85) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tMel;
    uniform float uAsp, uTime, uHue, uI, uSafe;
    uniform float uKick, uSnare, uHat, uKickT, uSnareT, uHatSeed, uSnareSeed;
    uniform float uMel, uMelHue, uMelPitch, uMelPulse;
    uniform float uVoc, uVocOn, uVocPitch;
    uniform vec4 uDrumW;
    uniform vec3 uMelW, uVocW, uAmt;
    varying vec2 vUv;
    ${PALETTE}
    float h1(float n) { return fract(sin(n * 127.1 + 31.7) * 43758.5453); }
    float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec3 col(float t) { return clamp(palette(t, uHue), 0.0, 1.0); }
    void main() {
      vec2 p = (vUv - 0.5) * vec2(uAsp, 1.0);
      float r = length(p);
      float soft = mix(1.0, 0.4, uSafe);
      float dAmt = uAmt.x * uI;
      vec2 uv = vUv;
      // drums that move the picture: punch in on the kick, shatter on the snare
      uv = (uv - 0.5) * (1.0 - uDrumW.x * uKick * 0.03 * dAmt * soft) + 0.5;
      float slice = floor(vUv.y * 16.0);
      float jump = step(0.55, h1(slice * 1.7 + uSnareSeed)) * (h1(slice + uSnareSeed * 3.1) - 0.5);
      uv.x += jump * 0.05 * uSnare * uDrumW.w * dAmt * soft;
      float split = uDrumW.w * uKick * 0.006 * dAmt * soft;
      vec3 base = vec3(texture2D(tDiffuse, uv + vec2(split, 0.0)).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - vec2(split, 0.0)).b);
      float lum = dot(base, vec3(0.299, 0.587, 0.114));
      // less light added where the picture is already bright
      float room = 1.0 - smoothstep(0.35, 1.1, lum) * 0.75;
      vec3 add = vec3(0.0);

      // drums that add light
      vec3 cKick = mix(col(0.0), vec3(1.0), 0.25);
      vec3 cSnare = mix(col(0.5), vec3(1.0), 0.35);
      float ringK = smoothstep(0.03, 0.0, abs(r - uKickT * 1.5)) * exp(-uKickT * 2.8);
      float ringS = smoothstep(0.012, 0.0, abs(r - uSnareT * 2.1)) * exp(-uSnareT * 4.0);
      add += uDrumW.y * (ringK * cKick * 0.9 + ringS * cSnare * 0.6);
      float ex = smoothstep(0.1, 0.0, min(vUv.x, 1.0 - vUv.x));
      float ey = smoothstep(0.08, 0.0, min(vUv.y, 1.0 - vUv.y));
      add += uDrumW.z * (ex * uKick * cKick + ey * uSnare * cSnare) * 0.85 * soft;
      add += uDrumW.x * smoothstep(0.35, 0.95, r) * uSnare * 0.22 * cSnare * soft;
      // the hats sparkle, every style
      vec2 g = vUv * vec2(56.0 * uAsp, 56.0);
      float star = step(0.986, h2(floor(g) + uHatSeed)) * smoothstep(0.5, 0.0, length(fract(g) - 0.5));
      add += star * uHat * mix(1.0, 0.35, uSafe) * 0.9;
      add *= dAmt;

      // the melody, in the colour of its note
      vec3 cMel = mix(col(uMelHue), vec3(1.0), 0.15);
      float mAmt = uAmt.y * uI;
      vec4 mh = texture2D(tMel, vec2(vUv.x, 0.5));
      float ly = 0.18 + mh.r * 0.64;
      float dy = abs(vUv.y - ly);
      float fadeIn = smoothstep(0.0, 0.35, vUv.x);
      float ribbon = (smoothstep(0.006 + mh.g * 0.006, 0.0, dy) + smoothstep(0.07, 0.0, dy) * 0.25) * mh.g * fadeIn;
      vec3 m = uMelW.x * ribbon * cMel;
      float top = 1.0 - vUv.y;
      float sway = sin(vUv.x * 9.0 + uTime * 0.7 + sin(vUv.x * 3.1 - uTime * 0.4) * 1.5);
      float curtain = smoothstep(0.25 + uMelPitch * 0.35, 0.0, top + sway * 0.04) * (0.55 + 0.45 * sin(vUv.x * 40.0 + sway * 2.0));
      m += uMelW.y * curtain * uMel * cMel * 0.55;
      float ang = uMelHue * 6.28318 + 1.5708;
      vec2 dotp = vec2(cos(ang), sin(ang)) * 0.36;
      float dd = length(p - dotp);
      float marks = smoothstep(0.004, 0.0, abs(r - 0.36)) * 0.25;
      m += uMelW.z * ((smoothstep(0.035, 0.0, dd) + smoothstep(0.16, 0.0, dd) * 0.35) * (1.0 + uMelPulse) * uMel + marks * uMel) * cMel;
      add += m * mAmt;

      // the vocal
      vec3 cVoc = mix(col(0.33), vec3(1.0), 0.3);
      float vAmt = uAmt.z * uI * uVocOn;
      float hr = 0.2 + uVocPitch * 0.2 + uVoc * 0.04;
      float halo = smoothstep(0.02 + uVoc * 0.03, 0.0, abs(r - hr)) * 0.6 + smoothstep(0.09, 0.0, abs(r - hr)) * 0.15 + smoothstep(hr, 0.0, r) * 0.08;
      vec3 v = uVocW.x * halo * cVoc;
      float freq = 6.0 + uVocPitch * 22.0;
      float wy = 0.24 + (sin(vUv.x * freq + uTime * 3.0) * 0.6 + sin(vUv.x * freq * 1.9 - uTime * 2.1) * 0.4) * 0.05 * (0.3 + uVoc);
      float wd = abs(vUv.y - wy);
      v += uVocW.y * (smoothstep(0.005, 0.0, wd) + smoothstep(0.05, 0.0, wd) * 0.25) * cVoc;
      float a = atan(p.y, p.x);
      // fine rays, slowly turning, brightest near the middle
      float rays = pow(0.5 + 0.5 * sin(a * 18.0 + uTime * 0.5), 24.0) * smoothstep(0.85, 0.05, r) * smoothstep(0.03, 0.14, r);
      v += uVocW.z * rays * cVoc * 0.4;
      add += v * (0.35 + uVoc * 0.9) * vAmt;

      gl_FragColor = vec4(base + max(add, 0.0) * room, 1.0);
    }`,
};

/** keeps the layer pass's uniforms: the melody's history, the time since each hit, the styles easing over */
export class MusicLayers {
  readonly tex: THREE.DataTexture;
  private data: Uint8Array;
  private acc = 0;
  private kickT = 9;
  private snareT = 9;
  private hatSeed = 0;
  private snareSeed = 0;
  private drumW = [1, 0, 0, 0];
  private melW = [1, 0, 0];
  private vocW = [1, 0, 0];
  private amt = [0.8, 0.75, 0.85];
  private look: SongLook | null = null;

  constructor() {
    this.data = new Uint8Array(HIST * 4);
    this.tex = new THREE.DataTexture(this.data, HIST, 1, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
  }

  setLook(look: SongLook | null): void {
    this.look = look;
  }

  /** every frame; `on`: which layers the player wants (drums, melody, vocals) */
  update(u: Record<string, THREE.IUniform>, f: Features, dt: number, on: [boolean, boolean, boolean]): void {
    const p = f.parts;
    // styles and strengths ease to the song's over a couple of seconds
    const k = Math.min(1, dt * 1.2);
    const l = this.look;
    const ease = (w: number[], i: number) => w.map((x, j) => x + ((j === i ? 1 : 0) - x) * k);
    this.drumW = ease(this.drumW, l ? DRUM_STYLES.indexOf(l.drum) : 0);
    this.melW = ease(this.melW, l ? MELODY_STYLES.indexOf(l.melody) : 0);
    this.vocW = ease(this.vocW, l ? VOCAL_STYLES.indexOf(l.vocal) : 0);
    const want = [l?.drumAmt ?? 0.8, l?.melodyAmt ?? 0.75, l?.vocalAmt ?? 0.85].map((a, i) => (on[i] ? a : 0));
    this.amt = this.amt.map((a, i) => a + (want[i] - a) * k);
    (u.uDrumW.value as THREE.Vector4).set(this.drumW[0], this.drumW[1], this.drumW[2], this.drumW[3]);
    (u.uMelW.value as THREE.Vector3).set(this.melW[0], this.melW[1], this.melW[2]);
    (u.uVocW.value as THREE.Vector3).set(this.vocW[0], this.vocW[1], this.vocW[2]);
    (u.uAmt.value as THREE.Vector3).set(this.amt[0], this.amt[1], this.amt[2]);

    u.uTime.value = f.time;
    u.uHue.value = f.hue;
    u.uI.value = f.playing ? Math.min(1.3, f.intensity) : 0;
    u.uSafe.value = f.safe ?? 0;
    if (!p) return;
    this.kickT = p.kickHit ? 0 : Math.min(9, this.kickT + dt);
    this.snareT = p.snareHit ? 0 : Math.min(9, this.snareT + dt);
    if (p.hatHit) this.hatSeed = (this.hatSeed + 1.37) % 97;
    if (p.snareHit) this.snareSeed = (this.snareSeed + 2.11) % 89;
    u.uKick.value = p.kickPulse;
    u.uSnare.value = p.snarePulse;
    u.uHat.value = p.hatPulse;
    u.uKickT.value = this.kickT;
    u.uSnareT.value = this.snareT;
    u.uHatSeed.value = this.hatSeed;
    u.uSnareSeed.value = this.snareSeed;
    u.uMel.value = p.melody;
    u.uMelHue.value = p.melodyHue;
    u.uMelPitch.value = p.melodyPitch;
    u.uMelPulse.value = p.melodyPulse;
    u.uVoc.value = p.vocal;
    u.uVocOn.value = p.vocalPresence;
    u.uVocPitch.value = p.vocalPitch;
    // the melody's history scrolls right to left, 30 times a second
    this.acc += dt;
    if (this.acc >= 1 / 30) {
      this.acc %= 1 / 30;
      this.data.copyWithin(0, 4);
      const i = (HIST - 1) * 4;
      this.data[i] = Math.round(Math.max(0, Math.min(1, p.melodyPitch)) * 255);
      this.data[i + 1] = Math.round(Math.max(0, Math.min(1, p.melody)) * 255);
      this.data[i + 3] = 255;
      this.tex.needsUpdate = true;
    }
  }

  dispose(): void {
    this.tex.dispose();
  }
}
