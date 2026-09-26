import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import express from 'express';
import {
  AttemptLimiter,
  SESSION_COOKIE,
  SESSION_DAYS,
  burnPasswordCheck,
  hashPassword,
  hashToken,
  newSessionToken,
  parseCookies,
  sessionCookie,
  validateSignup,
  verifyPassword,
} from './auth.js';

const MAX_STL_BYTES = 100 * 1024 * 1024;
const GOALS = new Set(['sell', 'fun']);

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, goal: row.goal ?? null };
}

function publicModel(row) {
  return {
    id: row.id,
    name: row.name,
    widthMm: row.width_mm,
    heightMm: row.height_mm,
    depthMm: row.depth_mm,
    volumeMm3: row.volume_mm3,
    triangles: row.triangles,
    thumbnail: row.thumbnail,
    stlBytes: row.stl_bytes,
    createdAt: row.created_at,
  };
}

/**
 * The JSON API. `secureCookies` should be true whenever the site is served over HTTPS.
 * @param {{ db: import('node:sqlite').DatabaseSync, dataDir: string, secureCookies?: boolean }} options
 */
export function createApi({ db, dataDir, secureCookies = false }) {
  const modelDir = join(dataDir, 'models');
  mkdirSync(modelDir, { recursive: true });
  const limiter = new AttemptLimiter();
  const api = express.Router();

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (email, name, password_hash, goal, created_at) VALUES (?, ?, ?, ?, ?)'),
    setGoal: db.prepare('UPDATE users SET goal = ? WHERE id = ?'),
    setName: db.prepare('UPDATE users SET name = ? WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    sessionUser: db.prepare(
      'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?',
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    listModels: db.prepare('SELECT * FROM models WHERE user_id = ? AND stl_bytes IS NOT NULL ORDER BY created_at DESC'),
    model: db.prepare('SELECT * FROM models WHERE id = ? AND user_id = ?'),
    insertModel: db.prepare(
      'INSERT INTO models (id, user_id, name, width_mm, height_mm, depth_mm, volume_mm3, triangles, thumbnail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    setModelStl: db.prepare('UPDATE models SET stl_bytes = ? WHERE id = ?'),
    deleteModel: db.prepare('DELETE FROM models WHERE id = ?'),
  };

  // Cross-site protection: state-changing requests must come from this site and use a content
  // type that a plain HTML form can't send.
  api.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.get('origin');
    if (origin) {
      let host;
      try {
        host = new URL(origin).host;
      } catch {
        host = '';
      }
      if (host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request blocked.' });
    }
    const type = req.get('content-type') ?? '';
    const hasBody = Number(req.get('content-length') ?? 0) > 0 || req.get('transfer-encoding');
    if (hasBody && !type.startsWith('application/json') && !type.startsWith('application/octet-stream')) {
      return res.status(415).json({ error: 'Unsupported content type.' });
    }
    next();
  });

  api.use(express.json({ limit: '1mb' }));

  // Resolve the signed-in user, if any.
  api.use((req, _res, next) => {
    const token = parseCookies(req.get('cookie'))[SESSION_COOKIE];
    req.sessionHash = token ? hashToken(token) : null;
    req.user = req.sessionHash ? q.sessionUser.get(req.sessionHash, Date.now()) ?? null : null;
    next();
  });

  const requireUser = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in.' });
    next();
  };

  function startSession(res, userId) {
    const token = newSessionToken();
    const now = Date.now();
    const maxAge = SESSION_DAYS * 24 * 3600;
    q.purgeSessions.run(now);
    q.insertSession.run(hashToken(token), userId, now, now + maxAge * 1000);
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: secureCookies, maxAgeSeconds: maxAge }));
  }

  api.post('/auth/signup', async (req, res) => {
    const { name, email, password, goal } = req.body ?? {};
    const problem = validateSignup({ name, email, password });
    if (problem) return res.status(400).json({ error: problem });
    const cleanEmail = email.trim().toLowerCase();
    if (q.userByEmail.get(cleanEmail)) return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
    const hash = await hashPassword(password);
    let info;
    try {
      info = q.insertUser.run(cleanEmail, name.trim(), hash, GOALS.has(goal) ? goal : null, Date.now());
    } catch {
      return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
    }
    const user = q.userById.get(Number(info.lastInsertRowid));
    startSession(res, user.id);
    res.status(201).json({ user: publicUser(user) });
  });

  api.post('/auth/login', async (req, res) => {
    const { email, password, goal } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Enter your email and password.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const key = `${req.ip}|${cleanEmail}`;
    if (!limiter.allow(key)) return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
    const user = q.userByEmail.get(cleanEmail);
    if (!user) {
      await burnPasswordCheck(password);
      return res.status(401).json({ error: 'That email and password don’t match an account.' });
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'That email and password don’t match an account.' });
    }
    limiter.clear(key);
    // The welcome question is asked before logging in; remember the latest answer.
    if (GOALS.has(goal) && goal !== user.goal) q.setGoal.run(goal, user.id);
    startSession(res, user.id);
    res.json({ user: publicUser(q.userById.get(user.id)) });
  });

  api.post('/auth/logout', (req, res) => {
    if (req.sessionHash) q.deleteSession.run(req.sessionHash);
    res.setHeader('Set-Cookie', sessionCookie('', { secure: secureCookies, maxAgeSeconds: 0 }));
    res.json({ ok: true });
  });

  // 200 either way so the app can check for a session without a console error.
  api.get('/auth/me', (req, res) => {
    res.json({ user: req.user ? publicUser(req.user) : null });
  });

  api.patch('/me', requireUser, (req, res) => {
    const { goal, name } = req.body ?? {};
    if (goal !== undefined) {
      if (!GOALS.has(goal)) return res.status(400).json({ error: 'Goal must be "sell" or "fun".' });
      q.setGoal.run(goal, req.user.id);
    }
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) return res.status(400).json({ error: 'Please enter a name (up to 80 characters).' });
      q.setName.run(name.trim(), req.user.id);
    }
    res.json({ user: publicUser(q.userById.get(req.user.id)) });
  });

  api.get('/models', requireUser, (req, res) => {
    res.json({ models: q.listModels.all(req.user.id).map(publicModel) });
  });

  api.post('/models', requireUser, (req, res) => {
    const b = req.body ?? {};
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 100) : '';
    const nums = [b.widthMm, b.heightMm, b.depthMm, b.volumeMm3, b.triangles];
    if (!name) return res.status(400).json({ error: 'Give your model a name.' });
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return res.status(400).json({ error: 'Invalid model details.' });
    const thumbnail = typeof b.thumbnail === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.thumbnail) ? b.thumbnail : null;
    const id = randomUUID();
    q.insertModel.run(id, req.user.id, name, b.widthMm, b.heightMm, b.depthMm, b.volumeMm3, Math.round(b.triangles), thumbnail, Date.now());
    res.status(201).json({ id });
  });

  api.put('/models/:id/stl', requireUser, express.raw({ type: 'application/octet-stream', limit: MAX_STL_BYTES }), async (req, res) => {
    const row = q.model.get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Model not found.' });
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 84) return res.status(400).json({ error: 'That is not an STL file.' });
    const triangles = body.readUInt32LE(80);
    if (body.length !== 84 + triangles * 50) return res.status(400).json({ error: 'That is not a valid binary STL file.' });
    await writeFile(join(modelDir, `${row.id}.stl`), body);
    q.setModelStl.run(body.length, row.id);
    res.json({ model: publicModel(q.model.get(row.id, req.user.id)) });
  });

  api.get('/models/:id/stl', requireUser, async (req, res) => {
    const row = q.model.get(req.params.id, req.user.id);
    if (!row || row.stl_bytes == null) return res.status(404).json({ error: 'Model not found.' });
    const data = await readFile(join(modelDir, `${row.id}.stl`));
    const safe = row.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'model';
    res.setHeader('Content-Type', 'model/stl');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.stl"`);
    res.send(data);
  });

  api.delete('/models/:id', requireUser, async (req, res) => {
    const row = q.model.get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Model not found.' });
    q.deleteModel.run(row.id);
    await rm(join(modelDir, `${row.id}.stl`), { force: true });
    res.json({ ok: true });
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // Body-parser errors (bad JSON, too large) and anything unexpected.
  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    const message = status === 413 ? 'That file is too large.' : status < 500 ? 'Bad request.' : 'Something went wrong on our side.';
    res.status(status).json({ error: message });
  });

  return api;
}
