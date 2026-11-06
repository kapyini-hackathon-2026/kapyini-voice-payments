import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

// A tiny fake of the Upstash REST API: enough commands to check our Redis store.
function fakeUpstash() {
  const db = new Map();
  return async (_url, opts) => {
    const [cmd, ...a] = JSON.parse(opts.body);
    const ok = (result) => ({ ok: true, json: async () => ({ result }) });
    switch (cmd) {
      case 'SET': db.set(a[0], a[1]); return ok('OK');
      case 'GET': return ok(db.get(a[0]) ?? null);
      case 'GETDEL': { const v = db.get(a[0]) ?? null; db.delete(a[0]); return ok(v); }
      case 'LPUSH': db.set(a[0], [a[1], ...(db.get(a[0]) || [])]); return ok(1);
      case 'LTRIM': return ok('OK');
      case 'LRANGE': return ok((db.get(a[0]) || []).slice(a[1], a[2] + 1));
      case 'MGET': return ok(a.map((k) => db.get(k) ?? null));
      default: return { ok: false, json: async () => ({ error: `unknown ${cmd}` }) };
    }
  };
}

// The same fake, seen as a classic Redis client (sendCommand), for REDIS_URL.
function fakeTcpClient() {
  const rest = fakeUpstash();
  return { sendCommand: async (args) => (await (await rest('', { body: JSON.stringify(args) })).json()).result };
}

for (const [name, kind, make] of [
  ['memory', 'memory', () => createStore()],
  ['redis REST (Upstash)', 'redis', () => createStore({ redis: { url: 'https://x', token: 't' }, fetchImpl: fakeUpstash() })],
  ['redis TCP (REDIS_URL)', 'redis', () => createStore({ redisClient: fakeTcpClient() })],
]) {
  test(`${name} store: prepared requests are single use; journal and key-value work`, async () => {
    const s = make();
    assert.equal(s.kind, kind);
    const id = await s.prepare({ contactId: 'a', amount: '10.00' });
    await s.markPrepared(id, { challenge: 'c1' });
    assert.equal((await s.peekPrepared(id)).challenge, 'c1');
    assert.equal((await s.takePrepared(id)).amount, '10.00');
    assert.equal(await s.takePrepared(id), null, 'a second use finds nothing');
    const op = await s.createOperation({ kind: 'send', state: 'awaiting_approval' });
    await s.update(op.id, { state: 'completed' });
    assert.equal((await s.get(op.id)).state, 'completed');
    assert.equal((await s.list()).length, 1);
    await s.kvSet('passkeys', [{ id: 'k' }]);
    assert.deepEqual(await s.kvGet('passkeys'), [{ id: 'k' }]);
  });
}
