import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { createApi } from '../server/app.js';
// @ts-expect-error plain JS module
import { hashPassword, verifyPassword, AttemptLimiter } from '../server/auth.js';
// @ts-expect-error plain JS module
import { openDatabase } from '../server/db.js';

let server: Server;
let base: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'replica-test-'));
  const app = express();
  app.use('/api', createApi({ db: openDatabase(':memory:'), dataDir }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** Tiny cookie-keeping client. */
function client() {
  let cookie = '';
  return async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (cookie) headers.cookie = cookie;
    let body = init.body;
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    const res = await fetch(base + path, { ...init, headers, body });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, setCookie: set };
  };
}

function tinyStl(): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(84 + 50);
  new DataView(buf.buffer).setUint32(80, 1, true);
  return buf;
}

describe('passwords', () => {
  it('hashes with a salt and verifies', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
  });

  it('rate limits repeated attempts', () => {
    const lim = new AttemptLimiter(3, 1000);
    expect([lim.allow('k', 0), lim.allow('k', 1), lim.allow('k', 2), lim.allow('k', 3)]).toEqual([true, true, true, false]);
    expect(lim.allow('k', 2000)).toBe(true);
  });
});

describe('accounts', () => {
  it('creates an account, stays signed in, logs out and logs back in', async () => {
    const c = client();
    const signup = await c('/auth/signup', { method: 'POST', json: { name: 'Sam', email: 'Sam@Example.com', password: 'hunter2hunter2', goal: 'sell' } });
    expect(signup.status).toBe(201);
    expect(signup.data.user).toMatchObject({ name: 'Sam', email: 'sam@example.com', goal: 'sell' });
    expect(signup.setCookie).toMatch(/HttpOnly/);
    expect(signup.setCookie).toMatch(/SameSite=Lax/);
    expect(JSON.stringify(signup.data)).not.toMatch(/password|hash/i);

    expect((await c('/auth/me')).data.user.email).toBe('sam@example.com');
    expect((await c('/auth/logout', { method: 'POST' })).status).toBe(200);
    expect((await c('/auth/me')).data.user).toBeNull();

    const bad = await c('/auth/login', { method: 'POST', json: { email: 'sam@example.com', password: 'nope-nope' } });
    expect(bad.status).toBe(401);
    const good = await c('/auth/login', { method: 'POST', json: { email: 'SAM@example.com', password: 'hunter2hunter2', goal: 'fun' } });
    expect(good.status).toBe(200);
    expect(good.data.user.goal).toBe('fun');
  });

  it('rejects duplicates, weak passwords and bad emails', async () => {
    const c = client();
    await c('/auth/signup', { method: 'POST', json: { name: 'A', email: 'dup@example.com', password: 'longenough' } });
    expect((await c('/auth/signup', { method: 'POST', json: { name: 'B', email: 'DUP@example.com', password: 'longenough' } })).status).toBe(409);
    expect((await c('/auth/signup', { method: 'POST', json: { name: 'B', email: 'b@example.com', password: 'short' } })).status).toBe(400);
    expect((await c('/auth/signup', { method: 'POST', json: { name: 'B', email: 'not-an-email', password: 'longenough' } })).status).toBe(400);
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const c = client();
    const unknown = await c('/auth/login', { method: 'POST', json: { email: 'ghost@example.com', password: 'whatever1' } });
    expect(unknown.status).toBe(401);
    expect(unknown.data.error).toMatch(/don’t match/);
  });

  it('blocks cross-site and form posts', async () => {
    const c = client();
    const cross = await c('/auth/signup', {
      method: 'POST',
      json: { name: 'X', email: 'x@example.com', password: 'longenough' },
      headers: { origin: 'https://evil.example' },
    });
    expect(cross.status).toBe(403);
    const form = await c('/auth/login', {
      method: 'POST',
      body: 'email=a&password=b',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(form.status).toBe(415);
  });

  it('updates the sell / fun goal', async () => {
    const c = client();
    await c('/auth/signup', { method: 'POST', json: { name: 'G', email: 'goal@example.com', password: 'longenough' } });
    expect((await c('/me', { method: 'PATCH', json: { goal: 'sell' } })).data.user.goal).toBe('sell');
    expect((await c('/me', { method: 'PATCH', json: { goal: 'profit' } })).status).toBe(400);
  });
});

describe('saved models', () => {
  it('saves, lists, downloads and deletes, and keeps them private', async () => {
    const owner = client();
    const other = client();
    await owner('/auth/signup', { method: 'POST', json: { name: 'O', email: 'owner@example.com', password: 'longenough' } });
    await other('/auth/signup', { method: 'POST', json: { name: 'P', email: 'other@example.com', password: 'longenough' } });

    const created = await owner('/models', {
      method: 'POST',
      json: { name: 'Vase', widthMm: 60, heightMm: 120, depthMm: 60, volumeMm3: 150000, triangles: 1, thumbnail: 'data:image/jpeg;base64,AAAA' },
    });
    expect(created.status).toBe(201);
    const id = created.data.id;

    // Not listed until the STL arrives.
    expect((await owner('/models')).data.models).toHaveLength(0);
    const bad = await owner(`/models/${id}/stl`, { method: 'PUT', body: new Uint8Array(90), headers: { 'content-type': 'application/octet-stream' } });
    expect(bad.status).toBe(400);
    const up = await owner(`/models/${id}/stl`, { method: 'PUT', body: tinyStl(), headers: { 'content-type': 'application/octet-stream' } });
    expect(up.status).toBe(200);

    const list = (await owner('/models')).data.models;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Vase', heightMm: 120, stlBytes: 134 });

    const dl = await owner(`/models/${id}/stl`);
    expect(dl.status).toBe(200);
    expect((dl.data as ArrayBuffer).byteLength).toBe(134);

    expect((await other(`/models/${id}/stl`)).status).toBe(404);
    expect((await other(`/models/${id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await other('/models')).data.models).toHaveLength(0);

    expect((await owner(`/models/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await owner('/models')).data.models).toHaveLength(0);
  });

  it('requires signing in', async () => {
    const anon = client();
    expect((await anon('/models')).status).toBe(401);
  });
});
