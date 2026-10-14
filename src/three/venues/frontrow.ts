/*
 * The front row: the couple of dozen dancers nearest the booth, the people
 * the close cameras (the booth, over the DJ's shoulder, the crowd shots) look
 * straight at. They are the same people the crowd places, dressed and posed
 * by the same shader (crowd.ts), just built from a much more detailed model
 * and drawn by one instanced mesh of their own in place of their low-detail
 * selves, so they dance in step with everyone else.
 *
 *   – the head: a face with real features (eyes in sockets that blink, brows,
 *     a nose, lips that open to shout and sing along, cheekbones, a chin,
 *     ears), hair with volume (clumped, curls, buns, long hair that waves)
 *   – hands: a palm, four fingers and a thumb
 *   – layers by the venue's look: open jackets, hoodies with the hood down,
 *     short-sleeved shirts, gilets, fur coats (the playa), leather and
 *     harnesses (Berghain), swimwear (the beach), crossbody bags, bucket hats,
 *     sunglasses, goggles, bandanas, fur collars
 *   – props: glowsticks that glow, hand fans, phones with the camera app lit
 *     up, as well as the crowd's drinks and towel
 *   – the show on them: the rig's colours on their faces, a phone's glow when
 *     they film, sweat that builds into a sheen and beads over a long peak
 *
 * The model keeps the crowd's skeleton (the same joints and bones), so the
 * crowd's pose code moves it unchanged. About 5,000 triangles a person.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BODY_MATS, headKit, PALM, part, PERSON_BONES as B, PERSON_HEAD, PERSON_MATS as M, props } from './crowd';
import { BODY_REGION, bodyGeometry, browGeometry, fixMorphTypes, hairGeometry, JOINTS, LANDMARKS, shellGeometry, shoeShape, WAIST_Y, welded } from './crowdbody';

/** the venue's look: what the front row wears */
export type CrowdLook = 'club' | 'dark' | 'beach' | 'festival' | 'playa';
export const LOOK_CODE: Record<CrowdLook, number> = { club: 0, dark: 1, beach: 2, festival: 3, playa: 4 };

/* the front row's own materials, after the crowd's */
/** where the outer layer stops: just over the hips, and a little short of the wrists */
const SHELL_HEM = JOINTS.hip[1] - 0.06;
const SHELL_CUFF = JOINTS.wrist[1] + 0.025;
export const FRONT_MATS = { eye: 18, brow: 19, shell: 20, shellLo: 21, hood: 22, strap: 23, glasses: 24, hat: 25, glow: 26, fan: 27, curls: 28, bun: 29, collar: 30, goggles: 31, harness: 32 };
/* (the eye, curls and bun are the crowd's own now: PERSON_MATS) */
const F = FRONT_MATS;

/** a thin surface seen from both sides (a brim, a fan, a lens) */
function twoSided(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const a = g.index ? g.toNonIndexed() : g;
  const b = a.clone();
  const n = b.attributes.normal;
  for (let i = 0; i < n.count; i += 3) {
    // swap two corners to flip the winding
    for (const attr of Object.values(b.attributes)) {
      const s = attr.itemSize;
      const arr = attr.array as Float32Array;
      for (let k = 0; k < s; k++) {
        const t = arr[(i + 1) * s + k];
        arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
        arr[(i + 2) * s + k] = t;
      }
    }
  }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return mergeVertices(mergeGeometries([a, b])!, 1e-7);
}

export interface FacePoints {
  /** an eye's centre (right side; mirror x for the left) and radius */
  eye: THREE.Vector3;
  eyeR: number;
}

let frontGeo: THREE.BufferGeometry | null = null;

/** the eyes, for the shaders that paint them */
export function facePoints(): FacePoints {
  return { eye: new THREE.Vector3(...LANDMARKS.eye), eyeR: LANDMARKS.eyeR };
}

/**
 * The front row's model: the crowd's body at its close-up detail (crowdbody.ts),
 * in the crowd's rest pose and skeleton, with brows, the outer layers made
 * from the body's own surface (so a jacket fits every figure), and the kit
 * placed from the body's landmarks.
 */
