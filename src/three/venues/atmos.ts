/*
 * The room's haze as a function of position and time, shared by every shader
 * that needs to agree on it: laser beams and sheets, moving-head beams and the
 * haze layers. Beams only show where there's haze, so they brighten in the
 * clumps and fade in clear pockets as the clouds drift through (see
 * docs/venue-research.md, "Lasers and effects").
 *
 * GLSL: float hazeAt(vec3 p, float t, vec2 band, float smoke)
 *   band   floor-to-ceiling range the haze fills (it thins above and below)
 *   smoke  the show's haze level, 0..1
 */
export const HAZE_GLSL = /* glsl */ `
  float hzH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float hzN(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hzH(i), hzH(i + vec3(1, 0, 0)), f.x), mix(hzH(i + vec3(0, 1, 0)), hzH(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hzH(i + vec3(0, 0, 1)), hzH(i + vec3(1, 0, 1)), f.x), mix(hzH(i + vec3(0, 1, 1)), hzH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float hazeAt(vec3 p, float t, vec2 band, float smoke) {
    // slow drift, a little rise; big soft clouds with smaller wisps inside
    vec3 q = p * vec3(0.09, 0.16, 0.09) + vec3(t * 0.045, -t * 0.012, -t * 0.03);
    float n = hzN(q) * 0.68 + hzN(q * 2.7 + 7.1) * 0.32;
    float clump = smoothstep(0.28, 0.78, n);
    float h = smoothstep(band.x - 1.0, band.x + 1.5, p.y) * (1.0 - smoothstep(band.y - 4.0, band.y + 3.0, p.y));
    return h * (0.3 + 0.7 * clump) * (0.3 + smoke * 0.9);
  }
`;
