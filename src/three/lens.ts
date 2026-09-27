/*
 * Cinematic lens pass for the club camera (runs in linear HDR after bloom,
 * before tone mapping):
 *   – anamorphic streaks: bright sources (beam lenses, lasers, strobes,
 *     flames) smear into long horizontal blue-tinted flares
 *   – ghosts: faint mirrored copies of the brightest spots across the centre
 *   – FPV drone lens: barrel distortion, chromatic fringing and a zoom blur
 *     that grows with flying speed
 *   – vignette and film grain
 */
import * as THREE from 'three';

export const LensShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
    uStreak: { value: 0.3 },
    uTaps: { value: 8 },
    uGhost: { value: 0.25 },
    uDistort: { value: 0 },
    uBlur: { value: 0 },
    uCA: { value: 0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.3 },
    uThreshold: { value: 1.6 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime, uStreak, uTaps, uGhost, uDistort, uBlur, uCA, uGrain, uVignette, uThreshold;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 bright(vec2 uv) {
      vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
      return max(c - uThreshold, 0.0);
    }
    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 d = vUv - 0.5;
      // radius normalised so the corners are 1
      vec2 dn = d * vec2(aspect, 1.0) / (0.5 * sqrt(aspect * aspect + 1.0));
      float r2 = dot(dn, dn);
      // barrel distortion (corners stay put, the centre bulges)
      vec2 uv = 0.5 + d * (1.0 + uDistort * r2) / (1.0 + uDistort);
      vec3 c;
      float n = hash(vUv * uRes + fract(uTime) * 91.0);
      if (uBlur > 0.001 || uCA > 0.0001) {
        // zoom blur towards the centre with a colour fringe at the edges
        c = vec3(0.0);
        vec2 du = uv - 0.5;
        float ca = uCA * r2;
        const int N = 7;
        for (int i = 0; i < N; i++) {
          float k = (float(i) + n) / float(N);
          float s = 1.0 - uBlur * k * 0.07;
          c.r += texture2D(tDiffuse, 0.5 + du * s * (1.0 + ca)).r;
          c.g += texture2D(tDiffuse, 0.5 + du * s).g;
          c.b += texture2D(tDiffuse, 0.5 + du * s * (1.0 - ca)).b;
        }
        c /= float(N);
      } else {
        c = texture2D(tDiffuse, uv).rgb;
      }
      // anamorphic streaks: exponentially spaced taps, jittered per pixel
      if (uStreak > 0.001 && uTaps > 0.5) {
        vec3 st = vec3(0.0);
        float wsum = 0.0;
        for (int i = 1; i <= 12; i++) {
          if (float(i) > uTaps) break;
          float o = (0.0035 * pow(1.55, float(i)) + n * 0.004) / aspect;
          float w = 1.0 / (1.0 + float(i) * 0.6);
          st += (bright(uv + vec2(o, 0.0)) + bright(uv - vec2(o, 0.0))) * w;
          wsum += w;
        }
        st /= wsum;
        float l = dot(st, vec3(0.3, 0.5, 0.2));
        c += mix(st, vec3(0.35, 0.6, 1.0) * l, 0.6) * uStreak;
      }
      // ghosts mirrored through the centre
      if (uGhost > 0.001) {
        vec2 g = 0.5 - (uv - 0.5);
        vec3 gh = bright(0.5 + (g - 0.5) * 0.55) * vec3(0.9, 0.6, 1.0) + bright(0.5 + (g - 0.5) * 1.35) * vec3(0.5, 1.0, 0.8) * 0.6;
        c += gh * uGhost * smoothstep(0.9, 0.1, length(g - 0.5));
      }
      c *= mix(1.0, smoothstep(1.35, 0.2, r2), uVignette);
      c *= 1.0 + (n - 0.5) * uGrain;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};
