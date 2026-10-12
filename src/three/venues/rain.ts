/*
 * Rain at the open-air venues (a night event): streaks falling in a box that
 * follows the camera, so wherever you look from it's raining around you. The
 * fall is worked out in the vertex shader (each streak drops and wraps), lit
 * by the sky's fill and the show's colour, and fades in and out with the
 * crowd show's rain level.
 */
import * as THREE from 'three';
import type { Fixture } from './fixtures';
import type { ShowState } from './show';
import { crowdShow } from './crowdShow';

const STREAKS = 9000;
const BOX = new THREE.Vector3(36, 22, 36);

export class Rain implements Fixture {
  readonly object: THREE.LineSegments;
  private k = 0;
  private t = 0;
  private u = {
    uT: { value: 0 },
    uK: { value: 0 },
    uBox: { value: BOX.clone() },
    uCol: { value: new THREE.Color(0.6, 0.66, 0.78) },
  };

  constructor(private light: () => THREE.Color) {
    const pos = new Float32Array(STREAKS * 2 * 3);
    const end = new Float32Array(STREAKS * 2);
    const seed = new Float32Array(STREAKS * 2);
    for (let i = 0; i < STREAKS; i++) {
      const x = Math.random() * BOX.x;
      const y = Math.random() * BOX.y;
      const z = Math.random() * BOX.z;
      const s = Math.random();
      for (let e = 0; e < 2; e++) {
        const j = i * 2 + e;
        pos.set([x, y, z], j * 3);
        end[j] = e;
        seed[j] = s;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aEnd;
        attribute float aSeed;
        uniform float uT;
        uniform vec3 uBox;
        varying float vA;
        varying float vEnd;
        void main() {
          float speed = 14.0 + aSeed * 6.0;
          vec3 p = position;
          // fall and wrap inside the box; a little wind
          p.y = mod(p.y - uT * speed, uBox.y);
          p.x = mod(p.x + uT * 1.8, uBox.x);
          p -= vec3(uBox.x * 0.5, 0.0, uBox.z * 0.5);
          // the streak's length: how far it falls in a frame or so
          p.y += aEnd * (0.55 + aSeed * 0.45);
          p.x += aEnd * 0.05;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          // thin out right up against the lens and far off
          float d = -mv.z;
          vA = smoothstep(0.4, 1.8, d) * (1.0 - smoothstep(13.0, 20.0, d));
          vEnd = aEnd;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uK;
        uniform vec3 uCol;
        varying float vA;
        varying float vEnd;
        void main() {
          // the falling (lower) end is the bright one
          float a = uK * vA * mix(0.75, 0.2, vEnd);
          if (a < 0.003) discard;
          gl_FragColor = vec4(uCol, a);
        }
      `,
    });
    this.object = new THREE.LineSegments(g, m);
    this.object.frustumCulled = false;
    this.object.visible = false;
    this.object.renderOrder = 5;
  }

  update(s: ShowState, dt: number, camera: THREE.Camera): void {
    this.k += (crowdShow.rain - this.k) * Math.min(1, dt * 0.6);
    this.object.visible = this.k > 0.01;
    if (!this.object.visible) return;
    this.t += dt;
    this.u.uT.value = this.t;
    this.u.uK.value = this.k;
    // follow the camera (in the venue's space)
    const p = camera.getWorldPosition(new THREE.Vector3());
    this.object.parent?.worldToLocal(p);
    this.object.position.set(p.x, Math.max(0, p.y - BOX.y * 0.45), p.z);
    // lit by the sky and the show's colour
    const c = this.u.uCol.value;
    c.copy(this.light()).multiplyScalar(0.9).add(new THREE.Color(0.25, 0.27, 0.32));
    c.lerp(s.colors[0], 0.25 * s.master);
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
  }
}
