/*
 * Deckhouse DSP core
 * ------------------
 * Freestanding C (no libc) compiled to WebAssembly with clang --target=wasm32.
 * Runs inside AudioWorklet processors, off the main thread.
 *
 *   1. WSOLA time-stretcher with independent pitch ratio. Used by the decks for
 *      key lock (tempo change without pitch change) and pitch play / key shift.
 *   2. STFT stem separator. Harmonic/percussive separation (median filtering)
 *      combined with spectral band and stereo-image masks splits a stereo mix
 *      into vocal / drums / bass / melody layers whose gains can be changed in
 *      real time. Masks always sum to one, so unity gains reconstruct the input.
 *   3. Streaming dual-tap pitch shifter used by the Pitch Shift beat FX.
 *
 * Build: node scripts/build-wasm.mjs
 */

typedef unsigned int u32;
typedef int i32;

#define EXPORT __attribute__((visibility("default")))
#define IMPORT(name) __attribute__((import_module("env"), import_name(name)))

IMPORT("sin") double js_sin(double);
IMPORT("cos") double js_cos(double);

#define PI 3.14159265358979323846

/* ------------------------------------------------------------------------ */
/* Bump allocator with a resettable mark (track buffers live above the mark) */
/* ------------------------------------------------------------------------ */

extern unsigned char __heap_base;
static u32 heap_ptr = 0;
static u32 heap_mark = 0;

EXPORT u32 dh_alloc(u32 bytes) {
  if (!heap_ptr) heap_ptr = (u32)&__heap_base;
  u32 p = (heap_ptr + 15u) & ~15u;
  u32 end = p + bytes;
  u32 have = (u32)__builtin_wasm_memory_size(0) * 65536u;
  if (end > have) {
    u32 pages = (end - have + 65535u) / 65536u;
    if (__builtin_wasm_memory_grow(0, pages) == (unsigned long)-1) return 0;
  }
  heap_ptr = end;
  __builtin_memset((void *)p, 0, bytes);
  return p;
}

EXPORT void dh_mark(void) {
  if (!heap_ptr) heap_ptr = (u32)&__heap_base;
  heap_mark = heap_ptr;
}

EXPORT void dh_reset_to_mark(void) {
  if (heap_mark) heap_ptr = heap_mark;
}

static inline float fabs_f(float x) { return __builtin_fabsf(x); }
static inline float sqrt_f(float x) { return __builtin_sqrtf(x); }
static inline double floor_d(double x) { return __builtin_floor(x); }

/* 4-point, 3rd-order Hermite interpolation */
static inline float hermite(float xm1, float x0, float x1, float x2, float t) {
  float c = (x1 - xm1) * 0.5f;
  float v = x0 - x1;
  float w = c + v;
  float a = w + v + (x2 - x0) * 0.5f;
  float b = w + a;
  return (((a * t) - b) * t + c) * t + x0;
}

/* ------------------------------------------------------------------------ */
/* 1. WSOLA time-stretch + pitch                                             */
/* ------------------------------------------------------------------------ */

#define ST_G 2048           /* grain length (samples) */
#define ST_H 1024           /* hop = G/2, Hann windows sum to 1 */
#define ST_SEARCH 480       /* +/- search range for waveform alignment */
#define ST_SEARCH_STEP 2
#define ST_CORR_POINTS 128  /* correlation points (subsampled) */
#define ST_REGION (2 * ST_SEARCH + ST_CORR_POINTS * 16 + 16)

typedef struct {
  const float *L;
  const float *R;
  i32 len;
  i32 loopOn;
  double loopStart;
  double loopEnd;
  double gStart[2];
  double gPitch[2];
  i32 gAge[2];
  i32 gOn[2];
  i32 counter;
  i32 primed;
  double lastStart;
  double lastPitch;
  float win[ST_G];
  float ref[ST_CORR_POINTS];
  float region[ST_REGION];
} Stretch;

EXPORT Stretch *st_create(void) {
  Stretch *s = (Stretch *)dh_alloc(sizeof(Stretch));
  if (!s) return 0;
  for (i32 i = 0; i < ST_G; i++) s->win[i] = (float)(0.5 - 0.5 * js_cos(2.0 * PI * (double)i / (double)ST_G));
  return s;
}

