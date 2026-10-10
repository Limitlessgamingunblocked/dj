/*
 * New full-screen shader modes, each locked to the beat grid:
 *   plasma   – acid plasma: the palette steps a notch on every beat
 *   cells    – Voronoi cells, each lighting on its own beat of the bar
 *   sonar    – a ring leaves the centre on every beat, radial spectrum, radar sweep
 *   hyper    – hyperspace starfield that jumps to light speed on the drop
 *   aurora   – northern lights over mountains, swaying with the vocal
 *   circuit  – circuit traces with signals running along them on the beat
 *   hexfloor – a hex-tile floor racing to the horizon, lit by the spectrum
 *   mandel   – a raymarched Mandelbulb breathing with the bass
 *   caustics – deep water: caustic light, ripples on the kicks
 *   rain     – digital code rain, each column an equaliser band
 *   moire    – black-and-white op-art interference
 */
import type { VisMode } from './modes';
import { shaderMode, type ModeInfo } from './kit';

export function plasmaMode(): VisMode {
  return shaderMode(
    'plasma',
    'Acid Plasma',
    'Old-school plasma; the colours step a notch on every beat',
    /* glsl */ `
    void main() {
      vec2 p = screen() * (2.2 - uSub * 0.4);
      float t = uTime * 0.35 + uTravel * 0.05;
      float v = sin(p.x * 3.0 + t) + sin(p.y * 2.7 - t * 1.3) + sin((p.x + p.y) * 2.1 + t * 0.7)
              + sin(length(p * 1.7 + vec2(sin(t * 0.5), cos(t * 0.4))) * 4.0 - t * 1.6);
      v *= 0.25;
      float notch = floor(uBeat) * 0.07;
      vec3 col = pal(v * 0.5 + notch + 0.1 * uVocal);
      vec3 col2 = pal(v * 0.5 + notch + 0.5);
      col = mix(col * col, col2 * col2, smoothstep(0.3, 0.9, sin(v * 12.0 + uTravel) * 0.5 + 0.5) * 0.35);
      float lines = smoothstep(0.08, 0.0, abs(fract(v * 6.0 + uTravel * 0.25) - 0.5) - 0.42);
      col += neon(v + 0.3) * lines * (0.15 + uHigh * 0.6);
      col *= 0.3 + 0.25 * uPulse + 0.15 * uLevel;
      gl_FragColor = vec4(col * (0.7 + 0.3 * uI), 1.0);
    }`,
  );
}

export function cellsMode(): VisMode {
  return shaderMode(
    'cells',
    'Cell Pulse',
    'Living cells, each one lighting on its own beat of the bar',
    /* glsl */ `
    void main() {
      vec2 p = screen() * 5.0 + vec2(uTravel * 0.15, sin(uTime * 0.1) * 2.0);
      vec2 ip = floor(p), fp = fract(p);
      float d1 = 8.0, d2 = 8.0;
      vec2 id = vec2(0.0);
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 o = 0.5 + 0.42 * sin(uTime * 0.6 + 6.2831 * hash2(ip + g));
          vec2 r = g + o - fp;
          float d = dot(r, r);
          if (d < d1) { d2 = d1; d1 = d; id = ip + g; }
          else if (d < d2) { d2 = d; }
        }
      }
      float edge = sqrt(d2) - sqrt(d1);
      float h = hash(id);
      float mine = floor(h * 4.0);
      float on = (mod(floor(uBeat), 4.0) == mine ? 1.0 : 0.0) * (1.0 - fract(uBeat)) * (1.0 - fract(uBeat));
      float lvl = spec(h * 0.8 + 0.05);
      vec3 c = neon(h * 0.5 + floor(uBar / 4.0) * 0.11);
      vec3 col = c * (0.05 + lvl * 0.35 + on * 0.85 * (0.5 + uKick)) * smoothstep(0.0, 0.25, edge);
      col += c * smoothstep(0.06, 0.0, edge) * (0.35 + uHigh * 1.2 + uSnare * 0.6);
      col += neon(h + 0.5) * exp(-sqrt(d1) * 6.0) * 0.15 * uPulse;
      gl_FragColor = vec4(col * (0.7 + 0.3 * uI), 1.0);
    }`,
  );
}

