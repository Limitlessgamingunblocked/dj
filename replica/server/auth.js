import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;
export const SESSION_COOKIE = 'replica_session';
export const SESSION_DAYS = 30;

/** Hashes a password as `scrypt$N$r$p$salt$hash` (base64). */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LEN, { ...SCRYPT, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(key, expected);
}

/** A hash that makes failed logins for unknown emails take as long as for real ones. */
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword('replica-dummy-password');
  await verifyPassword(password, dummyHash);
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

/** Only a hash of the session token is stored, so a leaked database can't be used to log in. */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function sessionCookie(token, { secure, maxAgeSeconds }) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns an error message, or null when the sign-up details are acceptable. */
export function validateSignup({ name, email, password }) {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) return 'Please enter your name (up to 80 characters).';
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email.trim())) return 'Please enter a valid email address.';
  if (typeof password !== 'string' || password.length < 8) return 'Your password needs at least 8 characters.';
  if (password.length > 200) return 'That password is too long (200 characters max).';
  return null;
}

/**
 * Sliding-window limiter for login attempts, keyed by IP + email. In memory, so it resets when
 * the server restarts; enough to stop casual password guessing.
 */
export class AttemptLimiter {
  constructor(max = 10, windowMs = 15 * 60 * 1000) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** Records an attempt; returns false when the key is over its limit. */
  allow(key, now = Date.now()) {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10000) {
      for (const [k, times] of this.hits) if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
    }
    return true;
  }

  clear(key) {
    this.hits.delete(key);
  }
}
