// Rivium user token: header, refresh + retry, shared provider call, legacy userId.
// Runs against the compiled build: `npm test` builds first.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RiviumStorage, RiviumStorageException } = require('../dist/index.js');

const API_KEY = 'rv_live_test';
const originalFetch = globalThis.fetch;
let calls;
let responses;

function jwt(expSecondsFromNow) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `${b64({ alg: 'ES256' })}.${b64({ sub: 'user-1', exp })}.sig`;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  calls = [];
  responses = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: { ...(init.headers || {}) }, init });
    return responses.length ? responses.shift() : json(200, []);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('sends x-user-token from tokenProvider and no x-user-id', async () => {
  const token = jwt(3600);
  const storage = new RiviumStorage({ apiKey: API_KEY, userId: 'legacy', tokenProvider: () => token });

  await storage.listBuckets();

  assert.equal(calls[0].headers['x-user-token'], token);
  assert.equal(calls[0].headers['x-api-key'], API_KEY);
  assert.equal(calls[0].headers['x-user-id'], undefined);
});

test('legacy userId path is unchanged: x-user-id, no token header', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userId: 'user-42' });

  await storage.listBuckets();

  assert.equal(calls[0].headers['x-user-id'], 'user-42');
  assert.equal(calls[0].headers['x-user-token'], undefined);
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
});

test('provider returning null falls back to legacy userId', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userId: 'user-42', tokenProvider: () => null });

  await storage.listBuckets();

  assert.equal(calls[0].headers['x-user-id'], 'user-42');
  assert.equal(calls[0].headers['x-user-token'], undefined);
});

test('token is cached across requests', async () => {
  let asked = 0;
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => { asked++; return jwt(3600); } });

  await storage.listBuckets();
  await storage.listBuckets();

  assert.equal(asked, 1);
});

for (const code of ['token_expired', 'token_invalid']) {
  test(`401 ${code}: asks the provider again and retries once`, async () => {
    const tokens = [jwt(3600), jwt(7200)];
    let asked = 0;
    const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: async () => tokens[asked++] });
    responses = [json(401, { code, message: 'nope' }), json(200, [{ id: 'b1' }])];

    const buckets = await storage.listBuckets();

    assert.deepEqual(buckets, [{ id: 'b1' }]);
    assert.equal(asked, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers['x-user-token'], tokens[0]);
    assert.equal(calls[1].headers['x-user-token'], tokens[1]);
  });
}

test('retries only once: a second token_expired surfaces as an error', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => jwt(3600) });
  responses = [json(401, { code: 'token_expired' }), json(401, { code: 'token_expired', message: 'expired' })];

  await assert.rejects(storage.listBuckets(), (e) => {
    assert.ok(e instanceof RiviumStorageException);
    assert.equal(e.statusCode, 401);
    assert.equal(e.code, 'token_expired');
    return true;
  });
  assert.equal(calls.length, 2);
});

test('concurrent requests share one in-flight provider call', async () => {
  let asked = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const storage = new RiviumStorage({
    apiKey: API_KEY,
    tokenProvider: async () => { asked++; await gate; return jwt(3600); },
  });

  const all = Promise.all([storage.listBuckets(), storage.getBucket('a'), storage.getFile('f')]);
  release();
  await all;

  assert.equal(asked, 1);
  assert.equal(calls.length, 3);
});

test('token_required without tokenProvider tells the developer to configure it', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userId: 'user-42' });
  responses = [json(401, { code: 'token_required', message: 'A user token is required' })];

  await assert.rejects(storage.listBuckets(), (e) => {
    assert.equal(e.code, 'token_required');
    assert.match(e.message, /tokenProvider/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test('token is replaced shortly before it expires', async () => {
  let asked = 0;
  const storage = new RiviumStorage({
    apiKey: API_KEY,
    tokenProvider: () => (asked++ === 0 ? jwt(30) : jwt(3600)),
  });

  await storage.listBuckets();
  await storage.listBuckets();

  assert.equal(asked, 2);
});

test('setUserToken without a provider sends that token; null clears it', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userId: 'user-42' });
  const token = jwt(3600);

  await storage.setUserToken(token);
  await storage.listBuckets();
  await storage.setUserToken(null);
  await storage.listBuckets();

  assert.equal(calls[0].headers['x-user-token'], token);
  assert.equal(calls[0].headers['x-user-id'], undefined);
  assert.equal(calls[1].headers['x-user-token'], undefined);
  assert.equal(calls[1].headers['x-user-id'], 'user-42');
});

test('refreshUserToken asks the provider again', async () => {
  let asked = 0;
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => { asked++; return jwt(3600); } });

  await storage.listBuckets();
  await storage.refreshUserToken();
  await storage.listBuckets();

  assert.equal(asked, 2);
});

test('upload and download send the token too', async () => {
  const token = jwt(3600);
  const storage = new RiviumStorage({ apiKey: API_KEY, userId: 'legacy', tokenProvider: () => token });
  responses = [json(200, { id: 'f1' }), new Response(new Uint8Array([1, 2, 3]), { status: 200 })];

  await storage.upload('bucket', 'a.txt', 'hello');
  await storage.download('f1');

  for (const call of calls) {
    assert.equal(call.headers['x-user-token'], token);
    assert.equal(call.headers['x-user-id'], undefined);
    assert.equal(call.headers['Content-Type'], undefined);
  }
});

test('URL helpers are unchanged', () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => jwt(3600) });
  assert.equal(storage.getDownloadUrl('f1'), 'https://storage.rivium.co/api/v1/files/f1/download');
  assert.equal(storage.getTransformUrl('f1', { width: 200 }), 'https://storage.rivium.co/api/v1/transform/f1?w=200');
});
