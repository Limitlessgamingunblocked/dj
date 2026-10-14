/*
 * The Dome's ceiling: one LED screen over the whole hemisphere, drawn by one
 * material on one mesh. It shows two things and crossfades between them
 * (domeEye.ts says when):
 *   – the visual player, laid over the dome the way fulldome shows map a flat
 *     picture: the main frame centred above the stage as the crowd sees it
 *     (an azimuthal equidistant projection from a spot in the crowd, so the
 *     middle isn't stretched), and mirrored copies of it filling the rest of
 *     the dome out to the back, a little dimmer the further out they are
 *   – the giant eye, drawn for the same spot in the crowd (a flat picture
 *     seen through the dome, so it looks round from the floor): almond lids
 *     with lashes against a warm glow, a veined white, an iris of radial
 *     fibres from teal to amber with a dark ring at its edge, and a pupil
 *     that pumps with the kick. On the drop, rings run out from it on every
 *     beat and rays flicker round it.
 * The LED structure is over everything: rings of 0.5 m panels round the dome
 * (fewer per ring towards the top, as real domes are built), each a grid of
 * LEDs at a 25 mm pitch. The pixels show only when each covers a couple of
 * screen pixels (so there's no moiré across the room), the panel seams a
 * little further out, and LEDs dim seen off-axis.
 *
 * It's a MeshBasicMaterial with its colour replaced, so the stage hands it
 * the visual player's texture like every other venue screen. The Low tier
 * drops the LED pixels, the veins and the finer iris fibres.
 */
import * as THREE from 'three';

export interface DomeSpec {
  /** the sphere's centre and radius */
  centre: THREE.Vector3;
  radius: number;
  /** the spot in the crowd the pictures are drawn for (head height) */
  sweet: THREE.Vector3;
  /** from there, the direction of the eye's middle */
  eyeAt: THREE.Vector3;
  /** the eye's half-width, as the tangent of the half-angle it covers from the sweet spot */
  eyeHalf: number;
  /** from there, the direction of the visual player's main frame */
  visAt: THREE.Vector3;
  /** half the main frame's width and height, radians from its middle */
  visHalf: [number, number];
  /** LED pitch and panel size, metres */
  pitch: number;
  panel: number;
}

/** what dome.ts drives every frame */
export interface DomeUniforms {
  /** 0 the visual player .. 1 the eye's dark sky */
  uScreen: { value: number };
  /** the lid opening (0 shut, 1 relaxed, ~1.3 wide) */
  uOpen: { value: number };
  uGaze: { value: THREE.Vector2 };
  /** pupil radius as a share of the iris */
  uPupil: { value: number };
  uWide: { value: number };
  uKick: { value: number };
  uBeat: { value: number };
  uTime: { value: number };
  /** the glow round the eye */
  uGlow: { value: THREE.Color };
  /** the eye's brightness, and the visual player's */
  uEyeGain: { value: number };
  uVisGain: { value: number };
  /** the show's master level (blackouts), and a white flash over the whole dome */
  uLevel: { value: number };
  uFlash: { value: number };
  /** 1: LED pixels, veins and fine fibres (Medium and High); 0: Low */
  uDetail: { value: number };
}

/** A right-handed frame looking along `at`: x to the right and y up, as seen from inside. */
export function lookFrame(at: THREE.Vector3): { e: THREE.Vector3; x: THREE.Vector3; y: THREE.Vector3 } {
  const e = at.clone().normalize();
  const x = new THREE.Vector3().crossVectors(e, new THREE.Vector3(0, 1, 0)).normalize();
  const y = new THREE.Vector3().crossVectors(x, e).normalize();
  return { e, x, y };
}

/**
 * Where a direction from the sweet spot lands in the visual player's picture
 * (the same maths as the shader): (u, v) in 0..1 inside the main frame,
 * mirrored repeats outside it, and how many frames out it is.
 */