EXPORT void st_set_source(Stretch *s, const float *L, const float *R, i32 len) {
  s->L = L;
  s->R = R;
  s->len = len;
  s->gOn[0] = s->gOn[1] = 0;
  s->primed = 0;
}

EXPORT void st_set_loop(Stretch *s, i32 on, double start, double end) {
  s->loopOn = on && (end - start) > 8.0;
  s->loopStart = start;
  s->loopEnd = end;
}

static inline i32 st_wrap_i(const Stretch *s, i32 i) {
  if (s->loopOn) {
    i32 le = (i32)s->loopEnd;
    i32 ll = le - (i32)s->loopStart;
    if (ll > 0) while (i >= le) i -= ll;
  }
  return i;
}

static inline float st_at(const float *d, i32 len, i32 i) {
  return (i >= 0 && i < len) ? d[i] : 0.0f;
}

static inline void st_read(const Stretch *s, double x, float *outL, float *outR) {
  double fl = floor_d(x);
  i32 i = (i32)fl;
  float t = (float)(x - fl);
  i32 a = st_wrap_i(s, i - 1), b = st_wrap_i(s, i), c = st_wrap_i(s, i + 1), d = st_wrap_i(s, i + 2);
  *outL = hermite(st_at(s->L, s->len, a), st_at(s->L, s->len, b), st_at(s->L, s->len, c), st_at(s->L, s->len, d), t);
  *outR = hermite(st_at(s->R, s->len, a), st_at(s->R, s->len, b), st_at(s->R, s->len, c), st_at(s->R, s->len, d), t);
}

static inline float st_mono(const Stretch *s, i32 i) {
  i = st_wrap_i(s, i);
  if (i < 0 || i >= s->len) return 0.0f;
  return s->L[i] + s->R[i];
}

/* Find the grain start near `nominal` whose waveform best continues the grain
 * that is currently fading out (classic WSOLA similarity search). */
static double st_find_best(Stretch *s, double nominal, double natural, double pitch) {
  i32 q = (i32)(pitch * 4.0 + 0.5);
  if (q < 1) q = 1;
  if (q > 16) q = 16;
  i32 nat = (i32)floor_d(natural);
  for (i32 j = 0; j < ST_CORR_POINTS; j++) s->ref[j] = st_mono(s, nat + j * q);

  i32 base = (i32)floor_d(nominal) - ST_SEARCH;
  i32 regionLen = 2 * ST_SEARCH + ST_CORR_POINTS * q + 1;
  if (regionLen > ST_REGION) regionLen = ST_REGION;
  for (i32 j = 0; j < regionLen; j++) s->region[j] = st_mono(s, base + j);

  float best = -3.0e38f;
  i32 bestD = ST_SEARCH;
  for (i32 d = 0; d <= 2 * ST_SEARCH; d += ST_SEARCH_STEP) {
    float c = 0.0f;
    const float *r = s->region + d;
    for (i32 j = 0; j < ST_CORR_POINTS; j++) c += s->ref[j] * r[j * q];
    if (c > best) {
      best = c;
      bestD = d;
    }
  }
  return (double)(base + bestD) + (nominal - floor_d(nominal));
}

static void st_start_grain(Stretch *s, double nominal, double pitch) {
  i32 slot = s->gOn[0] ? 1 : 0;
  if (s->gOn[0] && s->gOn[1]) slot = (s->gAge[0] >= s->gAge[1]) ? 0 : 1;
  double start = nominal;
  if (s->primed) {
    double natural = s->lastStart + (double)ST_H * s->lastPitch;
    start = st_find_best(s, nominal, natural, pitch);
  }
  s->gStart[slot] = start;
  s->gPitch[slot] = pitch;
  s->gAge[slot] = 0;
  s->gOn[slot] = 1;
  s->lastStart = start;
  s->lastPitch = pitch;
  s->primed = 1;
}

/* Begin stretching at `pos` so that the first output sample equals the
 * varispeed output at the same position (click-free engagement). */
