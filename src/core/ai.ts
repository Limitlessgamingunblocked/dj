/*
 * The AI the crowd talks through: an OpenAI-style chat server the player
 * runs themselves, OmniRoute (github.com/diegosouzapw/OmniRoute) or
 * FreeLLMAPI (github.com/tashfeenahmed/freellmapi). Either runs on the
 * player's own computer and hands out one key for the free AI models behind
 * it, so the game ships with no key and no server address of its own: the
 * player pastes their key in Settings → AI crowd, and it stays in this
 * browser (never in the settings file, see core/backup.ts).
 *
 * With no key, or when the server can't be reached, everything that asks the
 * AI has its own built-in lines to fall back on.
 */
import { loadSetting, saveSetting } from './settings';

export interface AiSettings {
  /** the server's OpenAI-style base address, ending in /v1; '' finds OmniRoute or FreeLLMAPI on this computer */
  url: string;
  key: string;
  /** 'auto' lets the server's router pick a model (both OmniRoute and FreeLLMAPI know it) */
  model: string;
}

/** the settings key: core/backup.ts leaves it out of the settings file */
export const AI_SETTING = 'ai';

/** where OmniRoute listens, from npm and from its desktop app alike */
export const OMNIROUTE_URLS = ['http://localhost:20128/v1'];
/** where FreeLLMAPI listens: the server's own port, then the desktop app's */
export const FREELLMAPI_URLS = ['http://localhost:3001/v1', 'http://127.0.0.1:31415/v1'];
/** every address the game looks on when the player leaves the address empty */
export const AI_LOCAL_URLS = [...OMNIROUTE_URLS, ...FREELLMAPI_URLS];

export const AI_DEFAULTS: AiSettings = { url: '', key: '', model: 'auto' };

/** FreeLLMAPI's unified keys look like this (other servers' keys are fine too) */
export const FREELLMAPI_KEY = /^freellmapi-[a-f0-9]{48}$/;
/** OmniRoute's keys (Dashboard → API Keys): sk-{machine}-{key id}-{check}, or an older sk-{8} */
export const OMNIROUTE_KEY = /^sk-(?:[A-Za-z0-9]{8}|[A-Za-z0-9]{16}-[a-f0-9]{6}-[a-f0-9]{8})$/;

/** which server a key looks like it came from, if either */
export function keyServer(key: string): 'OmniRoute' | 'FreeLLMAPI' | null {
  return FREELLMAPI_KEY.test(key) ? 'FreeLLMAPI' : OMNIROUTE_KEY.test(key) ? 'OmniRoute' : null;
}

/** the addresses on this computer to try, the server the key belongs to first */
export function localUrls(key: string): string[] {
  return keyServer(key) === 'FreeLLMAPI' ? [...FREELLMAPI_URLS, ...OMNIROUTE_URLS] : AI_LOCAL_URLS;
}

/** the name of the server at a local address, for the Test button */
export function serverAt(base: string): string | null {
  return OMNIROUTE_URLS.includes(base) ? 'OmniRoute' : FREELLMAPI_URLS.includes(base) ? 'FreeLLMAPI' : null;
}

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

export type AiProblem = 'no-key' | 'unreachable' | 'key' | 'no-models' | 'busy' | 'server' | 'empty';

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
      return 'Paste your OmniRoute or FreeLLMAPI key first.';
    case 'unreachable':
      return 'Couldn’t reach the AI server. Is OmniRoute or FreeLLMAPI running? If FreeLLMAPI is, it needs to let the game in: see the note below.';
    case 'key':
      return 'The server turned the key down. Copy it again from OmniRoute → API Keys, or FreeLLMAPI → Keys → Unified API key.';
    case 'no-models':
      return 'The server has no AI models connected yet. Add a free provider in its dashboard (OmniRoute → Providers), then test again.';
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
  if (!res.ok) {
    // OmniRoute with no provider connected says so, sometimes with a 401 that isn't about the key
    const why = await res.text().catch(() => '');
    if (/no (active )?(credentials|providers?|connections?)\b/i.test(why)) throw new AiError('no-models', `HTTP ${res.status}`);
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

/** One chat turn. Throws AiError. With no address set it tries OmniRoute's and FreeLLMAPI's usual ports on this computer. */
export async function chat(messages: ChatMessage[], o: ChatOptions = {}): Promise<string> {
  const s = current;
  if (!s.key) throw new AiError('no-key', 'no key');
  const bases = s.url ? [s.url] : found ? [found] : localUrls(s.key);
  let last: AiError | null = null;
  let refused: AiError | null = null;
  for (const base of bases) {
    try {
      const text = await post(base, s, messages, o);
      if (!s.url) found = base;
      return text;
    } catch (e) {
      last = e instanceof AiError ? e : new AiError('server', String(e));
      // a missing server is worth trying the next address for, and so is one
      // that turns the key down while we're looking (it may be the other server's key)
      if (last.problem === 'key' && !s.url && !found) refused = last;
      else if (last.problem !== 'unreachable') throw last;
    }
  }
  throw refused ?? last ?? new AiError('unreachable', 'no address');
}

/** Settings' Test button: a one-word round trip. Resolves to the address that answered. */
export async function testAi(): Promise<string> {
  await chat([{ role: 'user', content: 'Reply with the single word: ready' }], { maxTokens: 64, temperature: 0, timeoutMs: 20000 });
  return current.url || found || AI_LOCAL_URLS[0];
}