export function visUV(dir: THREE.Vector3, spec: Pick<DomeSpec, 'visAt' | 'visHalf'>): { u: number; v: number; out: number } {
  const f = lookFrame(spec.visAt);
  const d = dir.clone().normalize();
  const th = Math.acos(Math.min(1, Math.max(-1, d.dot(f.e))));
  const tx = d.dot(f.x);
  const ty = d.dot(f.y);
  const tl = Math.hypot(tx, ty);
  const qx = tl > 1e-5 ? (tx / tl) * th : 0;
  const qy = tl > 1e-5 ? (ty / tl) * th : 0;
  const px = qx / spec.visHalf[0];
  const py = qy / spec.visHalf[1];
  const mirror = (a: number) => {
    const m = (((a * 0.5 + 0.5) % 2) + 2) % 2;
    return 1 - Math.abs(1 - m);
  };
  return { u: mirror(px), v: mirror(py), out: Math.max(0, Math.abs(px) - 1, Math.abs(py) - 1) };
}

const GLSL = /* glsl */ `
  varying vec3 vDomeW;
  uniform vec3 uSweet, uEyeE, uEyeX, uEyeY, uVisA, uVisX, uVisY, uCentre, uGlow;
  uniform vec2 uVisHalf, uGaze;
  uniform float uEyeHalf, uRadius, uScreen, uOpen, uPupil, uWide, uKick, uBeat, uTime, uEyeGain, uVisGain, uLevel, uFlash, uDetail;

  float dmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float dmNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(dmHash(i), dmHash(i + vec2(1.0, 0.0)), f.x), mix(dmHash(i + vec2(0.0, 1.0)), dmHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // value noise that wraps round every per cells across x (all the way round the iris)
  float dmNoiseWrap(vec2 p, float per) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float x0 = mod(i.x, per);
    float x1 = mod(i.x + 1.0, per);
    return mix(mix(dmHash(vec2(x0, i.y)), dmHash(vec2(x1, i.y)), f.x), mix(dmHash(vec2(x0, i.y + 1.0)), dmHash(vec2(x1, i.y + 1.0)), f.x), f.y);
  }
  float dmSq(float x) { return x * x; }

  // the lids: where the upper and lower ones are at x (the eye runs x -1..1), for an opening
  float dmTop(float f, float open) { float shut = -0.07 * f; return shut + (0.40 * pow(f, 0.8) - shut) * open; }
  float dmBot(float f, float open) { float shut = -0.07 * f; return shut + (-0.30 * f - shut) * open; }

  // The eye at L, a point in its own plane (x -1..1 corner to corner, y up). cover: how much of
  // this point is the eye itself rather than lid or sky.
  vec3 dmEye(vec2 L, float aa, out float cover) {
    float f = max(0.0, 1.0 - L.x * L.x);
    float top = dmTop(f, uOpen);
    float bot = dmBot(f, uOpen);
    cover = smoothstep(-aa, aa, top - L.y) * smoothstep(-aa, aa, L.y - bot) * step(abs(L.x), 1.0);
    if (cover <= 0.0) return vec3(0.0);
    // the white: a ball, shaded round its edge, pinker and darker into the corners, veined towards them
    float ball = 0.22 + 0.78 * sqrt(max(0.0, 1.0 - 0.8 * L.x * L.x - 2.2 * L.y * L.y));
    float corner = smoothstep(0.45, 1.0, abs(L.x));
    vec3 col = mix(vec3(0.74, 0.71, 0.67), vec3(0.62, 0.36, 0.34), corner * 0.55) * ball * (1.0 - 0.35 * corner);
    col *= 0.62 + 0.38 * smoothstep(0.0, 0.09, L.y - bot);
    if (uDetail > 0.5) {
      float v1 = 1.0 - smoothstep(0.0, 0.045, abs(dmNoise(L * 7.0 + 3.1) - 0.5));
      float v2 = 1.0 - smoothstep(0.0, 0.035, abs(dmNoise(L * 16.0 + 11.7) - 0.5));
      float veins = max(v1, v2 * 0.6) * smoothstep(0.3, 0.95, abs(L.x));
      col = mix(col, vec3(0.62, 0.05, 0.06), veins * 0.75);
    }
    // the iris sits on the ball: it foreshortens as the eye turns
    vec2 g = uGaze;
    vec2 q = L - g;
    float gl = length(g);
    vec2 gd = gl > 1e-4 ? g / gl : vec2(1.0, 0.0);
    q += gd * dot(q, gd) * 0.9 * gl;
    float IR = 0.34;
    float rr = length(q) / IR;
    if (rr < 1.05) {
      float au = atan(q.y, q.x) / 6.2831853 + 0.5;
      float fib = dmNoiseWrap(vec2(au * 64.0, rr * 3.0 - uTime * 0.04), 64.0) * 0.6;
      fib += (uDetail > 0.5 ? dmNoiseWrap(vec2(au * 150.0, rr * 1.4 + 7.0), 150.0) : 0.5) * 0.4;
      vec3 teal = vec3(0.03, 0.6, 0.62);
      vec3 amber = vec3(1.0, 0.58, 0.13);
      vec3 ic = mix(teal, amber, smoothstep(0.3, 0.9, rr + (fib - 0.5) * 0.3)) * (0.3 + 1.0 * fib);
      // a bright amber ring round the pupil, a dark ring at the edge
      ic += amber * 0.45 * exp(-dmSq((rr - uPupil - 0.1) / 0.07));
      ic *= 1.0 - 0.85 * smoothstep(0.8, 1.0, rr);
      // it glows: up on the kick, blazing on the drop
      ic *= 1.0 + 0.3 * uKick + 0.7 * uWide;
      float iaa = aa / IR * 1.5;
      col = mix(col, ic, 1.0 - smoothstep(1.0 - iaa, 1.0, rr));
      col = mix(col, vec3(0.004), 1.0 - smoothstep(uPupil - iaa, uPupil + iaa, rr));
    }
    // the upper lid's shadow, then the light on the wet cornea (two highlights over the iris, moving with it a little less than it turns)
    col *= 0.3 + 0.7 * smoothstep(0.0, 0.22, top - L.y);
    vec2 hp = g * 0.85;
    col += vec3(1.0, 0.97, 0.92) * (1.0 - smoothstep(0.026, 0.046, length(L - hp - vec2(-0.1, 0.11)))) * 0.9;
    col += vec3(1.0) * (1.0 - smoothstep(0.01, 0.02, length(L - hp - vec2(0.08, -0.07)))) * 0.45;
    // the wet line along the lower lid
    col += vec3(0.55, 0.16, 0.15) * exp(-dmSq((L.y - bot) / 0.012)) * f * 0.6;
    return col;
  }
`;