export function sonarMode(): VisMode {
  return shaderMode(
    'sonar',
    'Sonar',
    'A ring leaves the centre on every beat, the spectrum round a radar sweep',
    /* glsl */ `
    void main() {
      vec2 p = screen();
      float r = length(p);
      float a = atan(p.y, p.x);
      float ang = a / 6.28318 + 0.5;
      vec3 col = vec3(0.0);
      for (int k = 0; k < 8; k++) {
        float age = fract(uBeat) + float(k);
        float rad = age * 0.22;
        float w = 0.004 + age * 0.003;
        float ring = exp(-abs(r - rad) / w);
        float fade = exp(-age * 0.45);
        float idx = floor(uBeat) - float(k);
        col += neon(idx * 0.09 + 0.1) * ring * fade * (k == 0 ? 1.0 + uKick : 1.0) * 0.6;
      }
      float slice = floor(ang * 96.0);
      float sv = spec(abs(slice / 96.0 * 2.0 - 1.0) * 0.85 + 0.03);
      float len = 0.15 + sv * 0.32 * (0.7 + 0.3 * uI);
      float inside = step(0.13, r) * step(r, len) * step(0.18, fract(ang * 96.0));
      col += neon(slice / 96.0 + uHue) * inside * (0.1 + sv * 0.6);
      col += neon(0.0) * exp(-r * 14.0) * (0.15 + uKick * 0.6);
      col += vec3(0.25, 0.5, 0.4) * smoothstep(0.02, 0.0, abs(fract(r * 8.0) - 0.5) - 0.47) * 0.05;
      float sweep = mod(uBeat / 4.0 * 6.28318 - a, 6.28318);
      col += neon(0.35) * exp(-sweep * 3.0) * 0.18 * smoothstep(0.9, 0.1, r);
      gl_FragColor = vec4(col * (0.75 + 0.3 * uI), 1.0);
    }`,
  );
}

export function hyperMode(): VisMode {
  return shaderMode(
    'hyper',
    'Hyperspace',
    'A starfield that jumps to light speed on the drop',
    /* glsl */ `
    vec3 stars(vec2 p, float speed) {
      vec3 col = vec3(0.0);
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float depth = fract(fi * 0.25 + uTravel * 0.05 * speed);
        float scale = mix(18.0, 0.6, depth);
        float fade = depth * smoothstep(1.0, 0.85, depth);
        vec2 q = p * scale + fi * 7.31;
        vec2 id = floor(q);
        vec2 f = fract(q) - 0.5;
        vec2 o = hash2(id) - 0.5;
        float d = length(f - o * 0.8);
        float s = smoothstep(0.1, 0.0, d) * step(0.45, hash(id + 3.1));
        col += neon(hash(id) * 0.4 + 0.5) * s * fade;
      }
      return col;
    }
    void main() {
      vec2 p = screen();
      float speed = 0.5 + uDrop * 3.0 + uBuild * 1.5 + uKick * 0.6;
      vec3 col = vec3(0.0);
      // light-speed streaks: the field smeared towards the centre
      for (int k = 0; k < 6; k++) {
        float s = 1.0 - float(k) * 0.025 * speed;
        col += stars(p * s, speed) * (1.0 - float(k) / 6.0);
      }
      col *= 0.6;
      float r = length(p);
      vec3 neb = pal(0.6 + fbm(p * 1.5 + 3.0) * 0.3);
      col += neb * neb * fbm(p * 2.0 / (0.6 + r) + vec2(uTravel * 0.02, 0.0)) * 0.08;
      col += neon(0.6) * exp(-r * 4.0) * (0.06 + uDrop * 0.4 + uBuild * 0.15);
      col += neon(0.1) * smoothstep(0.03, 0.0, abs(r - fract(uBeat) * 1.2)) * uDrop * 0.4;
      gl_FragColor = vec4(col * (0.8 + 0.3 * uI), 1.0);
    }`,
    0.6,
  );
}

