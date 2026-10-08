/*
 * LED video walls: the pixel structure up close, tile seams and off-axis
 * dimming on any screen material (used by Alexandra Palace's wall and IMAG
 * towers, and the screens at the warehouse and Printworks).
 */
import * as THREE from 'three';

/**
 * Make a screen material read as an LED video wall:
 *   – the pixel structure shows when you're close (each LED square with dark
 *     gaps), and fades out as pixels shrink below a couple of screen pixels,
 *     so there's no moiré at a distance
 *   – tile seams every 0.5 m
 *   – LEDs dim seen off-axis, and the wall runs bright enough to bloom
 *   – optional: the pit camera composited into the middle of the picture, a
 *     flash on the drop, and an IMAG grade (contrast, vignette, monochrome)
 * `size` is the screen in metres, `pitch` the LED pitch in metres.
 */
export interface LedUniforms {
  uLEDGain: { value: number };
  uLEDFlash: { value: number };
  uFeed: { value: THREE.Texture | null };
  uFeedMix: { value: number };
  uMono: { value: number };
}
export function ledScreen(mat: THREE.MeshBasicMaterial, size: [number, number], pitch: number, o: { feed?: THREE.Texture; imag?: boolean } = {}): LedUniforms {
  const u: LedUniforms = { uLEDGain: { value: 1.4 }, uLEDFlash: { value: 0 }, uFeed: { value: o.feed ?? null }, uFeedMix: { value: 0 }, uMono: { value: 0 } };
  const res = `vec2(${(size[0] / pitch).toFixed(1)}, ${(size[1] / pitch).toFixed(1)})`;
  const sz = `vec2(${size[0].toFixed(2)}, ${size[1].toFixed(2)})`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLEDPos;\nvarying vec3 vLEDN;\nvarying vec3 vLEDView;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vLEDPos = position.xy / ${sz} + 0.5;
        vLEDN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
        vLEDView = cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vLEDPos;
        varying vec3 vLEDN;
        varying vec3 vLEDView;
        uniform float uLEDGain, uLEDFlash, uFeedMix, uMono;
        uniform sampler2D uFeed;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        ${
          o.feed
            ? `// the pit camera in the middle of the wall (portrait feed, cropped to the panel)
        float fu = (vLEDPos.x - 0.36) / 0.28;
        if (uFeedMix > 0.001 && fu > 0.0 && fu < 1.0) {
          vec3 cam = texture2D(uFeed, vec2(fu, 0.5 + (vLEDPos.y - 0.5) * 0.55)).rgb;
          float edge = smoothstep(0.0, 0.02, fu) * smoothstep(1.0, 0.98, fu);
          diffuseColor.rgb = mix(diffuseColor.rgb, cam * 1.4, uFeedMix * edge);
        }`
            : ''
        }
        ${
          o.imag
            ? `// broadcast grade: a touch of contrast, a soft vignette, monochrome on cue
        vec3 gc = diffuseColor.rgb;
        float lum = dot(gc, vec3(0.2126, 0.7152, 0.0722));
        gc = mix(gc, vec3(lum), uMono);
        gc = pow(max(gc, 0.0), vec3(1.12)) * 1.15;
        vec2 vc = vLEDPos - 0.5;
        gc *= 1.0 - dot(vc, vc) * 0.9;
        diffuseColor.rgb = gc;`
            : ''
        }
        // LED pixels, visible only when each one covers a couple of screen pixels
        vec2 px = vLEDPos * ${res};
        vec2 cellD = abs(fract(px) - 0.5);
        float cell = smoothstep(0.5, 0.34, max(cellD.x, cellD.y));
        float fw = max(fwidth(px.x), fwidth(px.y));
        float showPx = 1.0 - smoothstep(0.22, 0.55, fw);
        // tile seams every half metre
        vec2 tile = abs(fract(vLEDPos * ${sz} * 2.0) - 0.5);
        float seamFw = max(fwidth(vLEDPos.x * ${sz}.x), fwidth(vLEDPos.y * ${sz}.y));
        float seam = 1.0 - smoothstep(0.485, 0.5, max(tile.x, tile.y)) * 0.6 * (1.0 - smoothstep(0.02, 0.08, seamFw));
        // LEDs dim off-axis
        float facing = abs(dot(vLEDN, normalize(vLEDView)));
        diffuseColor.rgb = diffuseColor.rgb * mix(1.0, cell * 1.4, showPx) * seam * uLEDGain * (0.42 + 0.58 * pow(facing, 0.6)) + vec3(uLEDFlash);`,
      );
  };
  mat.customProgramCacheKey = () => `led${size.join('x')}${o.feed ? 'f' : ''}${o.imag ? 'i' : ''}`;
  mat.needsUpdate = true;
  return u;
}