export function frontGeometry(): THREE.BufferGeometry {
  if (frontGeo) return frontGeo;
  const parts: THREE.BufferGeometry[] = [];
  const E = LANDMARKS.eye;
  const H = PERSON_HEAD;
  const R = BODY_REGION;
  parts.push(bodyGeometry(0, BODY_MATS, { eyes: true }), hairGeometry(0, M.hair), browGeometry(0, F.brow));
  for (const sd of [-1, 1]) parts.push(part(welded(shoeShape(sd, 18, 10)), sd < 0 ? B.shinL : B.shinR, M.shoes));
  parts.push(...headKit(false), ...props(false));

  // the outer layer (a jacket, a hoodie, a shirt, a coat, a gilet) over the top and the arms, to the hips and the wrists
  parts.push(
    shellGeometry(
      0,
      // whole triangles to a little past the hem and the cuffs; the shader cuts them straight
      (r, y) =>
        (r === R.torso || r === R.thigh) && y > SHELL_HEM - 0.04 ? F.shell : r === R.upper ? F.shell : r === R.fore && y > SHELL_CUFF - 0.035 ? F.shellLo : null,
      0.009,
    ),
  );
  // the hood, down: rolled round the back of the neck and lying between the shoulders
  const NB = LANDMARKS.neckBase;
  const nz = JOINTS.neck[2];
  parts.push(part(new THREE.TorusGeometry(0.08, 0.03, 5, 10, Math.PI * 1.25).rotateZ(Math.PI * 1.25).rotateX(Math.PI / 2).scale(1.2, 1, 1).translate(0, NB - 0.015, nz - 0.02), B.body, F.hood));
  parts.push(part(new THREE.SphereGeometry(0.11, 8, 4).scale(1, 1.05, 0.3).translate(0, NB - 0.13, nz - 0.135), B.body, F.hood));
  // a collar: a fur collar, a bandana or a choker by the venue
  parts.push(part(new THREE.TorusGeometry(0.058, 0.012, 5, 16).rotateX(Math.PI / 2).scale(1.05, 0.8, 1.05).rotateX(-0.25).translate(0, JOINTS.neck[1] - 0.04, nz + 0.012), B.head, F.collar));
  // a crossbody bag's pouch at the hip (the strap is painted over the top and the jacket)
  parts.push(part(new THREE.SphereGeometry(1, 10, 6).scale(0.078, 0.048, 0.03).translate(-0.11, WAIST_Y + 0.02, 0.135), B.body, F.strap));
  // a harness's steel ring at the chest (the straps are painted)
  parts.push(part(new THREE.TorusGeometry(0.017, 0.004, 4, 10).translate(0, 1.3, LANDMARKS.chestZ + 0.008), B.body, F.harness));

  // a bucket hat: the crown and a sloping brim
  parts.push(part(new THREE.CylinderGeometry(0.084, 0.096, 0.075, 14, 1).scale(1.0, 1, 1.12).translate(0, LANDMARKS.headTop - 0.03, H.c.z - 0.005), B.head, F.hat));
  parts.push(part(twoSided(new THREE.CylinderGeometry(0.1, 0.152, 0.04, 14, 1, true).scale(1.0, 1, 1.12).translate(0, LANDMARKS.headTop - 0.085, H.c.z - 0.005)), B.head, F.hat));
  // sunglasses: two lenses over the eyes, the top bar, the arms back to the ears
  const lensZ = E[2] + LANDMARKS.eyeR * 0.75 + 0.012;
  for (const sd of [-1, 1]) {
    parts.push(part(twoSided(new THREE.CircleGeometry(0.022, 12).scale(1.15, 0.86, 1).rotateY(sd * 0.14).translate(sd * E[0], E[1] - 0.002, lensZ)), B.head, F.glasses));
    parts.push(part(new THREE.BoxGeometry(0.0045, 0.006, 0.12).translate(sd * (LANDMARKS.earX - 0.006), E[1] + 0.01, lensZ - 0.065), B.head, F.glasses));
  }
  parts.push(part(new THREE.BoxGeometry(LANDMARKS.earX * 2 - 0.008, 0.006, 0.006).translate(0, E[1] + 0.014, lensZ - 0.002), B.head, F.glasses));
  // goggles up on the forehead (the playa): a band round the head and two round lenses
  parts.push(part(new THREE.CylinderGeometry(1, 1, 0.022, 18, 1, true).scale(H.r.x + 0.006, 1, H.r.z + 0.008).translate(0, E[1] + 0.058, H.c.z), B.head, F.goggles));
  for (const sd of [-1, 1]) parts.push(part(new THREE.CylinderGeometry(0.025, 0.027, 0.02, 10, 1).rotateX(Math.PI / 2).rotateY(sd * 0.3).translate(sd * 0.034, E[1] + 0.062, LANDMARKS.headFront - 0.01), B.head, F.goggles));
  // a glowstick in the left fist, pointing forward; a folding fan, open, from the left hand
  const P = PALM;
  parts.push(part(new THREE.CylinderGeometry(0.0065, 0.0065, 0.19, 6, 1).rotateX(Math.PI / 2 - 0.35).translate(-P.x, P.y - 0.03, P.z + 0.03), B.foreL, F.glow));
  parts.push(part(twoSided(new THREE.CircleGeometry(0.17, 12, Math.PI * 1.08, Math.PI * 0.84).rotateY(Math.PI / 2).translate(-P.x, P.y - 0.04, P.z + 0.02)), B.foreL, F.fan));
  frontGeo = fixMorphTypes(mergeGeometries(parts.map((g) => (g.index ? g : mergeVertices(g, 1e-9))))!);
  return frontGeo;
}