export function auroraMode(): VisMode {
  return shaderMode(
    'aurora',
    'Aurora',
    'Northern lights over the mountains, swaying with the vocal',
    /* glsl */ `
    void main() {
      vec2 uv = vUv;
      vec2 p = screen();
      vec3 col = mix(vec3(0.004, 0.008, 0.025), vec3(0.02, 0.035, 0.08), uv.y);
      vec2 sg = floor(vec2(uv.x * uRes.x / uRes.y, uv.y) * 190.0);
      float st = step(0.996, hash(sg)) * (0.55 + 0.45 * sin(uTime * 2.0 + hash(sg + 1.0) * 30.0));
      col += vec3(st) * 0.7 * smoothstep(0.3, 1.0, uv.y);
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float x = p.x * 1.3 + fi * 0.7;
        float yc = 0.55 + 0.11 * sin(x * 1.7 + uTime * 0.15 + fi) + 0.08 * fbm(vec2(x * 2.0, uTime * 0.05 + fi)) + 0.05 * uVocal;
        float d = uv.y - yc;
        float curtain = exp(-max(d, 0.0) * mix(6.0, 2.8, uLevel)) * smoothstep(-0.02, 0.05, d);
        float rays = 0.5 + 0.5 * sin(x * 40.0 + fbm(vec2(x * 6.0, uTime * 0.3)) * 6.0);
        vec3 c = mix(vec3(0.15, 1.0, 0.55), pal(0.6 + fi * 0.08), 0.45);
        col += c * curtain * rays * (0.16 + 0.25 * uVocal + 0.14 * uPulse) * (1.0 - fi * 0.12);
      }
      float m = 0.2 + 0.08 * fbm(vec2(p.x * 1.5, 1.0)) + 0.05 * fbm(vec2(p.x * 5.0, 3.0));
      col = mix(col, vec3(0.004, 0.006, 0.012), smoothstep(m, m - 0.004, uv.y));
      gl_FragColor = vec4(col * (0.85 + 0.3 * uI), 1.0);
    }`,
  );
}

export function circuitMode(): VisMode {
  return shaderMode(
    'circuit',
    'Circuit Board',
    'Circuit traces with signals running along them on the beat',
    /* glsl */ `
    void main() {
      vec2 p = screen() * 8.0 + vec2(uTravel * 0.2, 0.0);
      vec2 id = floor(p);
      vec2 f = fract(p) - 0.5;
      float h = hash(id);
      if (h > 0.5) f.x = -f.x;
      float d1 = abs(length(f - vec2(0.5)) - 0.5);
      float d2 = abs(length(f + vec2(0.5)) - 0.5);
      float d = min(d1, d2);
      float trace = smoothstep(0.07, 0.035, d);
      vec2 q = f - (d1 < d2 ? vec2(0.5) : vec2(-0.5));
      float along = fract(atan(q.y, q.x) / 1.5708 + (id.x + id.y) * 0.25);
      float sig = smoothstep(0.15, 0.0, abs(fract(along - uBeat * 0.5) - 0.5) - 0.35);
      vec3 col = vec3(0.008, 0.025, 0.018) + vec3(0.02, 0.07, 0.045) * trace;
      col += neon(0.33 + h * 0.15) * trace * sig * (0.55 + uKick * 0.8);
      float pad = smoothstep(0.13, 0.1, length(f));
      col += neon(h) * pad * step(0.86, h) * (0.15 + spec(fract(h * 7.0)) * 1.3);
      vec2 g = abs(fract(p) - 0.5);
      col += vec3(0.06, 0.12, 0.09) * smoothstep(0.06, 0.03, length(g - 0.5)) * 0.6;
      gl_FragColor = vec4(col * (0.75 + 0.3 * uI), 1.0);
    }`,
  );
}