const MAIN = (o: { pitch: number; panel: number; radius: number }) => /* glsl */ `
  vec3 dmD = normalize(vDomeW - uSweet);

  // the LED structure: rings of panels round the dome, LEDs in each (derivatives first, outside any branch)
  vec3 dmRel = vDomeW - uCentre;
  float dmRl = max(length(dmRel), 1e-3);
  float dmLat = asin(clamp(dmRel.y / dmRl, -1.0, 1.0));
  float dmLon = atan(dmRel.x, dmRel.z);
  float dmRingH = ${(o.panel / o.radius).toFixed(6)};
  float dmRing = floor(dmLat / dmRingH);
  float dmN = max(1.0, floor(6.2831853 * ${o.radius.toFixed(3)} * cos((dmRing + 0.5) * dmRingH) / ${o.panel.toFixed(3)}));
  vec2 dmPan = vec2((dmLon / 6.2831853 + 0.5) * dmN, dmLat / dmRingH);
  vec2 dmPx = dmPan * ${(o.panel / o.pitch).toFixed(3)};
  float dmFw = max(fwidth(dmPx.x), fwidth(dmPx.y));
  float dmPfw = max(fwidth(dmPan.x), fwidth(dmPan.y));

  // the eye's plane (computed out here too, for its derivatives)
  float dmDe = dot(dmD, uEyeE);
  vec2 dmL = vec2(dot(dmD, uEyeX), dot(dmD, uEyeY)) / (max(dmDe, 0.12) * uEyeHalf);
  float dmAa = fwidth(dmL.y) * 1.2 + 0.002;

  // the visual player: the main frame over the stage, mirrored copies round the rest
  vec3 dmVis = vec3(0.0);
  #ifdef USE_MAP
  if (uScreen < 0.999) {
    float th = acos(clamp(dot(dmD, uVisA), -1.0, 1.0));
    vec2 tv = vec2(dot(dmD, uVisX), dot(dmD, uVisY));
    float tl = length(tv);
    vec2 pv = (tl > 1e-5 ? tv * (th / tl) : vec2(0.0)) / uVisHalf;
    vec2 uv = mod(pv * 0.5 + 0.5, 2.0);
    uv = 1.0 - abs(1.0 - uv);
    dmVis = texture2D(map, uv).rgb;
    vec2 dmOut = max(abs(pv) - 1.0, 0.0);
    dmVis *= uVisGain / (1.0 + 0.55 * dot(dmOut, dmOut));
  }
  #endif

  // the eye in its dark sky
  vec3 dmEyeCol = vec3(0.0);
  if (uScreen > 0.001) {
    vec3 sky = vec3(0.004, 0.003, 0.008);
    if (dmDe > 0.12) {
      vec2 L = dmL;
      // the warm glow round it, beating with the kick, flaring on the drop
      float r2 = length(L * vec2(0.85, 1.7));
      sky += uGlow * exp(-r2 * 2.4) * (0.12 + 0.12 * uKick + 0.45 * uWide);
      // the drop: rings out from it on every beat, rays flickering round it
      if (uWide > 0.01) {
        float ph = fract(uBeat);
        float ring = exp(-dmSq((r2 - 0.9 - ph * 2.6) / (0.05 + 0.1 * ph))) * (1.0 - ph);
        float rays = dmNoiseWrap(vec2((atan(L.y, L.x) / 6.2831853 + 0.5) * 48.0, uTime * 0.6), 48.0);
        rays = smoothstep(0.55, 0.95, rays) * exp(-max(r2 - 0.7, 0.0) * 0.8);
        sky += uGlow * (ring * 0.9 + rays * 0.6) * uWide;
      }
      // lashes along the upper lid, black against the glow, leaning out from the middle; the lid's crease
      float f = max(0.0, 1.0 - L.x * L.x);
      float h = L.y - dmTop(f, uOpen);
      float len = 0.02 + 0.1 * f;
      float lx = L.x + sign(L.x) * max(h, 0.0) * 0.6;
      float dl = abs(fract(lx * 24.0) - 0.5) / 24.0;
      float wl = 0.0016 + 0.0045 * clamp(1.0 - h / len, 0.0, 1.0);
      float lash = (1.0 - smoothstep(wl, wl + dmAa, dl)) * step(0.0, h) * (1.0 - smoothstep(len * 0.6, len, h)) * (1.0 - smoothstep(0.75, 1.0, abs(L.x)));
      float crease = exp(-dmSq((L.y - 0.40 * pow(f, 0.8) - 0.12 * f) / 0.012)) * (1.0 - smoothstep(0.6, 1.0, abs(L.x)));
      sky *= (1.0 - 0.92 * lash) * (1.0 - 0.55 * crease);
      float cover;
      vec3 e = dmEye(L, dmAa, cover);
      sky = mix(sky, e * uEyeGain, cover);
    }
    dmEyeCol = sky;
  }
  vec3 dmCol = mix(dmVis, dmEyeCol, uScreen);

  // LEDs up close, panel seams a little further out, dimmer off-axis
  vec2 dmCell = abs(fract(dmPx) - 0.5);
  float dmShow = (1.0 - smoothstep(0.25, 0.6, dmFw)) * uDetail;
  float dmLed = smoothstep(0.5, 0.3, max(dmCell.x, dmCell.y));
  vec2 dmPd = abs(fract(dmPan) - 0.5);
  float dmSeam = 1.0 - 0.4 * smoothstep(0.47, 0.5, max(dmPd.x, dmPd.y)) * (1.0 - smoothstep(0.03, 0.1, dmPfw));
  float dmFacing = abs(dot(dmRel / dmRl, normalize(vDomeW - cameraPosition)));
  dmCol *= mix(1.0, dmLed * 1.45, dmShow) * dmSeam * (0.55 + 0.45 * sqrt(dmFacing));
  // the panels' black face, catching the room's light
  dmCol += vec3(0.005, 0.005, 0.007) * dmSeam;
  diffuseColor.rgb = clamp(dmCol * uLevel + vec3(uFlash), 0.0, 4.0);
`;