/* ------------------------------------------------------------------ shaders */

/** what each person in the front row wears: shared by the vertex shader (what shows) and the fragment shader (its colours) */
export const FRONT_COMMON = /* glsl */ `
  uniform float uOutfit;
  /* each person's picks, made in the vertex shader: the outer layer, bare top, bag strap, harness; two free picks */
  varying vec4 vPick;
  varying vec2 vPick2;
  float fHash(vec4 s, float k) { return fract(sin(dot(s, vec4(12.9898, 78.233, 45.164, 94.673)) * (1.0 + k * 0.137) + k * 17.17) * 43758.5453); }
  /* a chance by the venue's look: club, dark, beach, festival, playa */
  float byLook(vec4 a, float playa) { return uOutfit < 0.5 ? a.x : uOutfit < 1.5 ? a.y : uOutfit < 2.5 ? a.z : uOutfit < 3.5 ? a.w : playa; }
  /* the outer layer: 0 none, 1 open jacket, 2 hoodie, 3 open short-sleeved shirt, 4 fur coat, 5 gilet */
  float frontShell(vec4 s) {
    float h = fHash(s, 1.0);
    vec4 c; float v;
    if (uOutfit < 0.5) { c = vec4(0.2, 0.4, 0.48, 0.48); v = 0.53; }
    else if (uOutfit < 1.5) { c = vec4(0.38, 0.44, 0.46, 0.46); v = 0.56; }
    else if (uOutfit < 2.5) { c = vec4(0.02, 0.04, 0.42, 0.42); v = 0.46; }
    else if (uOutfit < 3.5) { c = vec4(0.18, 0.34, 0.44, 0.44); v = 0.54; }
    else { c = vec4(0.05, 0.07, 0.17, 0.47); v = 0.65; }
    return h < c.x ? 1.0 : h < c.y ? 2.0 : h < c.z ? 3.0 : h < c.w ? 4.0 : h < v ? 5.0 : 0.0;
  }
  /* bare top (shirtless, or a bikini top at the beach) */
  bool frontSwim(vec4 s, float shell) { return (shell < 0.5 || shell > 2.5 && shell < 3.5) && fHash(s, 2.0) < byLook(vec4(0.0, 0.22, 0.55, 0.08), 0.3); }
  bool frontPick(vec4 s, float k, vec4 a, float playa) { return fHash(s, k) < byLook(a, playa); }
`;

