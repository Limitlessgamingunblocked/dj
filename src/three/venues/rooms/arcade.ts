/*
 * The Arcade Room: inside an 80s game. The walls are pixel art (a scrolling
 * city under a starry sky, a grid floor running to the horizon), the crowd
 * are 8-bit sprites bouncing on the beat, and a giant score counter over the
 * booth pops on every transition, drop and comeback (a miss flashes MISS).
 *
 *   modes    neon 80s, green screen, handheld (four greens), synthwave
 *   pads     insert coin, invaders (march across the ceiling), glitch, bonus (hold: rainbow)
 *   moments  high score (big), level up (big), game over (deep: CONTINUE? 9… 8…)
 *   stems    the sprites bounce with the drums, the city scrolls with the melody, the stars with the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import type { ShowState } from '../show';
import { CrazyRoom, roomShow, V, type RoomAction, type RoomMoment } from './kit';

const W = 9;
const H = 7;
const D = 15;
const SPRITES = 190;

const WALL_FRAG = /* glsl */ `
  uniform float uMode, uTime, uScroll, uStars, uInvaders, uGlitch, uBonus, uPx;
  uniform vec3 uC0, uC1, uC2;
  varying vec3 vP;
  varying vec3 vN;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 palette(vec3 c) {
    if (uMode > 0.5 && uMode < 1.5) { float l = dot(c, vec3(0.3, 0.6, 0.1)); return vec3(0.1, 1.0, 0.3) * floor(l * 4.0 + 0.5) / 4.0; }
    if (uMode > 1.5 && uMode < 2.5) { float l = dot(c, vec3(0.3, 0.6, 0.1)); float q = floor(l * 3.99); return mix(vec3(0.06, 0.22, 0.06), vec3(0.6, 0.74, 0.06), q / 3.0); }
    return c;
  }
  // a space invader, 11x8 pixels, two frames
  float invader(vec2 c, float frame) {
    if (c.x < 0.0 || c.x > 10.0 || c.y < 0.0 || c.y > 7.0) return 0.0;
    float x = abs(c.x - 5.0);
    float y = c.y;
    float body = step(y, 5.0) * step(1.0, y) * step(x, 4.0 - step(4.0, y) * 1.0);
    float eyes = step(3.0, y) * step(y, 3.0) * step(1.5, x) * step(x, 2.5);
    float horns = step(6.0, y) * step(x, 3.5) * step(2.5, x);
    float legs = step(y, 0.5) * mix(step(2.5, x) * step(x, 3.5), step(3.5, x) * step(x, 4.5), frame);
    return clamp(body - eyes + horns + legs, 0.0, 1.0);
  }
  void main() {
    // pixel coordinates on the wall: a fat pixel every uPx metres
    vec2 uv = abs(vN.x) > 0.5 ? vec2(vP.z, vP.y) : abs(vN.z) > 0.5 ? vec2(vP.x, vP.y) : vec2(vP.x, vP.z);
    vec2 px = floor(uv / uPx);
    // a screen tear on glitch
    px.x += floor(uGlitch * 12.0 * step(0.7, h21(vec2(floor(px.y / 6.0), floor(uTime * 12.0)))));
    vec3 col;
    if (abs(vN.y) > 0.5 && vP.y > 1.0) {
      // the ceiling: stars, and invaders marching
      col = vec3(0.01, 0.0, 0.04);
      col += vec3(1.0) * step(0.985, h21(px)) * (0.4 + 0.6 * uStars) * step(0.5, fract(uTime * 0.7 + h21(px * 3.1)));
      vec2 grid = mod(px + vec2(floor(uTime * 2.0) - 40.0, 0.0), vec2(16.0, 12.0));
      float inv = invader(grid - vec2(2.0, 2.0), step(0.5, fract(uTime * 2.0)));
      col = mix(col, uC1 * 1.6, inv * uInvaders);
    } else {
      // the walls: a city skyline under the stars, scrolling past
      float y = px.y;
      float sx = px.x + floor(uScroll);
      float bw = 5.0 + floor(h21(vec2(floor(sx / 7.0), 1.0)) * 4.0);
      float bh = 8.0 + floor(h21(vec2(floor(sx / 7.0), 2.0)) * 26.0);
      vec3 sky = mix(uC2 * 0.25, vec3(0.02, 0.0, 0.08), clamp(y / 60.0, 0.0, 1.0));
      col = sky + vec3(1.0) * step(0.99, h21(px + 7.0)) * uStars;
      float building = step(y, bh) * step(mod(sx, 7.0), bw);
      vec3 bc = vec3(0.05, 0.03, 0.12);
      float win = step(0.6, h21(vec2(floor(sx), floor(y)))) * step(mod(y, 2.0), 0.5) * step(mod(sx, 2.0), 0.5);
      col = mix(col, bc + uC0 * win * 1.4, building);
      // a pixel sun on the synthwave mode
      if (uMode > 2.5) {
        vec2 sc = px - vec2(floor(uScroll * 0.1) + 30.0, 30.0);
        float sun = step(length(sc), 14.0) * step(0.5, fract(sc.y / 3.0) + step(0.0, sc.y));
        col = mix(col, mix(vec3(1.0, 0.85, 0.2), vec3(1.0, 0.2, 0.5), clamp(-sc.y / 14.0 + 0.5, 0.0, 1.0)), sun * (1.0 - building));
      }
      // the floor: a grid running to the horizon
      if (abs(vN.y) > 0.5) {
        vec2 g = fract(vec2(vP.x, vP.z - uTime * 2.0) / 1.5);
        float line = step(g.x, 0.06) + step(g.y, 0.06);
        col = vec3(0.02, 0.0, 0.05) + uC1 * clamp(line, 0.0, 1.0) * 1.2;
      }
    }
    // the bonus: everything rainbow
    if (uBonus > 0.0) {
      vec3 rb = 0.5 + 0.5 * cos(6.2831853 * (px.x * 0.02 + px.y * 0.03 + uTime + vec3(0.0, 0.33, 0.67)));
      col = mix(col, rb * (0.4 + dot(col, vec3(0.6))), uBonus * 0.7);
    }
    gl_FragColor = vec4(palette(col), 1.0);
  }
`;

