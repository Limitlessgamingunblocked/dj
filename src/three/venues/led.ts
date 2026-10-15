/*
 * LED video walls: the pixel structure up close, tile seams and off-axis
 * dimming on any screen material (used by Alexandra Palace's wall and IMAG
 * towers, and the screens at the warehouse and Printworks). The same look on
 * a wall cut into flying panels (an instanced mesh, wallshow.ts): each panel
 * shows its own piece of the picture, with dark cabinet backs.
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
/**
 * The wall cut into panels: an instanced unit box per panel, scaled to
 * `tile` metres, with `aTileC` (the panel's centre on the wall, metres from
 * the wall's centre) per instance. `crop` maps the wall onto the picture
 * (scale x, y, offset x, y) the way the flat wall's UVs do.
 */
export interface LedTiles {
  tile: { value: THREE.Vector2 };
  crop: [number, number, number, number];
}

export function ledScreen(mat: THREE.MeshBasicMaterial, size: [number, number], pitch: number, o: { feed?: THREE.Texture; imag?: boolean; tiles?: LedTiles } = {}): LedUniforms {
  const u: LedUniforms = { uLEDGain: { value: 1.4 }, uLEDFlash: { value: 0 }, uFeed: { value: o.feed ?? null }, uFeedMix: { value: 0 }, uMono: { value: 0 } };
  const res = `vec2(${(size[0] / pitch).toFixed(1)}, ${(size[1] / pitch).toFixed(1)})`;
  const sz = `vec2(${size[0].toFixed(2)}, ${size[1].toFixed(2)})`;
  const t = o.tiles;
  const crop = t ? `vec4(${t.crop.map((x) => x.toFixed(4)).join(', ')})` : '';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    if (t) sh.uniforms.uTileSize = t.tile;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLEDPos;\nvarying vec3 vLEDN;\nvarying vec3 vLEDView;');
    if (t)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aTileC;\nuniform vec2 uTileSize;\nvarying vec2 vTileXY;\nvarying float vTileFront;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          // where this point of the panel sits on the wall: its piece of the picture
          vec2 ledWall = aTileC.xy + position.xy * uTileSize;
          #ifdef USE_MAP
            vMapUv = (mapTransform * vec3((ledWall / ${sz} + 0.5) * ${crop}.xy + ${crop}.zw, 1.0)).xy;
          #endif`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vLEDPos = ledWall / ${sz} + 0.5;
          vTileXY = position.xy;
          vTileFront = step(0.5, normal.z);
          vLEDN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * vec3(0.0, 0.0, 1.0));
          vLEDView = cameraPosition - (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`,
        );
    else
      sh.vertexShader = sh.vertexShader.replace(
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
        uniform sampler2D uFeed;${t ? '\nuniform vec2 uTileSize;\nvarying vec2 vTileXY;\nvarying float vTileFront;' : ''}`,
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
        // tile seams every half metre${t ? ' (on a panel: its modules, from its own corner)' : ''}
        vec2 tile = abs(fract(${t ? '(vTileXY + 0.5) * max(floor(uTileSize * 2.0 + 0.5), vec2(1.0))' : `vLEDPos * ${sz} * 2.0`}) - 0.5);
        float seamFw = max(fwidth(vLEDPos.x * ${sz}.x), fwidth(vLEDPos.y * ${sz}.y));
        float seam = 1.0 - smoothstep(0.485, 0.5, max(tile.x, tile.y)) * 0.6 * (1.0 - smoothstep(0.02, 0.08, seamFw));
        // LEDs dim off-axis
        float facing = abs(dot(vLEDN, normalize(vLEDView)));
        diffuseColor.rgb = diffuseColor.rgb * mix(1.0, cell * 1.4, showPx) * seam * uLEDGain * (0.42 + 0.58 * pow(facing, 0.6)) + vec3(uLEDFlash);${
          t
            ? `
        // the panel's own edge: a hairline gap, dark
        vec2 te = (0.5 - abs(vTileXY)) * uTileSize;
        diffuseColor.rgb *= mix(0.12, 1.0, smoothstep(0.003, 0.012, min(te.x, te.y)));
        // the back and the sides: a dark cabinet, its frame and the ribs of its modules catching a little light
        if (vTileFront < 0.5) {
          vec2 bq = abs(fract((vTileXY + 0.5) * max(floor(uTileSize * 2.0 + 0.5), vec2(1.0))) - 0.5);
          float rib = smoothstep(0.44, 0.5, max(bq.x, bq.y));
          float rim = 1.0 - smoothstep(0.02, 0.05, min(te.x, te.y));
          diffuseColor.rgb = vec3(0.016, 0.017, 0.02) * (1.0 + rib * 1.6 + rim * 2.0) * (0.45 + 0.55 * facing);
        }`
            : ''
        }`,
      );
  };
  mat.customProgramCacheKey = () => `led${size.join('x')}${o.feed ? 'f' : ''}${o.imag ? 'i' : ''}${t ? `t${crop}` : ''}`;
  mat.needsUpdate = true;
  return u;
}
