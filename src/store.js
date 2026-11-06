// Where Kapyiŋi keeps its state: prepared requests (5 min), the journal of operations, and a
// small key-value space (accounts, sessions, each user's contacts and passkeys).
// `store.forUser(id)` gives the same interface limited to one user's space.
//
// Two back-ends, same async interface:
//   - memory (+ a JSON file): for `npm start` on one machine.
//   - Redis, for Vercel, where every request may run in a different short-lived function and
//     memory is not shared. Either a classic Redis address (REDIS_URL, e.g. the "Redis" integration
//     of Vercel's Storage tab) or Upstash over REST (UPSTASH_REDIS_REST_URL and _TOKEN).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const PREPARED_TTL_MS = 5 * 60 * 1000;

export function createStore({ file, redis, redisUrl, redisClient, fetchImpl = fetch } = {}) {
  let base;
  if (redis?.url && redis?.token) base = redisStore({ cmd: restCommand({ ...redis, fetchImpl }) });
  else if (redisUrl || redisClient) base = redisStore({ cmd: tcpCommand({ url: redisUrl, client: redisClient }) });
  else base = memoryStore({ file });
  base.forUser = (userId) => scoped(base, userId);
  return base;
}

// One user's space: their prepared requests, their journal, their keys. Anything that belongs
// to another user is simply not found.
function scoped(base, userId) {
  if (!userId) throw new Error('forUser needs a user id');
  const mine = (x) => (x && x.userId === userId ? x : null);
  const key = (k) => `u:${userId}:${k}`;
  return {
    kind: base.kind,
    userId,
    prepare: (request) => base.prepare({ ...request, userId }),
    peekPrepared: async (id) => mine(await base.peekPrepared(id)),
    async markPrepared(id, fields) {
      if (mine(await base.peekPrepared(id))) await base.markPrepared(id, fields);
    },
    takePrepared: async (id) => (mine(await base.peekPrepared(id)) ? base.takePrepared(id) : null),
    createOperation: (fields) => base.createOperation({ ...fields, userId }),
    update: async (id, fields) => (mine(await base.get(id)) ? base.update(id, fields) : null),
    get: async (id) => mine(await base.get(id)),
    list: () => base.list(userId),
    kvGet: (k) => base.kvGet(key(k)),
    kvSet: (k, v) => base.kvSet(key(k), v),
    kvDel: (k) => base.kvDel(key(k)),
  };
}

// Upstash REST: each command is one HTTPS request.
function restCommand({ url, token, fetchImpl }) {
  return async (...args) => {
    const res = await fetchImpl(url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(`Redis error: ${data.error || res.status}`);
    return data.result;
  };
}

// Classic Redis (redis:// or rediss://): one connection, opened on first use and reused
// while the function stays warm.
function tcpCommand({ url, client }) {
  let ready;
  const connect = async () => {
    if (client) return client;
    const { createClient } = await import('redis');
    const c = createClient({ url, socket: { connectTimeout: 5000 } });
    c.on('error', (err) => console.error('Redis connection error:', err.message));
    await c.connect();
    return c;
  };
  return async (...args) => {
    ready ||= connect().catch((err) => { ready = null; throw err; });
    const c = await ready;
    return c.sendCommand(args.map(String));
  };
}

function memoryStore({ file } = {}) {
  const operations = new Map();
  const prepared = new Map();
  const kv = new Map();
  if (file) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      // Older journals were a plain array of operations.
      for (const op of Array.isArray(saved) ? saved : saved.operations || []) operations.set(op.id, op);
      for (const [k, v] of Object.entries(Array.isArray(saved) ? {} : saved.kv || {})) kv.set(k, v);
    } catch { /* no journal yet */ }
  }
  function persist() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ operations: [...operations.values()], kv: Object.fromEntries(kv) }, null, 2));
  }
  const fresh = (p) => p && Date.now() - p.createdAt <= PREPARED_TTL_MS;

  return {
    kind: 'memory',
    async prepare(request) {
      const id = randomUUID();
      prepared.set(id, { ...request, id, createdAt: Date.now() });
      return id;
    },
    async peekPrepared(id) {
      const p = prepared.get(id);
      return fresh(p) ? p : null;
    },
    async markPrepared(id, fields) {
      const p = prepared.get(id);
      if (fresh(p)) Object.assign(p, fields);
    },
    // Used once: a second confirmation of the same request finds nothing.
    async takePrepared(id) {
      const p = prepared.get(id);
      prepared.delete(id);
      return fresh(p) ? p : null;
    },
    async createOperation(fields) {
      const op = { id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now(), ...fields };
      operations.set(op.id, op);
      persist();
      return op;
    },
    async update(id, fields) {
      const op = operations.get(id);
      if (!op) return null;
      Object.assign(op, fields, { updatedAt: Date.now() });
      persist();
      return op;
    },
    async get(id) {
      return operations.get(id) ?? null;
    },
    // With a user id: that user's operations only.
    async list(userId) {
      return [...operations.values()].filter((op) => !userId || op.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
    },
    async kvGet(key) {
      return kv.has(key) ? structuredClone(kv.get(key)) : null;
    },
    async kvSet(key, value) {
      kv.set(key, value);
      persist();
    },
    async kvDel(key) {
      kv.delete(key);
      persist();
    },
  };
}

function redisStore({ cmd, prefix = 'kapyini:' }) {
  const getJson = async (key) => {
    const v = await cmd('GET', prefix + key);
    return v ? JSON.parse(v) : null;
  };
  const ttl = Math.ceil(PREPARED_TTL_MS / 1000);

  return {
    kind: 'redis',
    async prepare(request) {
      const id = randomUUID();
      await cmd('SET', `${prefix}prep:${id}`, JSON.stringify({ ...request, id, createdAt: Date.now() }), 'EX', ttl);
      return id;
    },
    async peekPrepared(id) {
      return getJson(`prep:${id}`);
    },
    async markPrepared(id, fields) {
      const p = await getJson(`prep:${id}`);
      if (p) await cmd('SET', `${prefix}prep:${id}`, JSON.stringify({ ...p, ...fields }), 'KEEPTTL');
    },
    async takePrepared(id) {
      const v = await cmd('GETDEL', `${prefix}prep:${id}`);
      return v ? JSON.parse(v) : null;
    },
    async createOperation(fields) {
      const op = { id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now(), ...fields };
      await cmd('SET', `${prefix}op:${op.id}`, JSON.stringify(op));
      const list = op.userId ? `${prefix}ops:${op.userId}` : `${prefix}ops`;
      await cmd('LPUSH', list, op.id);
      await cmd('LTRIM', list, 0, 199);
      return op;
    },
    async update(id, fields) {
      const op = await getJson(`op:${id}`);
      if (!op) return null;
      Object.assign(op, fields, { updatedAt: Date.now() });
      await cmd('SET', `${prefix}op:${id}`, JSON.stringify(op));
      return op;
    },
    async get(id) {
      return getJson(`op:${id}`);
    },
    async list(userId) {
      const ids = await cmd('LRANGE', userId ? `${prefix}ops:${userId}` : `${prefix}ops`, 0, 49);
      if (!ids?.length) return [];
      const rows = await cmd('MGET', ...ids.map((i) => `${prefix}op:${i}`));
      return rows.filter(Boolean).map((r) => JSON.parse(r));
    },
    async kvGet(key) {
      return getJson(`kv:${key}`);
    },
    async kvSet(key, value) {
      await cmd('SET', `${prefix}kv:${key}`, JSON.stringify(value));
    },
    async kvDel(key) {
      await cmd('DEL', `${prefix}kv:${key}`);
    },
  };
}
