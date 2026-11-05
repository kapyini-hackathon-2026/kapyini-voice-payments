// Where Kapyiŋi keeps its short-lived state: prepared requests (5 min), the journal of
// operations, and the passkeys registered for the demo user.
//
// Two back-ends, same async interface:
//   - memory (+ a JSON file): for `npm start` on one machine.
//   - Upstash Redis over REST: for Vercel, where every request may run in a different
//     short-lived function and memory is not shared. Set UPSTASH_REDIS_REST_URL and _TOKEN.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const PREPARED_TTL_MS = 5 * 60 * 1000;

export function createStore({ file, redis, fetchImpl = fetch } = {}) {
  return redis?.url && redis?.token ? redisStore({ ...redis, fetchImpl }) : memoryStore({ file });
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
    async list() {
      return [...operations.values()].sort((a, b) => b.createdAt - a.createdAt);
    },
    async kvGet(key) {
      return kv.has(key) ? structuredClone(kv.get(key)) : null;
    },
    async kvSet(key, value) {
      kv.set(key, value);
      persist();
    },
  };
}

function redisStore({ url, token, prefix = 'kapyini:', fetchImpl }) {
  async function cmd(...args) {
    const res = await fetchImpl(url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(`Redis error: ${data.error || res.status}`);
    return data.result;
  }
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
      await cmd('LPUSH', `${prefix}ops`, op.id);
      await cmd('LTRIM', `${prefix}ops`, 0, 199);
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
    async list() {
      const ids = await cmd('LRANGE', `${prefix}ops`, 0, 49);
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
  };
}