/** inside computePose: what of the front row's kit shows */
export const FRONT_VIS = /* glsl */ `
    {
      float fShell = frontShell(iSeed);
      float hatOn = (frontPick(iSeed, 5.0, vec4(0.04, 0.0, 0.24, 0.24), 0.14) ? 1.0 : 0.0) * (1.0 - capOn) * (1.0 - staff);
      float glowOn = (frontPick(iSeed, 9.0, vec4(0.3, 0.04, 0.12, 0.32), 0.42) ? 1.0 : 0.0) * (1.0 - staff) * (1.0 - dj);
      float fanOn = (frontPick(iSeed, 10.0, vec4(0.08, 0.16, 0.1, 0.06), 0.1) ? 1.0 : 0.0) * (1.0 - glowOn) * (1.0 - staff) * (1.0 - dj);
      float leftFree = (1.0 - step(0.5, wDrink)) * (1.0 - sign);
      float m = aMat;
      vPick = vec4(fShell, frontSwim(iSeed, fShell) ? 1.0 : 0.0, frontPick(iSeed, 6.0, vec4(0.3, 0.08, 0.12, 0.45), 0.3) ? 1.0 : 0.0, frontPick(iSeed, 7.0, vec4(0.04, 0.35, 0.0, 0.0), 0.06) ? 1.0 : 0.0);
      vPick2 = vec2(fHash(iSeed, 21.0), fHash(iSeed, 22.0));
      // the front row's own kit (the eye, curls, bun and ponytail are the crowd's)
      if ((m > 18.5 && m < 27.5) || (m > 29.5 && m < 32.5)) {
        if (m < 19.5) vis = 1.0;
        else if (m < 20.5) vis = step(0.5, fShell) * (fShell > 4.5 && aBone > 0.5 ? 0.0 : 1.0);
        else if (m < 21.5) vis = (fShell > 0.5 && fShell < 2.5) || (fShell > 3.5 && fShell < 4.5) ? 1.0 : 0.0;
        else if (m < 22.5) vis = fShell > 1.5 && fShell < 2.5 ? 1.0 : 0.0;
        else if (m < 23.5) vis = (frontPick(iSeed, 6.0, vec4(0.3, 0.08, 0.12, 0.45), 0.3) ? 1.0 : 0.0) * (1.0 - staff);
        else if (m < 24.5) vis = frontPick(iSeed, 3.0, vec4(0.1, 0.16, 0.5, 0.36), 0.16) ? 1.0 : 0.0;
        else if (m < 25.5) vis = hatOn;
        else if (m < 26.5) vis = glowOn * leftFree;
        else if (m < 27.5) vis = fanOn * leftFree;
        else if (m < 30.5) vis = (frontPick(iSeed, 8.0, vec4(0.0, 0.16, 0.0, 0.2), 0.45) ? 1.0 : 0.0) * (fShell > 1.5 && fShell < 2.5 || fShell > 3.5 && fShell < 4.5 ? 0.0 : 1.0);
        else if (m < 31.5) vis = (frontPick(iSeed, 4.0, vec4(0.0, 0.0, 0.0, 0.04), 0.55) ? 1.0 : 0.0) * (1.0 - hatOn) * (1.0 - capOn);
        else vis = (frontPick(iSeed, 7.0, vec4(0.04, 0.35, 0.0, 0.0), 0.06) ? 1.0 : 0.0) * (1.0 - staff);
      }
      // the quiff, curls and a bun make way for a hat
      else if ((m > 16.5 && m < 17.5) || (m > 27.5 && m < 29.5)) vis *= 1.0 - hatOn;
      // a shout on the drop, singing along when the room's going, otherwise closed
      poseMouth = clamp(wCheer * step(0.3, fract(iSeed.y * 13.7)) + max(0.0, vnoise(uTime * 1.7 + iSeed.x * 40.0) - 0.55) * 2.2 * smoothstep(0.55, 0.9, uHype) * step(0.4, fract(iSeed.z * 3.9)) + 0.6 * wCheer * pump, 0.0, 1.0);
      poseFilm = max(wFilm, wLight);
    }
`;

