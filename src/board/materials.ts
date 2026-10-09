/*
 * Board materials (Section 13.8): matte, gloss, chrome, gold, brushed metal,
 * woods, marble, carbon fibre, clear acrylic, frosted glass, liquid metal,
 * holographic, lava, ice and galaxy (those three move), rubber, leather, and
 * your own image. Any of them can glow, on the beat or steady.
 *
 * Textures are drawn in code (TODO: Blender-made texture sets, Section 14).
 * Materials are cached by their settings, so a board of 200 knobs in three
 * colours makes three materials, not 200; the animated and beat-synced ones
 * share one set of uniforms the board updates once a frame.
 */
import * as THREE from 'three';

export const MATERIALS = [
  { id: 'matte', label: 'Matte' },
  { id: 'gloss', label: 'Gloss' },
  { id: 'chrome', label: 'Chrome' },
  { id: 'gold', label: 'Gold' },
  { id: 'brushed', label: 'Brushed metal' },
  { id: 'oak', label: 'Oak' },
  { id: 'walnut', label: 'Walnut' },
  { id: 'maple', label: 'Maple' },
  { id: 'ebony', label: 'Ebony' },
  { id: 'marble', label: 'Marble' },
  { id: 'carbon', label: 'Carbon fibre' },
  { id: 'acrylic', label: 'Clear acrylic' },
  { id: 'frosted', label: 'Frosted glass' },
  { id: 'liquid', label: 'Liquid metal', animated: true },
  { id: 'holo', label: 'Holographic', animated: true },
  { id: 'lava', label: 'Lava', animated: true },
  { id: 'ice', label: 'Ice', animated: true },
  { id: 'galaxy', label: 'Galaxy', animated: true },
  { id: 'rubber', label: 'Rubber' },
  { id: 'leather', label: 'Leather' },
  { id: 'image', label: 'Your image' },
] as const;

export type MaterialId = (typeof MATERIALS)[number]['id'];
export const MATERIAL_IDS = MATERIALS.map((m) => m.id) as readonly MaterialId[];
export const isAnimated = (id: MaterialId) => !!(MATERIALS.find((m) => m.id === id) as { animated?: boolean } | undefined)?.animated;

export interface Glow {
  color: string;
  /** 0..1 */
  intensity: number;
  /** pulse with the kick */
  beat: boolean;
}

export interface MatSpec {
  id: MaterialId;
  color: string;
  glow?: Glow | null;
  /** for 'image': a data URL (kept small by the editor) */
  image?: string;
}

/** shared by every animated or beat-synced material */
export const boardUniforms = {
  uTime: { value: 0 },
  uKick: { value: 0 },
  uBeat: { value: 0 },
};

/* ----------------------------- textures ----------------------------- */

const texCache = new Map<string, THREE.Texture>();