EXPORT void st_reset(Stretch *s, double pos, double pitch) {
  s->gOn[0] = 1;
  s->gStart[0] = pos - (double)ST_H * pitch;
  s->gPitch[0] = pitch;
  s->gAge[0] = ST_H;
  s->gOn[1] = 0;
  s->gAge[1] = 0;
  s->counter = 0;
  s->lastStart = s->gStart[0];
  s->lastPitch = pitch;
  s->primed = 1;
}

/* Render n frames. `pos` is the playhead (source samples), `rate` the time
 * advance per output sample and `pitch` the grain read speed. Returns the new
 * playhead. */
EXPORT double st_process(Stretch *s, float *outL, float *outR, i32 n, double pos, double rate, double pitch) {
  double loopLen = s->loopEnd - s->loopStart;
  for (i32 i = 0; i < n; i++) {
    if (s->counter <= 0) {
      st_start_grain(s, pos, pitch);
      s->counter = ST_H;
    }
    float l = 0.0f, r = 0.0f;
    for (i32 k = 0; k < 2; k++) {
      if (!s->gOn[k]) continue;
      i32 age = s->gAge[k];
      float w = s->win[age];
      float sl, sr;
      st_read(s, s->gStart[k] + (double)age * s->gPitch[k], &sl, &sr);
      l += w * sl;
      r += w * sr;
      if (++s->gAge[k] >= ST_G) s->gOn[k] = 0;
    }
    outL[i] = l;
    outR[i] = r;
    pos += rate;
    if (s->loopOn && pos >= s->loopEnd) pos -= loopLen;
    s->counter--;
  }
  return pos;
}

/* Position currently most audible (used when handing back to varispeed). */
EXPORT double st_read_pos(Stretch *s) {
  i32 best = -1;
  float bw = -1.0f;
  for (i32 k = 0; k < 2; k++) {
    if (!s->gOn[k]) continue;
    float w = s->win[s->gAge[k] < ST_G ? s->gAge[k] : ST_G - 1];
    if (w > bw) {
      bw = w;
      best = k;
    }
  }
  if (best < 0) return s->lastStart;
  return s->gStart[best] + (double)s->gAge[best] * s->gPitch[best];
}

/* ------------------------------------------------------------------------ */
/* FFT (radix-2, in place)                                                    */
/* ------------------------------------------------------------------------ */

#define SN 1024
#define SLOG 10
#define SHOP 256
#define SBINS (SN / 2 + 1)
#define ST_T 15  /* frames in the time-direction median (harmonic), ~80 ms */
#define SF 11    /* bins in the frequency-direction median (percussive) */

typedef struct {
  float twr[SN / 2];
  float twi[SN / 2];
  i32 rev[SN];
} FFTTables;

