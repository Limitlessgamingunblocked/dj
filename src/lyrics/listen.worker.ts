/*
 * The AI lyrics listener. Runs OpenAI's Whisper speech model in the browser
 * (through Hugging Face's transformers.js, on the graphics card with WebGPU
 * where it can, otherwise on the processor with WebAssembly) over a track's
 * vocal stem, one sung stretch at a time, and sends back each word with the
 * moment it's sung.
 *
 * Nothing leaves the device: the model and its runtime download once from
 * public CDNs (jsDelivr, Hugging Face) and are kept in the browser's cache;
 * the audio goes straight from this worker to the model.
 */
import { LISTEN_MODELS, type ListenQuality } from './aiModels';
import { cleanHeard, LISTEN_RATE, listenOrder, listenWindows, vocalStem, type HeardChunk } from './listen';
import { analyzeVocals } from './vocal';

const VERSION = '3.8.1';
const LIB = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${VERSION}/dist/transformers.min.js`;

export type ListenIn =
  | { type: 'listen'; job: number; left: Float32Array; right: Float32Array; duration: number; from: number; quality: ListenQuality; language: string }
  | { type: 'cancel'; job: number };

export type ListenStage = 'runtime' | 'download' | 'warmup' | 'analysing' | 'language' | 'listening';

export type ListenOut =
  | { type: 'stage'; job: number; stage: ListenStage; progress: number; device?: string }
  | { type: 'words'; job: number; done: number; total: number; words: { t: number; end: number; text: string }[]; window: { start: number; end: number } }
  | { type: 'done'; job: number; model: string; device: string; language: string; windows: number; heard: number }
  | { type: 'error'; job: number; message: string };

/* the slice of transformers.js used here */
interface Tensor {
  tolist(): unknown[];
}
interface Asr {
  (audio: Float32Array, opts: Record<string, unknown>): Promise<{ text: string; chunks?: HeardChunk[] }>;
  dispose(): Promise<void>;
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
  model: { generate(o: Record<string, unknown>): Promise<Tensor | { sequences: Tensor }>; generation_config?: { lang_to_id?: Record<string, number>; decoder_start_token_id?: number } };
}
interface Lib {
  pipeline(task: string, model: string, opts: Record<string, unknown>): Promise<Asr>;
  env: { allowLocalModels: boolean; useBrowserCache: boolean };
}

const ctx = self as unknown as { postMessage(m: ListenOut, t?: Transferable[]): void; onmessage: ((e: MessageEvent<ListenIn>) => void) | null };
const post = (m: ListenOut) => ctx.postMessage(m);

let lib: Promise<Lib> | null = null;
let loaded: { asr: Asr; quality: ListenQuality; repo: string; device: string } | null = null;
const cancelled = new Set<number>();
let queue: Promise<void> = Promise.resolve();

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function loadModel(job: number, quality: ListenQuality): Promise<NonNullable<typeof loaded>> {
  if (loaded && loaded.quality === quality) return loaded;
  if (loaded) {
    await loaded.asr.dispose().catch(() => {});
    loaded = null;
  }
  post({ type: 'stage', job, stage: 'runtime', progress: 0 });
  lib ??= import(/* @vite-ignore */ LIB) as Promise<Lib>;
  let tf: Lib;
  try {
    tf = await lib;
  } catch (e) {
    lib = null;
    throw e;
  }
  tf.env.allowLocalModels = false;
  tf.env.useBrowserCache = typeof caches !== 'undefined';

  // download progress over every file of the model
  const files = new Map<string, { loaded: number; total: number }>();
  let lastPost = 0;
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (!p.file || (p.status !== 'progress' && p.status !== 'done' && p.status !== 'initiate')) return;
    const f = files.get(p.file) ?? { loaded: 0, total: 0 };
    if (p.status === 'progress') {
      f.loaded = p.loaded ?? f.loaded;
      f.total = p.total ?? f.total;
    } else if (p.status === 'done') f.loaded = f.total;
    files.set(p.file, f);
    const now = performance.now();
    if (now - lastPost < 120 && p.status === 'progress') return;
    lastPost = now;
    let a = 0;
    let b = 0;
    for (const x of files.values()) {
      a += x.loaded;
      b += x.total;
    }
    post({ type: 'stage', job, stage: 'download', progress: b ? a / b : 0 });
  };

  const gpu = await hasWebGpu();
  const attempts: { repo: string; device: string; dtype: unknown }[] = [];
  for (const repo of LISTEN_MODELS[quality].repos) {
    if (gpu) attempts.push({ repo, device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
    attempts.push({ repo, device: 'wasm', dtype: 'q8' });
  }
  let last: unknown = null;
  for (const a of attempts) {
    for (let cacheTry = 0; cacheTry < 2; cacheTry++) {
      try {
        const asr = await tf.pipeline('automatic-speech-recognition', a.repo, { device: a.device, dtype: a.dtype, progress_callback });
        // a model can load and still fail on this device's first run: warm it up on a second of silence
        post({ type: 'stage', job, stage: 'warmup', progress: 1, device: a.device });
        await asr(new Float32Array(LISTEN_RATE), { return_timestamps: 'word', language: 'en', task: 'transcribe' });
        loaded = { asr, quality, repo: a.repo, device: a.device };
        return loaded;
      } catch (e) {
        last = e;
        // the browser's cache can refuse (a file:// page, private windows): try once without it
        if (cacheTry === 0 && tf.env.useBrowserCache && /cache/i.test(String((e as Error)?.message ?? e))) {
          tf.env.useBrowserCache = false;
          continue;
        }
        break;
      }
    }
  }
  throw last ?? new Error('No speech model could load.');
}

/** Whisper's own language guess: the token it predicts straight after "start of transcript". */
async function detectLanguage(asr: Asr, audio: Float32Array): Promise<string> {
  try {
    const gc = asr.model.generation_config;
    const ids = gc?.lang_to_id;
    const sot = gc?.decoder_start_token_id;
    if (!ids || sot === undefined) return 'en';
    const { input_features } = await asr.processor(audio);
    const out = await asr.model.generate({ inputs: input_features, decoder_input_ids: [sot], max_new_tokens: 1 });
    const seq = ('sequences' in out ? out.sequences : out).tolist()[0] as (number | bigint)[];
    const id = Number(seq[seq.length - 1]);
    const tok = Object.entries(ids).find(([, v]) => v === id)?.[0];
    const code = tok?.replace(/[<|>]/g, '');
    return code || 'en';
  } catch {
    return 'en';
  }
}

async function listen(m: Extract<ListenIn, { type: 'listen' }>): Promise<void> {
  const { job } = m;
  try {
    const model = await loadModel(job, m.quality);
    if (cancelled.has(job)) return;
    post({ type: 'stage', job, stage: 'analysing', progress: 0, device: model.device });
    const vmap = await analyzeVocals({ sampleRate: LISTEN_RATE, channels: [m.left, m.right] }, (p) => post({ type: 'stage', job, stage: 'analysing', progress: p, device: model.device }));
    const stem = vocalStem(m.left, m.right);
    const windows = listenWindows(vmap, m.duration);
    const cut = (w: { start: number; end: number }) => stem.subarray(Math.floor(w.start * LISTEN_RATE), Math.min(stem.length, Math.ceil(w.end * LISTEN_RATE)));
    let language = m.language;
    if (language === 'auto') {
      post({ type: 'stage', job, stage: 'language', progress: 0, device: model.device });
      // the most sung window says the most about the language
      let best = windows[0];
      let bestV = -1;
      for (const w of windows) {
        const a = vmap.activity;
        let s = 0;
        for (let f = Math.floor(w.start * vmap.rate); f < Math.min(a.length, w.end * vmap.rate); f++) s += a[f];
        if (s > bestV) {
          bestV = s;
          best = w;
        }
      }
      language = best ? await detectLanguage(model.asr, cut(best)) : 'en';
    }
    const order = listenOrder(windows, m.from);
    let heard = 0;
    for (let k = 0; k < order.length; k++) {
      if (cancelled.has(job)) return;
      const w = windows[order[k]];
      post({ type: 'stage', job, stage: 'listening', progress: k / order.length, device: model.device });
      let words: { t: number; end: number; text: string }[] = [];
      try {
        const out = await model.asr(cut(w), { return_timestamps: 'word', language, task: 'transcribe' });
        words = cleanHeard(out.chunks ?? [], w);
      } catch (e) {
        // one bad window doesn't stop the song
        console.warn('AI lyrics: a window failed', e);
      }
      heard += words.length;
      post({ type: 'words', job, done: k + 1, total: order.length, words, window: w });
    }
    post({ type: 'done', job, model: model.repo, device: model.device, language, windows: windows.length, heard });
  } catch (e) {
    post({ type: 'error', job, message: (e as Error)?.message ?? String(e) });
  } finally {
    cancelled.delete(job);
  }
}

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'cancel') cancelled.add(m.job);
  // one track at a time: the model is big, and the playing track should finish first
  else if (m.type === 'listen') queue = queue.then(() => listen(m));
};