const SPRITE_VERT = /* glsl */ `
  attribute vec4 iSprite;
  attribute vec3 iShirt;
  uniform float uBeat, uBounce, uTime;
  varying vec2 vUv;
  varying vec3 vShirt;
  varying float vFrame;
  varying float vSkin;
  void main() {
    vec3 base = iSprite.xyz;
    float seed = iSprite.w;
    float ph = fract(uBeat + seed * 0.3);
    float hop = uBounce * max(0.0, sin(ph * 3.14159)) * 0.25;
    // two frames a beat, arms up on the beat when it's going
    float up = step(0.5, fract(uBeat * 0.5 + seed)) * step(0.4, uBounce);
    vFrame = floor(mod(uBeat + seed * 4.0, 2.0)) + up * 2.0;
    vShirt = iShirt;
    vSkin = fract(seed * 7.3);
    vUv = uv;
    // a billboard that turns round the vertical to face the camera
    vec3 center = (modelMatrix * vec4(base + vec3(0.0, hop, 0.0), 1.0)).xyz;
    vec3 toCam = cameraPosition - center;
    vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
    vec3 wp = center + right * position.x + vec3(0.0, position.y, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const SPRITE_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uMode;
  varying vec2 vUv;
  varying vec3 vShirt;
  varying float vFrame;
  varying float vSkin;
  void main() {
    vec4 m = texture2D(uAtlas, vec2((vUv.x + vFrame) / 4.0, vUv.y));
    if (m.a < 0.3) discard;
    // a dark outline round each sprite, so they read as figures
    if (m.a < 0.8) { gl_FragColor = vec4(0.02, 0.0, 0.05, 1.0); return; }
    vec3 skin = mix(vec3(1.0, 0.8, 0.6), vec3(0.45, 0.28, 0.16), vSkin);
    vec3 col = skin * m.r + vShirt * m.g + vec3(0.1, 0.1, 0.25) * m.b;
    if (uMode > 0.5 && uMode < 1.5) col = vec3(0.1, 1.0, 0.3) * floor(dot(col, vec3(0.3, 0.6, 0.1)) * 4.0 + 0.5) / 4.0;
    else if (uMode > 1.5 && uMode < 2.5) col = mix(vec3(0.06, 0.22, 0.06), vec3(0.6, 0.74, 0.06), floor(dot(col, vec3(0.3, 0.6, 0.1)) * 3.99) / 3.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** a 4-frame pixel person atlas: R skin, G shirt, B trousers, A where there's a person */
function spriteAtlas(): THREE.CanvasTexture {
  const fw = 12;
  const fh = 20;
  const c = document.createElement('canvas');
  c.width = fw * 4;
  c.height = fh;
  const g = c.getContext('2d')!;
  const px = (f: number, x: number, y: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(f * fw + x, fh - 1 - y, 1, 1);
  };
  const SK = 'rgb(255,0,0)';
  const SH = 'rgb(0,255,0)';
  const TR = 'rgb(0,0,255)';
  for (let f = 0; f < 4; f++) {
    const bob = f % 2;
    const up = f >= 2;
    // legs
    for (let y = 0; y < 7; y++) {
      px(f, 4 - (bob && y < 2 ? 1 : 0), y, TR);
      px(f, 7 + (bob && y < 2 ? 1 : 0), y, TR);
      if (y > 4) for (let x = 4; x <= 7; x++) px(f, x, y, TR);
    }
    // body
    for (let y = 7; y < 13; y++) for (let x = 3; x <= 8; x++) px(f, x, y + bob * 0, SH);
    // arms: down by the sides, or up in the air
    for (let y = 0; y < 5; y++) {
      if (up) {
        px(f, 2, 12 + y, y > 3 ? SK : SH);
        px(f, 9, 12 + y, y > 3 ? SK : SH);
      } else {
        px(f, 2, 12 - y, y > 3 ? SK : SH);
        px(f, 9, 12 - y, y > 3 ? SK : SH);
      }
    }
    // head
    for (let y = 13; y < 18; y++) for (let x = 4; x <= 7; x++) px(f, x, y, SK);
    for (let x = 4; x <= 7; x++) px(f, x, 18, TR);
  }
  // the outline: every empty pixel next to a filled one, at a lower alpha
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < c.width && y < c.height && d[(y * c.width + x) * 4 + 3] > 200;
  const edge: number[] = [];
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      if (filled(x, y)) continue;
      // don't bleed across frames
      const f0 = Math.floor(x / fw);
      const near = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx, ny]) => Math.floor(nx / fw) === f0 && filled(nx, ny));
      if (near) edge.push((y * c.width + x) * 4);
    }
  for (const i of edge) {
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = 140;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

class Arcade extends CrazyRoom {
  readonly modes = ['Neon 80s', 'Green screen', 'Handheld', 'Synthwave'];
  readonly actions: RoomAction[] = [
    { id: 'coin', label: 'Insert coin', kind: 'hit' },
    { id: 'invaders', label: 'Invaders', kind: 'toggle' },
    { id: 'glitch', label: 'Glitch', kind: 'hit' },
    { id: 'bonus', label: 'Bonus', kind: 'hold' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'highscore', label: 'NEW HIGH SCORE', energy: 'big' },
    { id: 'levelup', label: 'LEVEL UP', energy: 'big' },
    { id: 'gameover', label: 'GAME OVER… CONTINUE?', energy: 'deep' },
  ];
  private wall: THREE.ShaderMaterial;
  private sprites: THREE.ShaderMaterial;
  private board: THREE.Mesh;
  private boardTex: THREE.CanvasTexture;
  private score = 0;
  private shown = '';
  private popT = 99;
  private popLabel = '';
  private popBad = false;
  private coinT = 99;
  private glitchT = 99;
  private scroll = 0;
  private off: () => void;

  constructor() {
    super({ roomId: 'arcade', roomName: 'Arcade Room', w: W, h: H, d: D, back: 3, fog: 0x050010, fogDensity: 0.01, hemi: 0.35, booth: { strip: '#ff2e88' } });
    this.views.wide = { pos: V(-W + 1.2, 2.4, -D + 1.2), target: V(0, 2.8, 0) };
    this.views.wideLabel = 'Player two';
    this.ambient = 0.6;
    this.wall = new THREE.ShaderMaterial({
      uniforms: { uMode: { value: 0 }, uTime: { value: 0 }, uScroll: { value: 0 }, uStars: { value: 0 }, uInvaders: { value: 0 }, uGlitch: { value: 0 }, uBonus: { value: 0 }, uPx: { value: 0.12 }, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() } },
      vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; void main() { vP = (modelMatrix * vec4(position, 1.0)).xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }`,
      fragmentShader: WALL_FRAG,
      side: THREE.BackSide,
    });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, D + 3), this.wall);
    shell.position.set(0, H / 2, (3 - D) / 2);
    this.group.add(shell);
    // the score board over the booth
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    this.boardTex = new THREE.CanvasTexture(c);
    this.boardTex.magFilter = THREE.NearestFilter;
    this.boardTex.minFilter = THREE.NearestFilter;
    this.boardTex.generateMipmaps = false;
    this.board = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: this.boardTex, transparent: true, toneMapped: false }));
    this.board.position.set(0, H - 1.6, 2.9);
    this.board.rotation.y = Math.PI;
    this.group.add(this.board);
    // the 8-bit crowd
    const atlas = spriteAtlas();
    this.sprites = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas }, uBeat: { value: 0 }, uBounce: { value: 0 }, uTime: { value: 0 }, uMode: { value: 0 } },
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
    });
    const quad = new THREE.PlaneGeometry(0.84, 1.4).translate(0, 0.7, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const spr = new Float32Array(SPRITES * 4);
    const shirt = new Float32Array(SPRITES * 3);
    const cc = new THREE.Color();
    for (let i = 0; i < SPRITES; i++) {
      spr.set([(Math.random() - 0.5) * (W * 2 - 3), 0, -1.8 - Math.random() * (D - 3.5), Math.random()], i * 4);
      cc.setHSL(Math.random(), 0.85, 0.55);
      shirt.set([cc.r, cc.g, cc.b], i * 3);
    }
    geo.setAttribute('iSprite', new THREE.InstancedBufferAttribute(spr, 4));
    geo.setAttribute('iShirt', new THREE.InstancedBufferAttribute(shirt, 3));
    geo.instanceCount = SPRITES;
    const crowd = new THREE.Mesh(geo, this.sprites);
    crowd.frustumCulled = false;
    this.group.add(crowd);
    this.wash(V(0, H - 0.5, -5), 0, 1.6, 14);
    this.wash(V(0, H - 0.5, -12), 1, 1.6, 14);
    // every transition, drop and comeback in the mix pops the score
    this.off = roomShow.onPop((label, pts, bad) => {
      this.popT = 0;
      this.popLabel = bad ? 'MISS' : label.toUpperCase();
      this.popBad = bad;
      this.score += pts * 10;
    });
  }

  private drawBoard(): void {
    const pop = this.popT < 1.6;
    const key = `${this.score}|${pop ? this.popLabel : ''}|${this.look.mode}|${this.moment?.id ?? ''}|${Math.floor(this.time * 2) % 2}`;
    if (key === this.shown) return;
    this.shown = key;
    const g = (this.boardTex.image as HTMLCanvasElement).getContext('2d')!;
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(0, 0, 512, 128);
    const green = this.look.mode === 1 || this.look.mode === 2;
    const ink = green ? '#7dff6a' : '#ffffff';
    g.textBaseline = 'middle';
    g.font = '700 22px monospace';
    g.fillStyle = green ? '#7dff6a' : '#ff2e88';
    g.textAlign = 'left';
    g.fillText('1UP', 16, 22);
    g.textAlign = 'right';
    g.fillText('HI 999990', 496, 22);
    g.textAlign = 'center';
    g.font = '700 54px monospace';
    g.fillStyle = ink;
    const m = this.moment?.id;
    if (m === 'gameover') {
      const left = Math.max(0, 9 - Math.floor(this.moment!.t));
      g.fillText(Math.floor(this.time * 2) % 2 ? `CONTINUE? ${left}` : 'GAME OVER', 256, 76);
    } else if (m === 'highscore' || m === 'levelup') {
      g.fillStyle = Math.floor(this.time * 4) % 2 ? '#ffd23f' : ink;
      g.fillText(m === 'highscore' ? 'NEW HIGH SCORE!' : 'LEVEL UP!', 256, 76);
    } else if (pop) {
      g.fillStyle = this.popBad ? '#ff3b5c' : '#ffd23f';
      g.fillText(this.popLabel.slice(0, 16), 256, 76);
    } else if (this.coinT < 2) {
      g.fillText(Math.floor(this.time * 4) % 2 ? 'CREDIT 01' : 'INSERT COIN', 256, 76);
    } else {
      g.fillText(String(this.score).padStart(7, '0'), 256, 76);
    }
    this.boardTex.needsUpdate = true;
  }

  protected onAction(id: string): void {
    if (id === 'coin') this.coinT = 0;
    if (id === 'glitch') this.glitchT = 0;
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const u = this.wall.uniforms;
    this.popT += dt;
    this.coinT += dt;
    this.glitchT += dt;
    const melody = this.parts?.melody ?? s.high;
    this.scroll += dt * (4 + melody * 14) * (s.playing ? 1 : 0.2);
    u.uScroll.value = this.scroll;
    u.uTime.value = this.time;
    u.uMode.value = this.look.mode;
    u.uStars.value = 0.3 + this.drive.ceil;
    u.uInvaders.value = this.on('invaders') || this.momentK('levelup') > 0 ? 1 : 0;
    u.uGlitch.value = Math.max(0, 1 - this.glitchT * 3) + roomShow.glitch * 0.8 + (this.popBad && this.popT < 0.4 ? 0.6 : 0);
    u.uBonus.value = Math.max(this.on('bonus') ? 1 : 0, this.momentK('highscore'));
    (u.uC0.value as THREE.Color).copy(this.cols[0]);
    (u.uC1.value as THREE.Color).copy(this.cols[1]);
    (u.uC2.value as THREE.Color).copy(this.cols[2]);
    const su = this.sprites.uniforms;
    su.uBeat.value = s.beat;
    su.uBounce.value = s.playing ? Math.min(1, 0.25 + this.drive.floor * 0.9 + this.momentK() * 0.5) : 0.05;
    su.uTime.value = this.time;
    su.uMode.value = this.look.mode;
    // the board bounces when it pops
    this.board.scale.setScalar(1 + Math.max(0, 0.25 - this.popT) * 0.8);
    this.drawBoard();
    this.lookUp = Math.min(1, this.momentK() * 0.8 + (this.on('invaders') ? 0.4 : 0));
  }

  dispose(): void {
    this.off();
    super.dispose();
  }
}

export const arcadeRoom: VenueDef = {
  id: 'arcade',
  name: 'Arcade Room',
  short: 'Arcade',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'Inside an 80s game: pixel-art walls, a crowd of 8-bit sprites, and a score that pops on every transition.',
  palette: ['#ff2e88', '#3dd6ff', '#ffd23f'],
  ui: '#ff2e88',
  capacity: '260',
  build: () => new Arcade(),
  thumb(g, w, h) {
    g.fillStyle = '#05000f';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff2e88';
    for (let i = 0; i < 12; i++) g.fillRect(i * (w / 12), h * 0.55 - (i % 4) * 8, w / 14, h * 0.45);
    g.fillStyle = '#3dd6ff';
    for (let i = 0; i < 16; i++) g.fillRect(Math.random() * w, Math.random() * h * 0.4, 3, 3);
    g.fillStyle = '#ffd23f';
    g.font = '700 16px monospace';
    g.fillText('0012500', w * 0.3, h * 0.2);
  },
};
