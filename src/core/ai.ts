/*
 * The AI the crowd talks through: an OpenAI-style chat server the player
 * runs themselves, FreeLLMAPI by default (github.com/tashfeenahmed/freellmapi).
 * It runs on the player's own computer and hands out one key for the free AI
 * models behind it, so the game ships with no key and no server address of
 * its own: the player pastes their key in Settings → AI crowd, and it stays
 * in this browser (never in the settings file, see core/backup.ts).
 *
 * With no key, or when the server can't be reached, everything that asks the
 * AI has its own built-in lines to fall back on.
 */
import { loadSetting, saveSetting } from './settings';

export interface AiSettings {
  /** the server's OpenAI-style base address, ending in /v1; '' finds FreeLLMAPI on this computer */
  url: string;
  key: string;
  /** 'auto' lets FreeLLMAPI's router pick a model */
  model: string;
}

/** the settings key: core/backup.ts leaves it out of the settings file */
export const AI_SETTING = 'ai';

/** where FreeLLMAPI listens: the server's own port, then the desktop app's */
export const AI_LOCAL_URLS = ['http://localhost:3001/v1', 'http://127.0.0.1:31415/v1'];

export const AI_DEFAULTS: AiSettings = { url: '', key: '', model: 'auto' };

/** FreeLLMAPI's unified keys look like this (other servers' keys are fine too) */
export const FREELLMAPI_KEY = /^freellmapi-[a-f0-9]{48}$/;

export function cleanAi(raw: unknown): AiSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const url = str(r.url, 300).replace(/\/+$/, '');
  return {
    url: /^https?:\/\/[^\s]+$/i.test(url) ? url : '',
    key: str(r.key, 300).replace(/\s+/g, ''),
    model: str(r.model, 120) || AI_DEFAULTS.model,
  };
}

let current: AiSettings = cleanAi(loadSetting<unknown>(AI_SETTING, null));
/** the address that answered last, when the player left it to us */
let found: string | null = null;

export function aiSettings(): AiSettings {
  return { ...current };
}

export function setAi(p: Partial<AiSettings>): AiSettings {
  current = cleanAi({ ...current, ...p });
  found = null;
  saveSetting(AI_SETTING, current);
  return aiSettings();
}

/** the AI is worth asking: there's a key */
export function aiReady(): boolean {
  return !!current.key;
}

export type AiProblem = 'no-key' | 'unreachable' | 'key' | 'busy' | 'server' | 'empty';

export class AiError extends Error {
  constructor(
    readonly problem: AiProblem,
    message: string,
  ) {
    super(message);
  }
}

/** what to tell the player when a call fails */
export function problemText(p: AiProblem): string {
  switch (p) {
    case 'no-key':
      return 'Paste your FreeLLMAPI key first.';
    case 'unreachable':
      return 'Couldn’t reach the AI server. Is FreeLLMAPI running? If it is, it needs to let the game in: see the note below.';
    case 'key':
      return 'The server turned the key down. Copy it again from FreeLLMAPI → Keys → Unified API key.';
    case 'busy':
      return 'The free AI models are busy or out of quota right now. The crowd uses its own lines until they’re back.';
    case 'empty':
      return 'The AI answered with nothing usable.';
    default:
      return 'The AI server had a problem. The crowd uses its own lines for now.';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function post(base: string, s: AiSettings, messages: ChatMessage[], o: ChatOptions): Promise<string> {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  o.signal?.addEventListener('abort', stop);
  const timer = setTimeout(stop, o.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.key}` },
      body: JSON.stringify({ model: s.model, messages, max_tokens: o.maxTokens ?? 300, temperature: o.temperature ?? 0.9 }),
      signal: ctl.signal,
    });
  } catch {
    // a server that isn't there, or one that won't let this page in (CORS), both land here
    throw new AiError('unreachable', `no answer from ${base}`);
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', stop);
  }
  if (res.status === 401 || res.status === 403) throw new AiError('key', `HTTP ${res.status}`);
  if (res.status === 429 || res.status === 503) throw new AiError('busy', `HTTP ${res.status}`);
  if (!res.ok) throw new AiError('server', `HTTP ${res.status}`);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new AiError('server', 'not JSON');
  }
  const text = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new AiError('empty', 'no content');
  return text;
}

/** One chat turn. Throws AiError. With no address set it tries FreeLLMAPI's usual ports on this computer. */
export async function chat(messages: ChatMessage[], o: ChatOptions = {}): Promise<string> {
  const s = current;
  if (!s.key) throw new AiError('no-key', 'no key');
  const bases = s.url ? [s.url] : found ? [found] : AI_LOCAL_URLS;
  let last: AiError | null = null;
  for (const base of bases) {
    try {
      const text = await post(base, s, messages, o);
      if (!s.url) found = base;
      return text;
    } catch (e) {
      last = e instanceof AiError ? e : new AiError('server', String(e));
      // only a missing server is worth trying the next address for
      if (last.problem !== 'unreachable') throw last;
    }
  }
  throw last ?? new AiError('unreachable', 'no address');
}

/** Settings' Test button: a one-word round trip. Resolves to the address that answered. */
export async function testAi(): Promise<string> {
  await chat([{ role: 'user', content: 'Reply with the single word: ready' }], { maxTokens: 64, temperature: 0, timeoutMs: 20000 });
  return current.url || found || AI_LOCAL_URLS[0];
}