export function hexFloorMode(): VisMode {
  return shaderMode(
    'hexfloor',
    'Hex Floor',
    'A floor of hex tiles racing to the horizon, lit by the spectrum',
    /* glsl */ `
    float hexDist(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.866)), p.x); }
    void main() {
      vec2 p = screen();
      float hor = 0.12;
      vec3 col = mix(vec3(0.0), pal(0.7) * 0.12, smoothstep(hor, 0.7, p.y));
      col += neon(0.75) * exp(-abs(p.y - hor) * 40.0) * (0.25 + uPulse * 0.4);
      if (p.y < hor - 0.002) {
        float depth = 0.35 / (hor - p.y);
        vec2 fl = vec2(p.x * depth * 1.6, depth + uTravel * 0.9) * 1.2;
        vec2 rr = vec2(1.0, 1.732);
        vec2 a = mod(fl, rr) - rr * 0.5;
        vec2 b = mod(fl - rr * 0.5, rr) - rr * 0.5;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        vec2 id = fl - gv;
        float edge = 0.5 - hexDist(gv);
        float hh = hash(id);
        float wv = exp(-abs(fract(id.y * 0.05 - uBeat * 0.25) - 0.5) * 12.0);
        float lit = spec(fract(hh * 3.0) * 0.8 + 0.05) * 0.7 + wv * (0.5 + uKick) + step(0.93, hh) * uPulse;
        float fog = exp(-depth * 0.09);
        vec3 c = neon(hh * 0.25 + depth * 0.015);
        col += c * smoothstep(0.0, 0.06, edge) * lit * fog * 0.55;
        col += c * smoothstep(0.045, 0.0, edge) * fog * (0.35 + uHigh * 0.8);
      }
      gl_FragColor = vec4(col * (0.8 + 0.3 * uI), 1.0);
    }`,
  );
}

export function mandelMode(): VisMode {
  return shaderMode(
    'mandel',
    'Mandelbulb',
    'A raymarched 3D fractal that breathes with the bass',
    /* glsl */ `
    float power() { return 7.0 + 1.5 * sin(uTime * 0.1) + uSub * 1.5; }
    float de(vec3 pos, out float trap) {
      vec3 z = pos;
      float dr = 1.0;
      float r = 0.0;
      float pw = power();
      trap = 1e9;
      for (int i = 0; i < 6; i++) {
        r = length(z);
        if (r > 2.0) break;
        float theta = acos(clamp(z.z / max(r, 1e-6), -1.0, 1.0)) * pw;
        float phi = atan(z.y, z.x) * pw;
        dr = pow(r, pw - 1.0) * pw * dr + 1.0;
        z = pow(r, pw) * vec3(sin(theta) * cos(phi), sin(phi) * sin(theta), cos(theta)) + pos;
        trap = min(trap, r);
      }
      return 0.5 * log(max(r, 1e-6)) * r / dr;
    }
    float map(vec3 p) { float t; return de(p, t); }
    void main() {
      vec2 p = screen();
      float yaw = uTime * 0.12 + uTravel * 0.02;
      vec3 ro = vec3(sin(yaw) * 2.6, 0.5 * sin(uTime * 0.07), cos(yaw) * 2.6) * (1.0 - uKick * 0.05);
      vec3 fw = normalize(-ro);
      vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
      vec3 up = cross(fw, rt);
      vec3 rd = normalize(fw * 1.6 + rt * p.x + up * p.y);
      float t = 0.0;
      float trap = 1.0;
      float steps = 0.0;
      bool hit = false;
      for (int i = 0; i < 72; i++) {
        float d = de(ro + rd * t, trap);
        if (d < 0.0015) { hit = true; break; }
        t += d;
        steps += 1.0;
        if (t > 6.0) break;
      }
      vec3 col = vec3(0.0);
      if (hit) {
        vec3 pos = ro + rd * t;
        vec2 e = vec2(0.002, 0.0);
        vec3 n = normalize(vec3(map(pos + e.xyy) - map(pos - e.xyy), map(pos + e.yxy) - map(pos - e.yxy), map(pos + e.yyx) - map(pos - e.yyx)));
        float diff = max(dot(n, normalize(vec3(0.6, 0.8, 0.4))), 0.0);
        float ao = 1.0 - steps / 72.0;
        vec3 base = neon(trap * 0.9 + uTravel * 0.01);
        col = base * (0.15 + diff * 0.8) * ao;
        col += neon(trap + 0.5) * (1.0 - max(dot(-rd, n), 0.0)) * (0.3 + uPulse * 0.6);
      } else {
        col = neon(0.65) * steps / 72.0 * 0.5;
      }
      col *= 0.8 + 0.4 * uLevel;
      gl_FragColor = vec4(col * (0.8 + 0.3 * uI), 1.0);
    }`,
    0.5,
  );
}