static void fft_init(FFTTables *t) {
  for (i32 i = 0; i < SN / 2; i++) {
    double a = -2.0 * PI * (double)i / (double)SN;
    t->twr[i] = (float)js_cos(a);
    t->twi[i] = (float)js_sin(a);
  }
  for (i32 i = 0; i < SN; i++) {
    i32 r = 0, x = i;
    for (i32 b = 0; b < SLOG; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    t->rev[i] = r;
  }
}

static void fft(const FFTTables *t, float *re, float *im) {
  for (i32 i = 0; i < SN; i++) {
    i32 j = t->rev[i];
    if (j > i) {
      float tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      float ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (i32 size = 2; size <= SN; size <<= 1) {
    i32 half = size >> 1;
    i32 step = SN / size;
    for (i32 i = 0; i < SN; i += size) {
      for (i32 j = 0; j < half; j++) {
        float wr = t->twr[j * step];
        float wi = t->twi[j * step];
        i32 a = i + j, b = a + half;
        float xr = re[b] * wr - im[b] * wi;
        float xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/* ------------------------------------------------------------------------ */
/* 2. STFT stem separator                                                     */
/* ------------------------------------------------------------------------ */

typedef struct {
  FFTTables fftt;
  float win[SN];
  float inL[SN], inR[SN];
  float hopL[SHOP], hopR[SHOP];
  float outL[SHOP], outR[SHOP];
  float olaL[SN], olaR[SN];
  float re[SN], im[SN];
  float xlr[SBINS], xli[SBINS], xrr[SBINS], xri[SBINS];
  float hist[ST_T][SBINS];
  float mag[SBINS], side[SBINS];
  float hm[SBINS], pm[SBINS];
  float gs[SBINS];
  float bassW[SBINS], vocW[SBINS];
  float med[32];
  float g[4]; /* vocal, drums, bass, melody */
  i32 histPos, histCount;
  i32 fill;
  i32 mode; /* 0 bypass, 1 warming up, 2 active */
  i32 warm;
  i32 idle;
  float mix;
} Stems;

static inline float smoothstep_f(float e0, float e1, float x) {
  float t = (x - e0) / (e1 - e0);
  if (t < 0.0f) t = 0.0f;
  if (t > 1.0f) t = 1.0f;
  return t * t * (3.0f - 2.0f * t);
}

EXPORT Stems *stems_create(float sampleRate) {
  Stems *s = (Stems *)dh_alloc(sizeof(Stems));
  if (!s) return 0;
  fft_init(&s->fftt);
  for (i32 i = 0; i < SN; i++) {
    double h = 0.5 - 0.5 * js_cos(2.0 * PI * (double)i / (double)SN);
    s->win[i] = sqrt_f((float)h);
  }
  float binHz = sampleRate / (float)SN;
  for (i32 k = 0; k < SBINS; k++) {
    float f = (float)k * binHz;
    s->bassW[k] = 1.0f - smoothstep_f(110.0f, 190.0f, f);
    s->vocW[k] = smoothstep_f(170.0f, 300.0f, f) * (1.0f - smoothstep_f(4200.0f, 7500.0f, f));
    s->gs[k] = 1.0f;
  }
  s->g[0] = s->g[1] = s->g[2] = s->g[3] = 1.0f;
  return s;
}

EXPORT void stems_set_gains(Stems *s, float vocal, float drums, float bass, float melody) {
  s->g[0] = vocal;
  s->g[1] = drums;
  s->g[2] = bass;
  s->g[3] = melody;
}

EXPORT i32 stems_latency(void) { return SN; }

EXPORT i32 stems_active(Stems *s) { return s->mode; }

static float median_small(float *v, i32 n) {
  for (i32 i = 1; i < n; i++) {
    float x = v[i];
    i32 j = i - 1;
    while (j >= 0 && v[j] > x) {
      v[j + 1] = v[j];
      j--;
    }
    v[j + 1] = x;
  }
  return v[n >> 1];
}

static void stems_spectral(Stems *s) {
  float *re = s->re, *im = s->im;
  for (i32 n = 0; n < SN; n++) {
    re[n] = s->inL[n] * s->win[n];
    im[n] = s->inR[n] * s->win[n];
  }
  fft(&s->fftt, re, im);

  /* Unpack the two real spectra from one complex FFT */
  for (i32 k = 0; k < SBINS; k++) {
    i32 nk = (SN - k) & (SN - 1);
    float xlr = 0.5f * (re[k] + re[nk]);
    float xli = 0.5f * (im[k] - im[nk]);
    float xrr = 0.5f * (im[k] + im[nk]);
    float xri = -0.5f * (re[k] - re[nk]);
    s->xlr[k] = xlr;
    s->xli[k] = xli;
    s->xrr[k] = xrr;
    s->xri[k] = xri;
    float mr = xlr + xrr, mi = xli + xri;
    float sr = xlr - xrr, si = xli - xri;
    s->mag[k] = sqrt_f(mr * mr + mi * mi);
    s->side[k] = sqrt_f(sr * sr + si * si);
    s->hist[s->histPos][k] = s->mag[k];
  }
  s->histPos = (s->histPos + 1) % ST_T;
  if (s->histCount < ST_T) s->histCount++;

  /* Harmonic estimate: median across time. Percussive: median across frequency */
  for (i32 k = 0; k < SBINS; k++) {
    for (i32 t = 0; t < s->histCount; t++) s->med[t] = s->hist[t][k];
    s->hm[k] = median_small(s->med, s->histCount);
  }
  for (i32 k = 0; k < SBINS; k++) {
    i32 lo = k - SF / 2, hi = k + SF / 2, m = 0;
    if (lo < 0) lo = 0;
    if (hi > SBINS - 1) hi = SBINS - 1;
    for (i32 j = lo; j <= hi; j++) s->med[m++] = s->mag[j];
    s->pm[k] = median_small(s->med, m);
  }

  for (i32 k = 0; k < SBINS; k++) {
    float h = s->hm[k], p = s->pm[k];
    float h2 = h * h, p2 = p * p;
    float mh = h2 / (h2 + p2 + 1e-12f);
    float mp = 1.0f - mh;
    float m = s->mag[k], sd = s->side[k];
    float c = 1.0f - sd / (m + sd + 1e-9f);
    float cc = (c - 0.55f) * 2.2f;
    if (cc < 0.0f) cc = 0.0f;
    if (cc > 1.0f) cc = 1.0f;
    cc = cc * cc;
    float mb = mh * s->bassW[k];
    float rest = mh - mb;
    float mv = rest * s->vocW[k] * cc;
    float mm = rest - mv;
    float G = s->g[0] * mv + s->g[1] * mp + s->g[2] * mb + s->g[3] * mm;
    s->gs[k] += 0.7f * (G - s->gs[k]);
  }

  /* Apply gains and repack both channels into one complex inverse FFT */
  for (i32 k = 0; k < SBINS; k++) {
    float g = s->gs[k];
    float ylr = g * s->xlr[k], yli = g * s->xli[k];
    float yrr = g * s->xrr[k], yri = g * s->xri[k];
    re[k] = ylr - yri;
    im[k] = yli + yrr;
    if (k > 0 && k < SN / 2) {
      re[SN - k] = ylr + yri;
      im[SN - k] = yrr - yli;
    }
  }
  /* inverse FFT via conjugation */
  for (i32 n = 0; n < SN; n++) im[n] = -im[n];
  fft(&s->fftt, re, im);
  float scale = 0.5f / (float)SN; /* 1/N and Hann^2 overlap at hop N/4 sums to 2 */
  for (i32 n = 0; n < SN; n++) {
    float w = s->win[n] * scale;
    s->olaL[n] += re[n] * w;
    s->olaR[n] += -im[n] * w;
  }
}

static void stems_frame(Stems *s) {
  __builtin_memmove(s->inL, s->inL + SHOP, (SN - SHOP) * sizeof(float));
  __builtin_memmove(s->inR, s->inR + SHOP, (SN - SHOP) * sizeof(float));
  __builtin_memcpy(s->inL + SN - SHOP, s->hopL, SHOP * sizeof(float));
  __builtin_memcpy(s->inR + SN - SHOP, s->hopR, SHOP * sizeof(float));

  i32 unity = fabs_f(s->g[0] - 1.0f) < 1e-3f && fabs_f(s->g[1] - 1.0f) < 1e-3f &&
              fabs_f(s->g[2] - 1.0f) < 1e-3f && fabs_f(s->g[3] - 1.0f) < 1e-3f;
  if (!unity) {
    s->idle = 0;
    if (s->mode == 0) {
      s->mode = 1;
      s->warm = 0;
      s->histCount = 0;
      s->histPos = 0;
      for (i32 k = 0; k < SBINS; k++) s->gs[k] = 1.0f;
    }
  } else if (s->mode != 0) {
    s->idle++;
  }

  if (s->mode != 0) {
    stems_spectral(s);
    if (s->mode == 1 && ++s->warm >= ST_T + SN / SHOP) s->mode = 2;
  }

  float target = (s->mode == 2 && !unity) ? 1.0f : 0.0f;
  float step = 1.0f / (float)SHOP;
  for (i32 j = 0; j < SHOP; j++) {
    if (s->mix < target) {
      s->mix += step;
      if (s->mix > target) s->mix = target;
    } else if (s->mix > target) {
      s->mix -= step;
      if (s->mix < target) s->mix = target;
    }
    float dry = 1.0f - s->mix;
    s->outL[j] = s->inL[j] * dry + s->olaL[j] * s->mix;
    s->outR[j] = s->inR[j] * dry + s->olaR[j] * s->mix;
  }
  __builtin_memmove(s->olaL, s->olaL + SHOP, (SN - SHOP) * sizeof(float));
  __builtin_memmove(s->olaR, s->olaR + SHOP, (SN - SHOP) * sizeof(float));
  __builtin_memset(s->olaL + SN - SHOP, 0, SHOP * sizeof(float));
  __builtin_memset(s->olaR + SN - SHOP, 0, SHOP * sizeof(float));

  if (s->mode != 0 && unity && s->idle > 32 && s->mix <= 0.0f) {
    s->mode = 0;
    __builtin_memset(s->olaL, 0, sizeof(s->olaL));
    __builtin_memset(s->olaR, 0, sizeof(s->olaR));
  }
}

/* In-place processing. Latency is always SN samples (dry path is delayed by
 * the same amount) so enabling stems never shifts the beat. */
EXPORT void stems_process(Stems *s, float *L, float *R, i32 n) {
  for (i32 i = 0; i < n; i++) {
    float xl = L[i], xr = R[i];
    L[i] = s->outL[s->fill];
    R[i] = s->outR[s->fill];
    s->hopL[s->fill] = xl;
    s->hopR[s->fill] = xr;
    if (++s->fill == SHOP) {
      s->fill = 0;
      stems_frame(s);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* 3. Streaming pitch shifter (two crossfaded delay taps)                     */
/* ------------------------------------------------------------------------ */

#define PS_SIZE 8192
#define PS_MASK (PS_SIZE - 1)
#define PS_TAB 1024

typedef struct {
  float bufL[PS_SIZE];
  float bufR[PS_SIZE];
  float tab[PS_TAB + 1]; /* sin^2 window over [0, 1] */
  i32 w;
  double phase;
  float ratio;
  float window;
} PShift;

EXPORT PShift *ps_create(float sampleRate) {
  PShift *p = (PShift *)dh_alloc(sizeof(PShift));
  if (!p) return 0;
  for (i32 i = 0; i <= PS_TAB; i++) {
    double s = js_sin(PI * (double)i / (double)PS_TAB);
    p->tab[i] = (float)(s * s);
  }
  p->ratio = 1.0f;
  p->window = sampleRate * 0.05f;
  if (p->window > PS_SIZE / 2) p->window = PS_SIZE / 2;
  return p;
}

EXPORT void ps_set_ratio(PShift *p, float ratio) { p->ratio = ratio; }

static inline float ps_tap(const float *buf, i32 w, float delay) {
  float x = (float)w - delay - 2.0f;
  while (x < 0.0f) x += (float)PS_SIZE;
  i32 i = (i32)x;
  float f = x - (float)i;
  float a = buf[i & PS_MASK], b = buf[(i + 1) & PS_MASK];
  return a + (b - a) * f;
}

static inline float ps_win(const PShift *p, double ph) {
  float x = (float)ph * (float)PS_TAB;
  i32 i = (i32)x;
  if (i >= PS_TAB) i = PS_TAB - 1;
  float f = x - (float)i;
  return p->tab[i] + (p->tab[i + 1] - p->tab[i]) * f;
}

EXPORT void ps_process(PShift *p, float *L, float *R, i32 n) {
  double inc = (1.0 - (double)p->ratio) / (double)p->window;
  for (i32 i = 0; i < n; i++) {
    p->bufL[p->w] = L[i];
    p->bufR[p->w] = R[i];
    double ph1 = p->phase;
    double ph2 = ph1 + 0.5;
    if (ph2 >= 1.0) ph2 -= 1.0;
    float d1 = (float)ph1 * p->window, d2 = (float)ph2 * p->window;
    float w1 = ps_win(p, ph1), w2 = ps_win(p, ph2);
    L[i] = ps_tap(p->bufL, p->w, d1) * w1 + ps_tap(p->bufL, p->w, d2) * w2;
    R[i] = ps_tap(p->bufR, p->w, d1) * w1 + ps_tap(p->bufR, p->w, d2) * w2;
    p->phase += inc;
    if (p->phase >= 1.0) p->phase -= 1.0;
    if (p->phase < 0.0) p->phase += 1.0;
    p->w = (p->w + 1) & PS_MASK;
  }
}
