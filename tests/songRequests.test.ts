import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_LOCAL_URLS, AiError, chat, cleanAi, FREELLMAPI_URLS, keyServer, OMNIROUTE_URLS, setAi } from '../src/core/ai';
import { BACKUP_KIND, parseBackup } from '../src/core/backup';
import { Requests, type RequestInput } from '../src/game/requests';
import { builtInAsk, parseRequest, requestPrompt, shortlist, shoutTitle, SIGN_MAX, SHOUT_MAX, type AskContext, type SongAsk, type SongCandidate } from '../src/game/songRequests';
import { setBlockedWords } from '../src/name/filter';

const cands: SongCandidate[] = [
  { id: 'a', title: 'Delilah (pull me out of this) (Original Mix)', artist: 'Fred again..', bpm: 124, genre: 'House' },
  { id: 'b', title: 'Rumble', artist: 'Skrillex', bpm: 140 },
  { id: 'c', title: 'Untitled 7', artist: 'Unknown', bpm: 126 },
];
const ctx: AskContext = { venue: 'Warehouse', slot: 'Peak time', vibe: 0.7, djName: 'CASH', playing: { title: 'Losing It', artist: 'FISHER', bpm: 125, genre: 'Tech house' }, recent: ['Hen do bride'] };

describe('song requests: the crowd’s own lines', () => {
  it('shout for a track on the shortlist, with a sign that fits the cardboard', () => {
    for (let i = 0; i < 40; i++) {
      const ask = builtInAsk(cands, { recent: [] })!;
      expect(cands.map((c) => c.id)).toContain(ask.trackId);
      expect(ask.ai).toBe(false);
      expect(ask.shout.length).toBeLessThanOrEqual(SHOUT_MAX);
      expect(ask.sign.length).toBeLessThanOrEqual(SIGN_MAX);
      expect(ask.sign).toBe(ask.sign.toUpperCase());
      expect(ask.shout).not.toMatch(/\{|Original Mix/);
      // an unknown artist is never shouted
      if (ask.trackId === 'c') expect(ask.shout).not.toMatch(/Unknown/);
    }
  });

  it('come from someone who hasn’t asked tonight, and favour the best picks', () => {
    const rnd = () => 0;
    const ask = builtInAsk(cands, { recent: ['Hen do bride'] }, rnd)!;
    expect(ask.trackId).toBe('a');
    expect(ask.who).not.toBe('Hen do bride');
    expect(builtInAsk([], { recent: [] })).toBeNull();
  });

  it('drop the "(Original Mix)" from a title', () => {
    expect(shoutTitle('Rumble (Extended Mix)')).toBe('Rumble');
    expect(shoutTitle('Strings of Life')).toBe('Strings of Life');
  });
});

describe('song requests: the AI', () => {
  afterEach(() => setBlockedWords({}));

  it('is told the night and the shortlist, and who already asked', () => {
    const [sys, user] = requestPrompt(cands, ctx);
    expect(sys.role).toBe('system');
    expect(user.content).toContain('Warehouse');
    expect(user.content).toContain('1. "Delilah (pull me out of this)" by Fred again..');
    expect(user.content).toContain('3. "Untitled 7" (126 BPM)');
    expect(user.content).toContain('Hen do bride');
    expect(user.content).toContain('"pick"');
  });

  it('has its reply read even with chatter or a code fence around it', () => {
    const ask = parseRequest('Sure! ```json\n{"pick": 2, "who": "Bucket hat lad", "shout": "\\"RUMBLE! Play Rumble!\\"", "sign": "rumble pls"}\n```', cands)!;
    expect(ask).toMatchObject({ trackId: 'b', who: 'Bucket hat lad', shout: 'RUMBLE! Play Rumble!', sign: 'RUMBLE PLS', ai: true });
    // a pick as a string is fine; a missing sign gets one made
    expect(parseRequest('{"pick":"1","who":"Glitter twins","shout":"Delilah!!"}', cands)?.sign.length).toBeGreaterThan(0);
  });

  it('is turned down when the reply isn’t usable, so the crowd’s own lines take over', () => {
    expect(parseRequest('no idea', cands)).toBeNull();
    expect(parseRequest('{"pick": 9, "who": "x", "shout": "y"}', cands)).toBeNull();
    expect(parseRequest('{"pick": 1, "who": "", "shout": "y"}', cands)).toBeNull();
    expect(parseRequest('{"pick": 1, "who": "x"', cands)).toBeNull();
  });

  it('keeps to a length the HUD and the signs can show', () => {
    const long = 'play it '.repeat(40);
    const ask = parseRequest(JSON.stringify({ pick: 1, who: 'A very long name for someone in a crowd', shout: long, sign: long }), cands)!;
    expect(ask.shout.length).toBeLessThanOrEqual(SHOUT_MAX);
    expect(ask.sign.length).toBeLessThanOrEqual(SIGN_MAX);
    expect(ask.who.length).toBeLessThanOrEqual(28);
  });

  it('goes through the name filter, but a track’s own title can say anything', () => {
    setBlockedWords({ whole: ['rumble', 'badword'] });
    expect(parseRequest('{"pick": 1, "who": "Badword fan", "shout": "Delilah!"}', cands)).toBeNull();
    // "Rumble" is the track's name, so it's allowed in the shout
    expect(parseRequest('{"pick": 2, "who": "Bass head", "shout": "Rumble please!"}', cands)?.trackId).toBe('b');
  });

  it('gets the best few and a wildcard or two to choose from', () => {
    const ranked = Array.from({ length: 10 }, (_, i): SongCandidate => ({ id: `r${i}`, title: `R${i}`, artist: '', bpm: 124 }));
    const rest = Array.from({ length: 10 }, (_, i): SongCandidate => ({ id: `x${i}`, title: `X${i}`, artist: '', bpm: 124 }));
    const list = shortlist(ranked, rest, () => 0.99, 8);
    expect(list).toHaveLength(8);
    expect(list.slice(0, 6).map((c) => c.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
    expect(new Set(list.map((c) => c.id)).size).toBe(8);
    expect(shortlist(ranked.slice(0, 2), [], Math.random)).toHaveLength(2);
  });
});

describe('song requests in a gig', () => {
  const at = (t: number, o: Partial<RequestInput> = {}): RequestInput => ({ t, energy: 0.6, target: 0.62, remaining: 600, live: true, ...o });
  const song: SongAsk = { trackId: 'b', title: 'Rumble', artist: 'Skrillex', who: 'Bucket hat lad', shout: 'RUMBLE!', sign: 'RUMBLE PLS', ai: true };

  it('asks for a track when the room is on the curve, and is met when the room hears it', () => {
    const r = new Requests('peak', () => 0);
    r.songs = () => song;
    const ask = r.update(at(80), []);
    expect(ask[0].req).toMatchObject({ kind: 'song', text: 'RUMBLE!', song, points: 200 });
    expect(ask[0].req.until).toBe(80 + 180);
    expect(r.update(at(90, { audible: ['a'] }), [])).toEqual([]);
    const met = r.update(at(120, { audible: ['a', 'b'] }), []);
    expect(met[0].what).toBe('met');
  });

  it('still asks about the energy first, and for a moment when there’s no song to ask for', () => {
    const r = new Requests('peak', () => 0);
    r.songs = () => song;
    expect(r.update(at(80, { energy: 0.3, target: 0.7 }), [])[0].req.kind).toBe('lift');
    const r2 = new Requests('peak', () => 0);
    r2.songs = () => null;
    expect(r2.update(at(80), [])[0].req.kind).toBe('blend');
  });
});

describe('the AI connection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAi({ url: '', key: '', model: 'auto' });
  });

  const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  it('keeps only settings that make sense', () => {
    expect(cleanAi({ url: 'ftp://x', key: ' freellmapi-ab cd ', model: '' })).toEqual({ url: '', key: 'freellmapi-abcd', model: 'auto' });
    expect(cleanAi({ url: 'http://192.168.1.5:3001/v1/' }).url).toBe('http://192.168.1.5:3001/v1');
    expect(cleanAi('junk')).toEqual({ url: '', key: '', model: 'auto' });
  });

  it('needs a key', async () => {
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ problem: 'no-key' });
  });

  it('sends the key as a bearer token to the chat endpoint, and finds FreeLLMAPI on either port', async () => {
    setAi({ key: 'freellmapi-' + 'a'.repeat(48) });
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      if (url.startsWith(FREELLMAPI_URLS[0])) throw new TypeError('Failed to fetch');
      return ok('ready');
    });
    expect(await chat([{ role: 'user', content: 'hi' }])).toBe('ready');
    // a FreeLLMAPI key looks on FreeLLMAPI's ports first
    expect(calls.map((c) => c[0])).toEqual([`${FREELLMAPI_URLS[0]}/chat/completions`, `${FREELLMAPI_URLS[1]}/chat/completions`]);
    expect((calls[1][1].headers as Record<string, string>).Authorization).toBe(`Bearer freellmapi-${'a'.repeat(48)}`);
    expect(JSON.parse(calls[1][1].body as string)).toMatchObject({ model: 'auto' });
    // the port that answered is the one used from then on
    await chat([{ role: 'user', content: 'again' }]);
    expect(calls[2][0]).toBe(`${FREELLMAPI_URLS[1]}/chat/completions`);
  });

  const omniKey = 'sk-0123456789abcdef-a1b2c3-0badf00d';

  it('tells OmniRoute keys from FreeLLMAPI keys, and not an OpenAI key', () => {
    expect(keyServer(omniKey)).toBe('OmniRoute');
    expect(keyServer('sk-ab12cd34')).toBe('OmniRoute');
    expect(keyServer('freellmapi-' + 'a'.repeat(48))).toBe('FreeLLMAPI');
    expect(keyServer('sk-proj-' + 'x'.repeat(40))).toBeNull();
    expect(AI_LOCAL_URLS).toEqual([...OMNIROUTE_URLS, ...FREELLMAPI_URLS]);
  });

  it('finds OmniRoute on its port with an OmniRoute key', async () => {
    setAi({ key: omniKey });
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return url.startsWith(OMNIROUTE_URLS[0]) ? ok('ready') : new Response('{}', { status: 401 });
    });
    expect(await chat([{ role: 'user', content: 'hi' }])).toBe('ready');
    expect(calls).toEqual([`${OMNIROUTE_URLS[0]}/chat/completions`]);
  });

  it('keeps looking when a server turns the key down, since it may be the other server’s key', async () => {
    setAi({ key: 'some-other-key' });
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      if (url.startsWith(OMNIROUTE_URLS[0])) return new Response('{}', { status: 401 });
      if (url.startsWith(FREELLMAPI_URLS[0])) throw new TypeError('Failed to fetch');
      return ok('ready');
    });
    expect(await chat([{ role: 'user', content: 'hi' }])).toBe('ready');
    expect(calls).toHaveLength(3);
    // and when nobody takes it, the player hears about the key, not a missing server
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith(OMNIROUTE_URLS[0])) return new Response('{}', { status: 401 });
      throw new TypeError('Failed to fetch');
    });
    setAi({ key: 'some-other-key' });
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ problem: 'key' });
  });

  it('says when OmniRoute has no AI models connected yet', async () => {
    setAi({ key: omniKey, url: 'http://localhost:20128/v1' });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'No active credentials for provider: openai' } }), { status: 401 }));
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ problem: 'no-models' });
  });

  it('says what went wrong', async () => {
    setAi({ key: 'k', url: 'http://example.test/v1' });
    const status = (code: number) => vi.stubGlobal('fetch', async () => new Response('{}', { status: code }));
    status(401);
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ problem: 'key' });
    status(429);
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ problem: 'busy' });
    status(500);
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ problem: 'server' });
    vi.stubGlobal('fetch', async () => ok('  '));
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(AiError);
  });
});

describe('the settings file', () => {
  it('never carries the AI key in or out', () => {
    const entries = parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 1, exported: '', entries: { ai: { key: 'stolen' }, prefs: { crowd: 1 } } }));
    expect(entries).toEqual({ prefs: { crowd: 1 } });
  });
});