export function causticsMode(): VisMode {
  return shaderMode(
    'caustics',
    'Deep Water',
    'Caustic light on the sea floor, a ripple on every kick',
    /* glsl */ `
    float caustic(vec2 p, float t) {
      vec2 i = p;
      float c = 1.0;
      float inten = 0.005;
      for (int n = 0; n < 5; n++) {
        float tt = t * (1.0 - 3.5 / float(n + 1));
        i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
        vec2 q = vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten));
        c += 1.0 / max(length(q), 1e-3);
      }
      c /= 5.0;
      c = 1.17 - pow(max(c, 0.0), 1.4);
      return pow(abs(c), 8.0);
    }
    void main() {
      vec2 p = screen();
      // the ripple from this beat's kick
      vec2 rc = (hash2(vec2(floor(uBeat), 5.0)) - 0.5) * vec2(1.2, 0.7);
      float rd = length(p - rc);
      float age = fract(uBeat);
      p += normalize(p - rc + 1e-4) * sin(rd * 40.0 - age * 18.0) * exp(-abs(rd - age * 0.9) * 8.0) * 0.012 * (0.4 + uKick);
      float c = caustic(p * 4.5 - 250.0, uTime * 0.4 + uTravel * 0.04);
      vec3 deep = mix(vec3(0.0, 0.02, 0.05), mix(vec3(0.0, 0.12, 0.2), pal(0.55) * 0.3, 0.3), vUv.y);
      // only the bright knots of the pattern: the sea floor stays dark between them
      float cc = clamp(c, 0.0, 1.5);
      cc *= cc;
      vec3 col = deep + mix(vec3(0.3, 0.8, 1.0), neon(0.5), 0.3) * cc * (0.22 + uLevel * 0.35 + uPulse * 0.2);
      float shaft = pow(max(sin(p.x * 3.0 + p.y * 1.2 + uTime * 0.2), 0.0), 8.0) * smoothstep(0.0, 1.0, vUv.y);
      col += vec3(0.4, 0.7, 0.9) * shaft * 0.12;
      gl_FragColor = vec4(col * (0.8 + 0.3 * uI), 1.0);
    }`,
  );
}

export function rainMode(): VisMode {
  return shaderMode(
    'rain',
    'Code Rain',
    'Digital rain at the track’s tempo; every column is an equaliser band',
    /* glsl */ `
    void main() {
      vec2 uv = vUv;
      float aspect = uRes.x / uRes.y;
      vec2 grid = vec2(72.0, floor(72.0 / aspect * 1.4));
      vec2 cell = floor(uv * grid);
      vec2 f = fract(uv * grid);
      float ch = hash(vec2(cell.x, 7.0));
      float speed = 0.5 + ch * 0.9;
      float y = 1.0 - (cell.y + 0.5) / grid.y;
      float head = fract(ch * 3.0 + uTravel * 0.07 * speed);
      float d = head - y;
      if (d < 0.0) d += 1.0;
      float len = 0.25 + spec(cell.x / grid.x * 0.9) * 0.6;
      float trail = smoothstep(len, 0.0, d);
      float isHead = smoothstep(1.5 / grid.y, 0.0, d);
      vec2 sub = floor(f * vec2(4.0, 5.0));
      float flick = floor(uTime * (2.0 + ch * 6.0));
      float glyph = step(0.45, hash(cell * 1.31 + sub * 7.7 + flick)) * step(0.12, f.x) * step(f.x, 0.88) * step(0.08, f.y) * step(f.y, 0.92);
      vec3 green = mix(vec3(0.25, 1.0, 0.45), neon(0.33), 0.35);
      vec3 col = green * glyph * trail * (0.35 + uLevel * 0.4);
      col += vec3(0.85, 1.0, 0.9) * glyph * isHead * (0.8 + uKick * 0.6);
      col += green * 0.02 * trail;
      gl_FragColor = vec4(col * (0.8 + 0.3 * uI), 1.0);
    }`,
  );
}