function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1): THREE.Texture {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

function rnd(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const WOOD: Record<string, [string, string]> = { oak: ['#b98a55', '#8a6136'], walnut: ['#5a3a22', '#2f1d10'], maple: ['#e2c79a', '#c7a46e'], ebony: ['#2a221e', '#120d0b'] };

function woodTex(kind: string): THREE.Texture {
  return canvasTex(`wood-${kind}`, 512, (g, s) => {
    const [a, b] = WOOD[kind];
    g.fillStyle = a;
    g.fillRect(0, 0, s, s);
    const r = rnd(kind.length * 97);
    for (let i = 0; i < 140; i++) {
      const y = r() * s;
      g.strokeStyle = b;
      g.globalAlpha = 0.15 + r() * 0.35;
      g.lineWidth = 0.5 + r() * 2.5;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= s; x += 32) g.lineTo(x, y + Math.sin(x * 0.012 + i) * 6 + (r() - 0.5) * 3);
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

function marbleTex(): THREE.Texture {
  return canvasTex('marble', 512, (g, s) => {
    g.fillStyle = '#ece9e4';
    g.fillRect(0, 0, s, s);
    const r = rnd(11);
    for (let i = 0; i < 28; i++) {
      g.strokeStyle = i % 3 ? 'rgba(90,90,100,0.35)' : 'rgba(150,120,80,0.3)';
      g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath();
      let x = r() * s;
      let y = 0;
      g.moveTo(x, y);
      while (y < s) {
        x += (r() - 0.5) * 40;
        y += 10 + r() * 30;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

function carbonTex(): THREE.Texture {
  return canvasTex(
    'carbon',
    128,
    (g, s) => {
      g.fillStyle = '#121316';
      g.fillRect(0, 0, s, s);
      const n = 8;
      const c = s / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const grd = (i + j) % 2 ? g.createLinearGradient(i * c, j * c, i * c + c, j * c) : g.createLinearGradient(i * c, j * c, i * c, j * c + c);
          grd.addColorStop(0, '#1d1f24');
          grd.addColorStop(0.5, '#3a3d45');
          grd.addColorStop(1, '#1d1f24');
          g.fillStyle = grd;
          g.fillRect(i * c + 1, j * c + 1, c - 2, c - 2);
        }
    },
    6,
  );
}

function brushedTex(): THREE.Texture {
  return canvasTex('brushed', 256, (g, s) => {
    g.fillStyle = '#9aa0a8';
    g.fillRect(0, 0, s, s);
    const r = rnd(5);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${0.04 + r() * 0.07})`;
      g.fillRect(0, r() * s, s, 1);
    }
  });
}

function leatherTex(): THREE.Texture {
  return canvasTex(
    'leather',
    256,
    (g, s) => {
      g.fillStyle = '#7a7a7a';
      g.fillRect(0, 0, s, s);
      const r = rnd(23);
      for (let i = 0; i < 2200; i++) {
        g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`;
        g.beginPath();
        g.arc(r() * s, r() * s, 1 + r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    },
    3,
  );
}

const imageTex = new Map<string, THREE.Texture>();
function imageTexture(url: string): THREE.Texture {
  let t = imageTex.get(url);
  if (t) return t;
  t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  imageTex.set(url, t);
  return t;
}

/* --------------------------- animated looks --------------------------- */

/**
 * The animated materials are standard materials with a pattern mixed into the
 * colour and glow in the shader, driven by the shared time and kick.
 * Patterns: lava (slow hot cells), ice (cold sparkle), galaxy (stars
 * drifting), liquid (a moving sheen), holo (colours sliding with the angle).
 */
function animate(m: THREE.MeshStandardMaterial, kind: string): void {
  const k = { lava: 0, ice: 1, galaxy: 2, liquid: 3, holo: 4 }[kind] ?? 0;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = boardUniforms.uTime;
    sh.uniforms.uKick = boardUniforms.uKick;
    sh.uniforms.uKind = { value: k };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBoardPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBoardPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime; uniform float uKick; uniform int uKind; varying vec3 vBoardPos;
float bh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float bn(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(bh(i),bh(i+vec3(1,0,0)),f.x),mix(bh(i+vec3(0,1,0)),bh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(bh(i+vec3(0,0,1)),bh(i+vec3(1,0,1)),f.x),mix(bh(i+vec3(0,1,1)),bh(i+vec3(1,1,1)),f.x),f.y),f.z); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 p = vBoardPos * 18.0;
  float t = uTime;
  if (uKind == 0) {            // lava
    float n = bn(p + vec3(0.0, t * 0.35, 0.0)) * 0.6 + bn(p * 2.3 - vec3(t * 0.2)) * 0.4;
    float hot = smoothstep(0.45, 0.8, n);
    diffuseColor.rgb = mix(vec3(0.08, 0.02, 0.01), diffuseColor.rgb, 0.35 + 0.4 * n);
    totalEmissiveRadiance += vec3(1.0, 0.32, 0.05) * hot * (1.2 + 0.8 * uKick);
  } else if (uKind == 1) {     // ice
    float n = bn(p * 1.7 + vec3(t * 0.05));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.9, 1.0), 0.5 + 0.3 * n);
    float sp = step(0.985, bh(floor(p * 3.0) + floor(t * 2.0)));
    totalEmissiveRadiance += vec3(0.6, 0.85, 1.0) * (sp * 1.5 + 0.08 * n);
  } else if (uKind == 2) {     // galaxy
    float neb = bn(p * 0.6 + vec3(t * 0.03)) * bn(p * 1.3 - vec3(t * 0.02));
    diffuseColor.rgb = vec3(0.02, 0.01, 0.05);
    float star = step(0.992, bh(floor(p * 4.0 + vec3(0.0, t * 0.4, 0.0))));
    totalEmissiveRadiance += vec3(0.5, 0.2, 0.9) * neb * 1.4 + vec3(1.0) * star * (1.2 + uKick);
  } else if (uKind == 3) {     // liquid metal
    float n = bn(p * 0.5 + vec3(sin(t * 0.7), t * 0.3, cos(t * 0.5)));
    diffuseColor.rgb = mix(diffuseColor.rgb * 0.6, vec3(0.95), smoothstep(0.3, 0.8, n));
  } else {                     // holographic
    vec3 v = normalize(vViewPosition);
    float a = dot(normal, v) * 3.0 + vBoardPos.x * 6.0 + t * 0.2;
    vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (a + vec3(0.0, 0.33, 0.67)));
    diffuseColor.rgb = mix(diffuseColor.rgb, rainbow, 0.65);
    totalEmissiveRadiance += rainbow * 0.15;
  }
}`,
      );
  };
  m.customProgramCacheKey = () => `board-anim-${k}`;
}

/** beat-synced glow: the emissive breathes with the kick, in the shader */
function beatGlow(m: THREE.MeshStandardMaterial): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uKick = boardUniforms.uKick;
    if (!sh.fragmentShader.includes('uniform float uKick')) sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uKick;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.35 + 1.1 * uKick;');
  };
  m.customProgramCacheKey = () => `${prevKey?.call(m) ?? ''}-beatglow`;
}

/* ------------------------------ materials ------------------------------ */

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function specKey(s: MatSpec): string {
  const g = s.glow;
  return `${s.id}|${s.color}|${g ? `${g.color}:${g.intensity.toFixed(2)}:${g.beat ? 1 : 0}` : '-'}|${s.id === 'image' ? (s.image ?? '').slice(-64) : ''}`;
}

/** the material for these settings (shared: don't dispose it yourself) */
export function boardMaterial(s: MatSpec): THREE.MeshStandardMaterial {
  const key = specKey(s);
  let m = matCache.get(key);
  if (m) return m;
  const col = new THREE.Color(s.color);
  const p: THREE.MeshPhysicalMaterialParameters = { color: col, roughness: 0.6, metalness: 0 };
  let phys = false;
  switch (s.id) {
    case 'matte':
      p.roughness = 0.85;
      break;
    case 'gloss':
      p.roughness = 0.18;
      p.clearcoat = 1;
      p.clearcoatRoughness = 0.1;
      phys = true;
      break;
    case 'chrome':
      p.metalness = 1;
      p.roughness = 0.1;
      p.color = col.clone().lerp(new THREE.Color('#ffffff'), 0.6);
      break;
    case 'gold':
      p.metalness = 1;
      p.roughness = 0.22;
      p.color = new THREE.Color('#d4a64a').lerp(col, 0.2);
      break;
    case 'brushed':
      p.metalness = 0.85;
      p.roughness = 0.38;
      p.map = brushedTex();
      break;
    case 'oak':
    case 'walnut':
    case 'maple':
    case 'ebony':
      p.map = woodTex(s.id);
      p.roughness = 0.55;
      p.color = new THREE.Color('#ffffff').lerp(col, 0.15);
      break;
    case 'marble':
      p.map = marbleTex();
      p.roughness = 0.2;
      p.color = new THREE.Color('#ffffff').lerp(col, 0.25);
      break;
    case 'carbon':
      p.map = carbonTex();
      p.roughness = 0.3;
      p.clearcoat = 0.8;
      phys = true;
      break;
    case 'acrylic':
      p.transparent = true;
      p.opacity = 0.35;
      p.roughness = 0.05;
      p.transmission = 0.9;
      p.thickness = 0.01;
      phys = true;
      break;
    case 'frosted':
      p.transparent = true;
      p.opacity = 0.55;
      p.roughness = 0.6;
      p.transmission = 0.6;
      phys = true;
      break;
    case 'liquid':
      p.metalness = 1;
      p.roughness = 0.15;
      break;
    case 'holo':
      p.metalness = 0.6;
      p.roughness = 0.25;
      break;
    case 'lava':
    case 'galaxy':
      p.roughness = 0.7;
      break;
    case 'ice':
      p.roughness = 0.15;
      p.transparent = true;
      p.opacity = 0.85;
      break;
    case 'rubber':
      p.roughness = 0.95;
      break;
    case 'leather':
      p.map = leatherTex();
      p.roughness = 0.7;
      break;
    case 'image':
      if (s.image) p.map = imageTexture(s.image);
      p.color = new THREE.Color('#ffffff');
      p.roughness = 0.5;
      break;
  }
  if (s.glow && s.glow.intensity > 0) {
    p.emissive = new THREE.Color(s.glow.color);
    p.emissiveIntensity = s.glow.intensity * 2.4;
  }
  m = phys ? new THREE.MeshPhysicalMaterial(p) : new THREE.MeshStandardMaterial(p as THREE.MeshStandardMaterialParameters);
  if (isAnimated(s.id)) animate(m, s.id);
  if (s.glow?.beat && s.glow.intensity > 0) beatGlow(m);
  m.userData.boardShared = true;
  matCache.set(key, m);
  return m;
}

/** how much a material costs to draw, roughly (the performance meter, Section 13.13) */
export function materialCost(s: MatSpec): number {
  if (isAnimated(s.id)) return 3;
  if (s.id === 'acrylic' || s.id === 'frosted') return 2.5;
  if (s.id === 'gloss' || s.id === 'carbon') return 1.4;
  return 1;
}

/** once a frame from the board: time and the kick */
export function updateBoardUniforms(dt: number, kick: number, beat: number): void {
  boardUniforms.uTime.value += dt;
  boardUniforms.uKick.value = kick;
  boardUniforms.uBeat.value = beat;
}
