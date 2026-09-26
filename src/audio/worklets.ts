/* Loads the AudioWorklet modules (from Blob URLs so every build mode works)
 * and prepares the WebAssembly DSP binary for the processors. */
import deckSrc from './worklets/deck-processor.js?raw';
import fxSrc from './worklets/fx-processors.js?raw';
import { DSP_WASM_BASE64 } from './wasm/dspWasm';
import { base64ToBytes } from '../core/util';

let wasmBytes: Uint8Array | null = null;
let wasmUsable: boolean | null = null;

export async function loadWorklets(ctx: BaseAudioContext): Promise<void> {
  for (const src of [deckSrc, fxSrc]) {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Returns a fresh copy of the DSP wasm binary, or null when WebAssembly can't
 * be compiled here (e.g. a Content-Security-Policy without wasm-unsafe-eval). */
export async function dspWasm(): Promise<ArrayBuffer | null> {
  if (!wasmBytes) wasmBytes = base64ToBytes(DSP_WASM_BASE64);
  if (wasmUsable === null) {
    try {
      await WebAssembly.compile(wasmBytes as BufferSource);
      wasmUsable = true;
    } catch (err) {
      console.warn('WebAssembly DSP unavailable, key lock and stems disabled:', err);
      wasmUsable = false;
    }
  }
  return wasmUsable ? (wasmBytes.slice().buffer as ArrayBuffer) : null;
}