export function moireMode(): VisMode {
  return shaderMode(
    'moire',
    'Op Art',
    'Black-and-white interference patterns that shift with the bass',
    /* glsl */ `
    void main() {
      vec2 p = screen();
      vec2 c1 = vec2(sin(uTime * 0.23), cos(uTime * 0.19)) * 0.25;
      vec2 c2 = -c1 + vec2(0.1 * sin(uBeat * 0.7854), 0.0);
      float fq = 38.0 + 6.0 * uSub;
      float a = sin(length(p - c1) * fq - uTravel * 0.5);
      float b = sin(length(p - c2) * fq + uTravel * 0.5);
      float v = smoothstep(-0.06, 0.06, a * b);
      float l = sin(dot(p, vec2(cos(uBar * 0.4), sin(uBar * 0.4))) * fq * 0.8);
      float lv = smoothstep(-0.06, 0.06, l);
      v = mix(v, v * lv + (1.0 - v) * (1.0 - lv), clamp(uDrop, 0.0, 1.0));
      vec3 tint = mix(vec3(1.0), neon(0.1), 0.2 + 0.25 * uPulse);
      vec3 col = tint * v * (0.5 + 0.25 * uPulse);
      gl_FragColor = vec4(col * (0.75 + 0.3 * uI), 1.0);
    }`,
  );
}

export const MODES3: (() => VisMode)[] = [plasmaMode, cellsMode, sonarMode, hyperMode, auroraMode, circuitMode, hexFloorMode, mandelMode, causticsMode, rainMode, moireMode];
export const INFO3: ModeInfo[] = [
  { id: 'plasma', name: 'Acid Plasma', blurb: 'Old-school plasma; the colours step a notch on every beat', energy: 'calm' },
  { id: 'cells', name: 'Cell Pulse', blurb: 'Living cells, each one lighting on its own beat of the bar', energy: 'mid' },
  { id: 'sonar', name: 'Sonar', blurb: 'A ring leaves the centre on every beat, the spectrum round a radar sweep', energy: 'mid' },
  { id: 'hyper', name: 'Hyperspace', blurb: 'A starfield that jumps to light speed on the drop', energy: 'peak' },
  { id: 'aurora', name: 'Aurora', blurb: 'Northern lights over the mountains, swaying with the vocal', energy: 'calm' },
  { id: 'circuit', name: 'Circuit Board', blurb: 'Circuit traces with signals running along them on the beat', energy: 'mid' },
  { id: 'hexfloor', name: 'Hex Floor', blurb: 'A floor of hex tiles racing to the horizon, lit by the spectrum', energy: 'peak' },
  { id: 'mandel', name: 'Mandelbulb', blurb: 'A raymarched 3D fractal that breathes with the bass', energy: 'mid' },
  { id: 'caustics', name: 'Deep Water', blurb: 'Caustic light on the sea floor, a ripple on every kick', energy: 'calm' },
  { id: 'rain', name: 'Code Rain', blurb: 'Digital rain at the track’s tempo; every column is an equaliser band', energy: 'mid' },
  { id: 'moire', name: 'Op Art', blurb: 'Black-and-white interference patterns that shift with the bass', energy: 'calm' },
];
