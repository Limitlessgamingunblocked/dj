import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DepthTap } from '../src/three/ao';
import { LensOutputPass } from '../src/three/lens';
import { REFLECT_LAYER, ReflectPass } from '../src/three/reflect';

const target = (w: number, h: number) => ({ width: w, height: h, texture: new THREE.Texture() }) as unknown as THREE.WebGLRenderTarget;

describe('the lens flare at the page resolution', () => {
  const sep = (l: LensOutputPass, w: number, h: number) => (l as unknown as { flareSeparately(r: THREE.WebGLRenderTarget): boolean }).flareSeparately(target(w, h));

  it('gets its own pass only when the frame is drawn well over the page resolution', () => {
    const l = new LensOutputPass();
    l.uniforms.uStreak.value = 0.3;
    l.uniforms.uTaps.value = 11;
    // a Retina screen: the frame at twice the page's pixels each way
    l.flareAt(1440, 900);
    expect(sep(l, 2880, 1800)).toBe(true);
    // the frame at the page's own resolution: the flare stays in the output pass, exactly as before
    expect(sep(l, 1440, 900)).toBe(false);
    // a slightly finer frame isn't worth a pass of its own
    expect(sep(l, 1600, 1000)).toBe(false);
  });

  it('skips the pass when there is no flare to draw', () => {
    const l = new LensOutputPass();
    l.flareAt(1440, 900);
    const u = l.uniforms;
    u.uStreak.value = 0;
    u.uGhost.value = 0;
    u.uStar.value = 0;
    expect(sep(l, 2880, 1800)).toBe(false);
    u.uGhost.value = 0.2;
    expect(sep(l, 2880, 1800)).toBe(true);
    u.uGhost.value = 0;
    u.uStar.value = 0.018;
    u.uStarDirs.value = 3;
    expect(sep(l, 2880, 1800)).toBe(true);
  });
});

describe('the floor reflection keeps the light setup and the matrices', () => {
  it('draws with the same lights at zero, then puts them back', () => {
    const scene = new THREE.Scene();
    const key = new THREE.SpotLight(0xffffff, 15);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    const off = new THREE.PointLight(0xffffff, 2);
    off.visible = false;
    scene.add(key, fill, off);
    const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
    cam.position.set(0, 1.7, 4);
    cam.updateMatrixWorld();
    const tap = new DepthTap(cam);
    tap.depth = new THREE.DepthTexture(1, 1);
    const pass = new ReflectPass(scene, cam, tap);
    pass.floor = { y: 0, strength: 0.5 };
    // a renderer that only records what the reflection was drawn with
    const seen: number[][] = [];
    const worldAuto: boolean[] = [];
    const renderer = {
      clippingPlanes: [] as THREE.Plane[],
      autoClear: true,
      shadowMap: { autoUpdate: true },
      getClearColor: (c: THREE.Color) => c,
      getClearAlpha: () => 1,
      setClearColor: () => {},
      setRenderTarget: () => {},
      clear: () => {},
      render: (s: THREE.Object3D) => {
        if (s === scene) {
          seen.push([key.intensity, fill.intensity, off.intensity]);
          worldAuto.push(scene.matrixWorldAutoUpdate);
        }
      },
    } as unknown as THREE.WebGLRenderer;
    pass.render(renderer, target(4, 4), target(4, 4));
    expect(seen).toEqual([[0, 0, 2]]);
    expect([key.intensity, fill.intensity, off.intensity]).toEqual([15, 0.3, 2]);
    // the reflection camera sees the visible lights, so its light setup matches the main frame's
    const layer = new THREE.Layers();
    layer.set(REFLECT_LAYER);
    expect(key.layers.test(layer) && fill.layers.test(layer)).toBe(true);
    // and the main camera still does
    expect(key.layers.test(cam.layers)).toBe(true);
    // the main pass has placed everything this frame: the reflection doesn't go through every object's matrix again
    expect(worldAuto).toEqual([false]);
    expect(scene.matrixWorldAutoUpdate).toBe(true);
  });
});