/** the front row's colours: after the crowd's own (col, glow, crowdRough, skin, hair, top, p, aa, m are in scope) */
export function frontFrag(): string {
  const f = facePoints();
  const e = (n: number) => n.toFixed(5);
  return /* glsl */ `
  {
    // the picks come from the vertex shader: a hash of an interpolated seed would flicker from pixel to pixel
    float fShell = floor(vPick.x + 0.5);
    bool swim = vPick.y > 0.5;
    float look = uOutfit;
    float fh1 = vPick2.x;
    float fh2 = vPick2.y;
    // fine detail (fur pile, stubble, sweat beads) fades out before it can shimmer
    float fine = 1.0 - smoothstep(0.0016, 0.004, aa);
    // the outer layer's colour
    vec3 shellCol = vec3(0.04);
    float shellRough = 0.8;
    if (fShell < 1.5) {
      // jacket: leather at Berghain, a rain jacket or bomber at a festival, suede on the playa, denim/olive/black in a club
      if (look > 0.5 && look < 1.5) { shellCol = vec3(0.018); shellRough = 0.32; }
      else if (look > 2.5 && look < 3.5) { shellCol = fh1 < 0.25 ? vec3(0.85, 0.62, 0.04) : fh1 < 0.45 ? vec3(0.9, 0.3, 0.06) : fh1 < 0.65 ? vec3(0.05, 0.42, 0.42) : vec3(0.1, 0.12, 0.08); shellRough = fh1 < 0.65 ? 0.45 : 0.7; }
      else if (look > 3.5) { shellCol = vec3(0.36, 0.22, 0.12); shellRough = 0.9; }
      else shellCol = fh1 < 0.3 ? vec3(0.02) : fh1 < 0.55 ? vec3(0.14, 0.16, 0.09) : fh1 < 0.8 ? vec3(0.1, 0.16, 0.28) : top * 0.45 + vec3(0.02);
    } else if (fShell < 2.5) {
      // hoodie: grey marl, black, or the top's colour turned down
      shellCol = fh1 < 0.35 ? vec3(0.32, 0.32, 0.33) : fh1 < 0.65 ? vec3(0.025) : mix(top, vec3(0.5), 0.35);
      shellRough = 0.95;
    } else if (fShell < 3.5) {
      // a short-sleeved shirt: a big floral print on a pale or bright ground
      vec3 ground = fh1 < 0.25 ? vec3(0.85, 0.84, 0.8) : fh1 < 0.45 ? vec3(0.05, 0.38, 0.45) : fh1 < 0.6 ? vec3(0.85, 0.45, 0.35) : fh1 < 0.75 ? vec3(0.05, 0.07, 0.2) : top;
      vec3 ink = fh2 < 0.35 ? vec3(0.95, 0.85, 0.3) : fh2 < 0.7 ? vec3(0.95, 0.35, 0.5) : vec3(0.95, 0.95, 0.92);
      // hibiscus flowers and leaves, one to a cell, turned and nudged about
      vec2 fuv = vec2(p.x + p.z * 0.8, p.y) * 13.0 + vSeed.xy * 7.0;
      vec2 cell = floor(fuv);
      float ch = crowdHash(cell);
      vec2 fq = fract(fuv) - 0.5 + (vec2(crowdHash(cell + 7.1), crowdHash(cell + 3.3)) - 0.5) * 0.25;
      float fr = length(fq);
      float fa = atan(fq.y, fq.x) + ch * 6.283;
      float petals = 1.0 - smoothstep(0.0, 0.03, fr - 0.3 * (0.62 + 0.38 * cos(5.0 * fa)));
      vec2 lq = mat2(cos(fa), sin(fa), -sin(fa), cos(fa)) * fq;
      float leaf = 1.0 - smoothstep(0.0, 0.03, length(lq / vec2(0.42, 0.16)) - 1.0);
      shellCol = ground;
      if (ch < 0.55) {
        shellCol = mix(shellCol, ink, petals);
        shellCol = mix(shellCol, vec3(0.6, 0.1, 0.12), 1.0 - smoothstep(0.05, 0.08, fr));
      } else shellCol = mix(shellCol, vec3(0.08, 0.32, 0.14), leaf * 0.85);
      shellRough = 0.85;
    } else if (fShell < 4.5) {
      // a fur coat: white, pink, purple, turquoise or leopard
      shellCol = fh1 < 0.25 ? vec3(0.88, 0.86, 0.82) : fh1 < 0.45 ? vec3(0.95, 0.4, 0.62) : fh1 < 0.6 ? vec3(0.45, 0.22, 0.68) : fh1 < 0.75 ? vec3(0.15, 0.7, 0.75) : vec3(0.66, 0.46, 0.22);
      if (fh1 >= 0.75) {
        vec3 q3 = p * 55.0;
        float spot = sin(q3.x) * sin(q3.y * 1.2 + q3.z) * sin(q3.z * 0.8);
        shellCol = mix(shellCol, vec3(0.08, 0.05, 0.03), smoothstep(0.32, 0.4, spot));
      }
      shellRough = 1.0;
    } else {
      // a gilet: a quilted puffer, or leather on the playa
      shellCol = look > 3.5 ? vec3(0.3, 0.17, 0.08) : fh1 < 0.4 || (look > 0.5 && look < 1.5) ? vec3(0.02) : fh1 < 0.7 ? top * 0.6 : vec3(0.75, 0.35, 0.1);
      shellRough = look > 3.5 ? 0.85 : 0.45;
    }
    if (m > 17.5) {
      if (m < 18.5) {
        // the eye (painted by the crowd's shader): a blink now and then, the lid down over it
        if (step(0.965, fract(uTime * 0.23 + vSeed.x * 7.0)) > 0.5) { col = skin * 0.9; crowdRough = 0.55; }
      }
      else if (m < 19.5) {
        // the brows, as hair over the brow ridge: thicker and straighter on men, arched and finer on women
        float bx = (abs(p.x) - ${e(LANDMARKS.eye[0] + 0.002)}) / 0.025;
        float by = ${e(LANDMARKS.eye[1] + 0.02)} + mix(0.003, 0.006, woman) * (1.0 - bx * bx) - 0.002 * bx;
        float bth = mix(0.0032, 0.0022, woman) * (1.0 - 0.55 * smoothstep(-0.2, 1.0, bx));
        if (abs(bx) > 0.95 || abs(p.y - by) > bth) discard;
        col = mix(skin, hair * 0.7 + vec3(0.004), 0.7 - 0.25 * smoothstep(0.0, 1.0, bx));
        col *= 1.0 - 0.25 * crowdHash(floor(vec2(p.x * 2500.0, p.y * 700.0))) * fine;
        crowdRough = 0.7;
      }
      else if (m < 22.5) {
        if (m < 21.5 && p.y < (m < 20.5 ? ${e(SHELL_HEM)} : ${e(SHELL_CUFF)})) discard;
        col = shellCol;
        crowdRough = shellRough;
        // open down the front (jackets, shirts, coats, gilets): the top shows between the fronts, a darker edge
        if (vBone < 0.5 && fShell != 2.0 && p.z > 0.0 && m < 20.5) {
          float open = 0.028 + 0.05 * smoothstep(1.2, 1.46, p.y);
          if (abs(p.x) < open && p.y < ${e(JOINTS.neck[1] - 0.06)}) discard;
          col *= 1.0 - 0.35 * (1.0 - smoothstep(open, open + 0.012, abs(p.x)));
        }
        // a hoodie: the kangaroo pocket, the drawstrings, ribbed cuffs and hem
        if (fShell > 1.5 && fShell < 2.5) {
          if (vBone < 0.5 && p.z > 0.06 && p.y > 0.99 && p.y < 1.13 && abs(p.x) < 0.11) col *= 0.85;
          if (vBone < 0.5 && p.z > 0.07 && abs(abs(p.x) - 0.03) < 0.0028 && p.y > 1.3 && p.y < 1.44) col = vec3(0.85);
        }
        // a gilet: quilted bands
        if (fShell > 4.5 && look < 3.5) col *= 0.82 + 0.18 * smoothstep(0.0, 0.25, abs(fract(p.y * 14.0) - 0.5));
        // cuffs and the hem
        if (p.y < ${e(JOINTS.hip[1] - 0.035)} || (m > 20.5 && p.y < ${e(JOINTS.wrist[1] + 0.05)} && vBone > 4.5)) col *= 0.8;
        // fur: a deep pile
        if (fShell > 3.5 && fShell < 4.5) {
          float pile = crowdHash(floor(p.xy * 260.0) + floor(p.z * 260.0));
          col *= 1.0 + (0.4 * pile - 0.2) * fine;
        }
      }
      else if (m < 23.5) {
        // the bag: black, the top's colour or a bright one, a zip along the top
        col = fh2 < 0.5 ? vec3(0.02) : fh2 < 0.75 ? top * 0.7 : vec3(0.85, 0.3, 0.08);
        if (p.y > 1.04 && p.y < 1.048) col = vec3(0.4);
        crowdRough = 0.6;
      }
      else if (m < 24.5) {
        // sunglasses: dark lenses that catch the show (mirrored on some), black, white or tortoiseshell frames
        bool lens = p.z > ${e(f.eye.z + f.eyeR * 0.75 + 0.008)} && abs(p.y - ${e(f.eye.y)}) < 0.016;
        col = lens ? vec3(0.015) : fh2 < 0.5 ? vec3(0.015) : fh2 < 0.75 ? vec3(0.85) : vec3(0.25, 0.12, 0.04);
        crowdRough = lens ? 0.18 : 0.4;
        if (lens) glow += uRim * (fh2 < 0.4 ? 0.3 : 0.1) * (0.4 + 0.6 * smoothstep(-0.01, 0.015, p.y - ${e(f.eye.y)}));
      }
      else if (m < 25.5) {
        // a bucket hat: khaki, black, a check, or the top's colour
        col = fh1 < 0.3 ? vec3(0.42, 0.38, 0.26) : fh1 < 0.55 ? vec3(0.025) : fh1 < 0.8 ? top : vec3(0.7, 0.68, 0.62);
        if (fh1 >= 0.8) col *= 0.75 + 0.35 * step(0.5, fract(p.x * 40.0)) * step(0.5, fract(p.y * 40.0 + p.z * 40.0));
        crowdRough = 0.9;
      }
      else if (m < 26.5) {
        // a glowstick
        vec3 gc = fh2 < 0.25 ? vec3(0.2, 1.0, 0.25) : fh2 < 0.45 ? vec3(1.0, 0.15, 0.6) : fh2 < 0.65 ? vec3(0.2, 0.55, 1.0) : fh2 < 0.85 ? vec3(1.0, 0.85, 0.1) : vec3(1.0, 0.4, 0.05);
        col = gc * 0.3;
        glow = gc * 4.0;
        crowdRough = 0.3;
      }
      else if (m < 27.5) {
        // a folding fan: pleats from the pivot in the hand, a print
        vec2 fp = vec2(p.z - 0.03, p.y - 0.8);
        float ang = atan(fp.y, fp.x);
        float pleat = fract(ang * 9.0);
        vec3 fc = fh2 < 0.35 ? vec3(0.02) : fh2 < 0.6 ? vec3(0.75, 0.05, 0.08) : fh2 < 0.8 ? vec3(0.85, 0.7, 0.3) : 0.5 + 0.5 * cos(6.283 * (ang * 0.4 + vec3(0.0, 0.33, 0.67)));
        col = fc * (0.8 + 0.25 * smoothstep(0.2, 0.5, pleat) - 0.2 * smoothstep(0.5, 0.9, pleat));
        if (length(fp) > 0.16) col = fc * 0.5;
        crowdRough = 0.7;
      }
      else if (m < 29.5) { col = hair; crowdRough = 0.55; }
      else if (m < 30.5) {
        // fur collar on the playa, a bandana at a festival, a choker and chain elsewhere
        if (look > 3.5) { col = fh2 < 0.5 ? vec3(0.9, 0.88, 0.84) : vec3(0.92, 0.45, 0.7); crowdRough = 1.0; col *= 1.0 + (0.4 * crowdHash(floor(p.xz * 260.0) + floor(p.y * 260.0)) - 0.2) * fine; }
        else if (look > 2.5) { col = fh2 < 0.5 ? vec3(0.6, 0.05, 0.05) : vec3(0.05, 0.1, 0.35); col = mix(col, vec3(0.9), step(0.7, fract(atan(p.x, p.z) * 4.0 + p.y * 60.0)) * 0.6); crowdRough = 0.9; }
        else { col = vec3(0.02); crowdRough = 0.35; }
      }
      else if (m < 31.5) {
        // goggles: a leather band, brass rims, amber or mirrored lenses that catch the show
        col = vec3(0.12, 0.07, 0.04);
        crowdRough = 0.7;
        if (p.z > ${e(LANDMARKS.headFront - 0.05)}) {
          vec2 gq = vec2(abs(p.x) - 0.034, p.y - ${e(LANDMARKS.eye[1] + 0.062)});
          float gr = length(gq);
          if (gr < 0.019) { col = fh2 < 0.5 ? vec3(0.35, 0.18, 0.02) : vec3(0.05); crowdRough = 0.05; glow += uRim * 0.5; }
          else if (gr < 0.028) { col = vec3(0.5, 0.38, 0.15); crowdRough = 0.35; }
        }
      }
      else {
        // the harness's steel ring
        col = vec3(0.6);
        crowdRough = 0.2;
      }
    }
    // swimwear and bare tops: skin, a bikini top for some at the beach, board shorts
    if (swim) {
      if (m < 0.5) {
        col = skin;
        crowdRough = mix(0.55, 0.25, uSweat);
        // a little definition: the chest and the line down the middle
        col *= 1.0 - 0.06 * smoothstep(0.012, 0.0, abs(p.x)) * step(1.05, p.y) * step(p.y, 1.36) * step(0.0, p.z);
        if (look > 1.5 && look < 3.5 && fh2 < 0.5) {
          vec2 cup = vec2(abs(p.x) - 0.08, p.y - 1.28);
          float tri = step(0.0, p.z) * step(cup.y, 0.035 - abs(cup.x) * 1.2) * step(-0.03, cup.y);
          float band = step(abs(p.y - 1.25), 0.008);
          float strap = step(abs(abs(p.x) - 0.075 + (p.y - 1.32) * 0.3), 0.005) * step(1.3, p.y);
          vec3 bik = fh1 < 0.3 ? vec3(0.9, 0.1, 0.3) : fh1 < 0.6 ? vec3(0.05, 0.5, 0.7) : fh1 < 0.8 ? vec3(0.95, 0.8, 0.1) : vec3(0.02);
          if (max(tri, max(band, strap)) > 0.5) { col = bik; crowdRough = 0.7; }
        }
      }
      if (m > 4.5 && m < 6.5) { col = skin; crowdRough = mix(0.55, 0.25, uSweat); }
    }
    // painted on the torso (the top, or bare skin) and over a jacket: a crossbody bag's strap, a harness
    if (vBone < 0.5 && (m < 0.5 || (m > 19.5 && m < 20.5))) {
      if (vPick.z > 0.5) {
        // the strap over the right shoulder and down to the left hip, front and back
        float d = dot(p - vec3(0.1, 1.475, 0.0), vec3(0.858, -0.513, 0.0));
        float w = 1.0 - smoothstep(0.011, 0.011 + aa, abs(d));
        col = mix(col, vec3(0.025), w);
        crowdRough = mix(crowdRough, 0.6, w);
        col *= 1.0 - 0.35 * (1.0 - smoothstep(0.011, 0.02, abs(d))) * (1.0 - w);
      }
      if (m < 0.5 && vPick.w > 0.5) {
        // the chest band; straps from the ring up over the shoulders, and down the back to the band
        vec2 q = vec2(abs(p.x), p.y);
        vec2 a = p.z > 0.0 ? vec2(0.0, 1.33) : vec2(0.025, 1.25);
        vec2 b = vec2(0.105, 1.47);
        vec2 ab = b - a;
        float sd = length(q - a - ab * clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0));
        float hz = min(abs(p.y - 1.25) - 0.009, sd - 0.008);
        float w = 1.0 - smoothstep(0.0, aa, hz);
        col = mix(col, vec3(0.012), w);
        crowdRough = mix(crowdRough, 0.28, w);
      }
    }
    if (m > 1.5 && m < 2.5) {
      crowdRough = mix(0.55, 0.2, uSweat);
      // sweat: beads that catch the light, more as the night goes on (the face, the chest, the arms)
      vec3 sc = floor(p * 170.0);
      float bead = step(1.0 - 0.07 * uSweat, crowdHash(sc.xy + sc.z * 3.7)) * fine;
      bead *= 1.0 - smoothstep(0.22, 0.34, length(fract(p * 170.0) - 0.5));
      crowdRough = mix(crowdRough, 0.05, bead);
      if (vBone > 8.5 && p.z > 0.04 && p.y > ${e(LANDMARKS.chin[1] - 0.02)}) {
        // open (a cheer, a sung line): the lips part, teeth along the top, dark below
        float mx = p.x / 0.021;
        float lw = max(0.0, 1.0 - mx * mx);
        float my = p.y - ${e(LANDMARKS.mouth[1])};
        float open = vMouth;
        float inMouth = step(0.05, open) * step(${e(LANDMARKS.mouth[2] - 0.025)}, p.z) * (1.0 - smoothstep(-aa, aa, my - 0.0015 * sqrt(lw))) * smoothstep(-aa, aa, my + (0.002 + 0.016 * open) * sqrt(lw));
        vec3 inside = my > -0.0035 ? vec3(0.7, 0.67, 0.62) : mix(vec3(0.07, 0.015, 0.015), vec3(0.3, 0.08, 0.08), step(0.4, open) * smoothstep(-0.012, -0.004, my));
        col = mix(col, inside, inMouth);
        // glitter on the cheekbones at a festival or on the playa
        vec2 gq = vec2(abs(p.x) - 0.05, p.y - ${e(LANDMARKS.eye[1] - 0.035)});
        if (look > 2.5 && fh1 > 0.6) glow += vec3(1.2, 0.9, 1.4) * step(0.985, crowdHash(floor(p.xy * 700.0) + floor(uTime * 3.0))) * exp(-dot(gq, gq) / 0.0003);
        // a phone's light on the face when they're filming
        glow += vec3(0.4, 0.5, 0.8) * 0.06 * vFilm * smoothstep(0.06, 0.12, p.z);
      }
    }
    // the hair goes darker and clumps with sweat
    if ((m > 2.5 && m < 3.5) || (m > 13.5 && m < 14.5) || (m > 16.5 && m < 17.5) || (m > 27.5 && m < 29.5)) {
      col *= 1.0 - 0.25 * uSweat;
      crowdRough = mix(crowdRough, 0.3, uSweat);
      if (m > 27.5 && m < 28.5) col *= 1.0 + (0.3 * crowdHash(floor(p.xz * 300.0) + floor(p.y * 300.0)) - 0.15) * fine;
    }
    // sweat through the top: down the chest and the back
    if (m < 0.5 && !swim) {
      float wetPatch = smoothstep(0.08, 0.0, abs(p.x)) * smoothstep(1.02, 1.2, p.y) * smoothstep(1.42, 1.3, p.y);
      col *= 1.0 - 0.3 * uSweat * wetPatch;
    }
    // the phone: the camera app (the show in the viewfinder, the red record dot)
    if (m > 8.5 && m < 9.5) {
      vec2 su = vUv2;
      vec3 view = mix(uRim * 3.0 + vec3(0.05, 0.05, 0.1), vec3(0.6, 0.55, 0.8), smoothstep(0.4, 0.9, su.y) * 0.4);
      float frame = step(0.12, su.y) * step(su.y, 0.88);
      float rec = 1.0 - smoothstep(0.03, 0.04, length((su - vec2(0.5, 0.06)) * vec2(1.0, 2.0)));
      glow = mix(vec3(0.03), view, frame) * 1.4 + vec3(1.6, 0.08, 0.06) * rec;
    }
  }
`;
}

/** the show's light on the front row: the rig's colours on the faces turned to it */
export const FRONT_LIGHT = /* glsl */ `
  {
    vec3 toRig = normalize((viewMatrix * vec4(uRimFrom, 1.0)).xyz + vViewPosition);
    float facing = clamp(dot(normal, toRig), 0.0, 1.0);
    totalEmissiveRadiance += uRim * diffuseColor.rgb * facing * 0.55;
  }
`;