/**
 * Turn `mat` into the dome's screen for the hemisphere described by `spec`.
 * Returns the uniforms to drive each frame.
 */
export function domeScreen(mat: THREE.MeshBasicMaterial, spec: DomeSpec): DomeUniforms {
  const eye = lookFrame(spec.eyeAt);
  const vis = lookFrame(spec.visAt);
  const u: DomeUniforms = {
    uScreen: { value: 1 },
    uOpen: { value: 0.6 },
    uGaze: { value: new THREE.Vector2() },
    uPupil: { value: 0.33 },
    uWide: { value: 0 },
    uKick: { value: 0 },
    uBeat: { value: 0 },
    uTime: { value: 0 },
    uGlow: { value: new THREE.Color(1, 0.55, 0.22) },
    uEyeGain: { value: 1 },
    uVisGain: { value: 1 },
    uLevel: { value: 1 },
    uFlash: { value: 0 },
    uDetail: { value: 1 },
  };
  const fixed = {
    uSweet: { value: spec.sweet.clone() },
    uEyeE: { value: eye.e },
    uEyeX: { value: eye.x },
    uEyeY: { value: eye.y },
    uEyeHalf: { value: spec.eyeHalf },
    uVisA: { value: vis.e },
    uVisX: { value: vis.x },
    uVisY: { value: vis.y },
    uVisHalf: { value: new THREE.Vector2(...spec.visHalf) },
    uCentre: { value: spec.centre.clone() },
    uRadius: { value: spec.radius },
  };
  mat.color.set(0xffffff);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, fixed);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDomeW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDomeW = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL}`).replace('#include <map_fragment>', MAIN(spec));
  };
  mat.customProgramCacheKey = () => `dome${spec.radius}|${spec.pitch}|${spec.panel}`;
  mat.needsUpdate = true;
  return u;
}

/**
 * A patch of the dome's inside surface (a band of azimuth and elevation about
 * the sphere's centre, `inset` metres in from it), with UVs across it: u along
 * the azimuth from `az1` to `az0` (left to right seen from inside), v up.
 * Azimuth 0 is +Z, elevations are above the centre's level.
 */
export function domePatch(radius: number, az0: number, az1: number, el0: number, el1: number, inset = 0.1, segs = 32): THREE.BufferGeometry {
  const r = radius - inset;
  const nx = segs;
  const ny = Math.max(2, Math.round((segs * (el1 - el0)) / Math.max(1e-3, az1 - az0)));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= ny; j++) {
    const el = el0 + ((el1 - el0) * j) / ny;
    for (let i = 0; i <= nx; i++) {
      const az = az1 - ((az1 - az0) * i) / nx;
      pos.push(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
      uv.push(i / nx, j / ny);
    }
  }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
