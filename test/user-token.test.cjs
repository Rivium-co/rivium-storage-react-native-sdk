// Rivium user token: header, refresh + retry, shared provider call, and the
// wait for a signed-in user (isAwaitingUserToken / onAwaitingUserToken /
// userTokenWaitTimeout). File requests never go out without a token.
// Runs against the compiled build: `npm test` builds first.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RiviumStorage, RiviumStorageException, StorageErrorCode } = require('../dist/index.js');

const API_KEY = 'rv_live_test';
const originalFetch = globalThis.fetch;
const originalXhr = globalThis.XMLHttpRequest;
let calls;
let responses;

function jwt(expSecondsFromNow, sub = 'user-1') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `${b64({ alg: 'ES256' })}.${b64({ sub, exp })}.sig`;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Lets pending promise callbacks and timers of 0 ms run. */
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  calls = [];
  responses = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: { ...(init.headers || {}) }, init });
    return responses.length ? responses.shift() : json(200, { files: [], nextCursor: null });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalXhr;
});

// ---- token header, refresh, retry -----------------------------------------

test('sends x-user-token from tokenProvider, never x-user-id', async () => {
  const token = jwt(3600);
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => token });

  await storage.listFiles('b1');
  await storage.listBuckets();

  for (const call of calls) {
    assert.equal(call.headers['x-user-token'], token);
    assert.equal(call.headers['x-api-key'], API_KEY);
    assert.equal(call.headers['x-user-id'], undefined);
  }
});

test('the legacy user id is gone: no userId option, setUserId or userId getter', () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userId: 'user-42' });
  assert.equal(typeof storage.setUserId, 'undefined');
  assert.equal('userId' in storage, false);
});

test('x-user-id is never sent, whatever the config', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userId: 'user-42', userToken: jwt(3600) });
  responses = [json(200, []), json(200, { files: [] }), json(200, { id: 'f1' }), new Response(new Uint8Array([1]), { status: 200 })];

  await storage.listBuckets();
  await storage.listFiles('b1');
  await storage.upload('b1', 'a.txt', 'hi');
  await storage.download('f1');

  assert.equal(calls.length, 4);
  for (const call of calls) assert.equal(call.headers['x-user-id'], undefined);
});

test('token is cached across requests', async () => {
  let asked = 0;
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => { asked++; return jwt(3600); } });

  await storage.listFiles('b1');
  await storage.listFiles('b1');

  assert.equal(asked, 1);
});

for (const code of ['token_expired', 'token_invalid']) {
  test(`401 ${code}: asks the provider again and retries once`, async () => {
    const tokens = [jwt(3600), jwt(7200)];
    let asked = 0;
    const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: async () => tokens[asked++] });
    responses = [json(401, { code, message: 'nope' }), json(200, { id: 'f1' })];

    const file = await storage.getFile('f1');

    assert.deepEqual(file, { id: 'f1' });
    assert.equal(asked, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers['x-user-token'], tokens[0]);
    assert.equal(calls[1].headers['x-user-token'], tokens[1]);
  });
}

test('retries only once: a second token_expired surfaces as an error', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => jwt(3600) });
  responses = [json(401, { code: 'token_expired' }), json(401, { code: 'token_expired', message: 'expired' })];

  await assert.rejects(storage.getFile('f1'), (e) => {
    assert.ok(e instanceof RiviumStorageException);
    assert.equal(e.statusCode, 401);
    assert.equal(e.code, 'token_expired');
    return true;
  });
  assert.equal(calls.length, 2);
});

test('token_expired, then the provider returns null: the call waits for sign-in', async () => {
  const old = jwt(3600, 'old');
  let current = null;
  let asked = 0;
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => (asked++ === 0 ? old : current) });
  responses = [json(401, { code: 'token_expired' }), json(200, { id: 'f1' })];

  const pending = storage.getFile('f1');
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['x-user-token'], old);
  assert.equal(storage.isAwaitingUserToken, true);

  current = jwt(3600, 'new');
  await storage.refreshUserToken();
  assert.deepEqual(await pending, { id: 'f1' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['x-user-token'], current);
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

test('token is replaced shortly before it expires', async () => {
  let asked = 0;
  const storage = new RiviumStorage({
    apiKey: API_KEY,
    tokenProvider: () => (asked++ === 0 ? jwt(30) : jwt(3600)),
  });

  await storage.listFiles('b1');
  await storage.listFiles('b1');

  assert.equal(asked, 2);
});

test('setUserToken without a provider sends that token', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY });
  const token = jwt(3600);

  await storage.setUserToken(token);
  await storage.listFiles('b1');

  assert.equal(calls[0].headers['x-user-token'], token);
});

test('refreshUserToken asks the provider again', async () => {
  let asked = 0;
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => { asked++; return jwt(3600); } });

  await storage.listFiles('b1');
  await storage.refreshUserToken();
  await storage.listFiles('b1');

  assert.equal(asked, 2);
});

test('upload and download send the token too', async () => {
  const token = jwt(3600);
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => token });
  responses = [json(200, { id: 'f1' }), new Response(new Uint8Array([1, 2, 3]), { status: 200 })];

  await storage.upload('bucket', 'a.txt', 'hello');
  await storage.download('f1');

  for (const call of calls) {
    assert.equal(call.headers['x-user-token'], token);
    assert.equal(call.headers['Content-Type'], undefined);
  }
});

test('URL helpers are unchanged', () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => jwt(3600) });
  assert.equal(storage.getDownloadUrl('f1'), 'https://storage.rivium.co/api/v1/files/f1/download');
  assert.equal(storage.getTransformUrl('f1', { width: 200 }), 'https://storage.rivium.co/api/v1/transform/f1?w=200');
});

// ---- waiting for a user token ---------------------------------------------

test('no token: the call waits (nothing sent), setUserToken releases it', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY });
  assert.equal(storage.isAwaitingUserToken, false);

  const pending = storage.listFiles('b1');
  await tick();
  assert.equal(calls.length, 0, 'nothing is sent while waiting');
  assert.equal(storage.isAwaitingUserToken, true);

  const token = jwt(3600);
  await storage.setUserToken(token);
  const page = await pending;

  assert.deepEqual(page, { files: [], nextCursor: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['x-user-token'], token);
  assert.equal(storage.isAwaitingUserToken, false);
});

test('provider returns null, then refreshUserToken after sign-in releases the call', async () => {
  let token = null;
  let asked = 0;
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => { asked++; return token; } });

  const pending = storage.getFile('f1');
  await tick();
  assert.equal(calls.length, 0);
  assert.equal(storage.isAwaitingUserToken, true);

  token = jwt(3600);
  responses = [json(200, { id: 'f1' })];
  await storage.refreshUserToken();

  assert.deepEqual(await pending, { id: 'f1' });
  assert.equal(calls[0].headers['x-user-token'], token);
  assert.equal(asked, 2);
  assert.equal(storage.isAwaitingUserToken, false);
});

test('a provider that throws counts as no token: the call waits', async () => {
  let fail = true;
  const storage = new RiviumStorage({
    apiKey: API_KEY,
    tokenProvider: () => { if (fail) throw new Error('offline'); return jwt(3600); },
  });
  const origError = console.error;
  console.error = () => {};
  try {
    const pending = storage.listFiles('b1');
    await tick();
    assert.equal(storage.isAwaitingUserToken, true);
    fail = false;
    await storage.refreshUserToken();
    await pending;
  } finally {
    console.error = origError;
  }
  assert.equal(calls.length, 1);
});

test('every file call waits; the bucket calls and getPublicUrl do not', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY });
  responses = [json(200, [{ id: 'b1' }]), json(200, { id: 'b1' }), json(200, { id: 'b1' }), json(200, { url: 'https://x/y' })];

  assert.deepEqual(await storage.listBuckets(), [{ id: 'b1' }]);
  await storage.getBucket('b1');
  await storage.getBucketByName('photos');
  assert.equal(await storage.getPublicUrl('f1'), 'https://x/y');
  assert.equal(calls.length, 4);
  for (const call of calls) assert.equal(call.headers['x-user-token'], undefined);
  assert.equal(storage.isAwaitingUserToken, false);

  const waiting = [
    storage.upload('b1', 'a.txt', 'hi'),
    storage.listFiles('b1'),
    storage.getFile('f1'),
    storage.getFileByPath('b1', 'a.txt'),
    storage.download('f1'),
    storage.delete('f1'),
    storage.deleteByPath('b1', 'a.txt'),
    storage.deleteMany(['f1']),
  ];
  await tick();
  assert.equal(calls.length, 4, 'no file call was sent');
  assert.equal(storage.isAwaitingUserToken, true);

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: { ...(init.headers || {}) }, init });
    if (String(url).endsWith('/download')) return new Response(new Uint8Array([1]), { status: 200 });
    return json(200, { id: 'f1', deleted: 1, files: [] });
  };
  await storage.setUserToken(jwt(3600));
  await Promise.all(waiting);
  assert.equal(calls.length, 12);
  // released in the order the calls were made
  assert.deepEqual(
    calls.slice(4).map((c) => `${c.init.method ?? 'GET'} ${new URL(c.url).pathname}`),
    [
      'POST /api/v1/buckets/b1/files',
      'GET /api/v1/buckets/b1/files',
      'GET /api/v1/files/f1',
      'GET /api/v1/buckets/b1/files/a.txt',
      'GET /api/v1/files/f1/download',
      'DELETE /api/v1/files/f1',
      'DELETE /api/v1/buckets/b1/files/a.txt',
      'POST /api/v1/files/delete-many',
    ],
  );
});

test('onAwaitingUserToken fires once per waiting period; unsubscribe stops it', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY });
  let fired = 0;
  const unsubscribe = storage.onAwaitingUserToken(() => fired++);

  const a = storage.listFiles('b1');
  const b = storage.getFile('f1');
  await tick();
  assert.equal(fired, 1, 'two waiting calls, one event');

  responses = [json(200, { files: [] }), json(200, { id: 'f1' })];
  await storage.setUserToken(jwt(3600));
  await Promise.all([a, b]);

  await storage.setUserToken(null); // signed out
  const c = storage.listFiles('b1');
  await tick();
  assert.equal(fired, 2, 'a new waiting period');

  unsubscribe();
  await storage.setUserToken(jwt(3600));
  await c;
  await storage.setUserToken(null);
  const d = storage.listFiles('b1');
  await tick();
  assert.equal(fired, 2, 'no event after unsubscribe');
  await storage.setUserToken(jwt(3600));
  await d;
});

test('a throwing awaiting callback does not break the call', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY });
  storage.onAwaitingUserToken(() => { throw new Error('ui'); });
  const origError = console.error;
  console.error = () => {};
  try {
    const pending = storage.listFiles('b1');
    await tick();
    await storage.setUserToken(jwt(3600));
    await pending;
  } finally {
    console.error = origError;
  }
});

test('setUserToken(null) keeps waiting calls waiting', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => null });
  const pending = storage.listFiles('b1');
  await tick();
  await storage.setUserToken(null);
  await tick();
  assert.equal(calls.length, 0);
  assert.equal(storage.isAwaitingUserToken, true);

  await storage.setUserToken(jwt(3600));
  await pending;
  assert.equal(calls.length, 1);
});

test('userTokenWaitTimeout: the call fails with token_required (401) when it passes', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userTokenWaitTimeout: 20 });
  const started = Date.now();

  await assert.rejects(storage.listFiles('b1'), (e) => {
    assert.ok(e instanceof RiviumStorageException);
    assert.equal(e.statusCode, 401);
    assert.equal(e.code, StorageErrorCode.TokenRequired);
    assert.equal(e.code, 'token_required');
    return true;
  });
  assert.ok(Date.now() - started >= 15);
  assert.equal(calls.length, 0);
  assert.equal(storage.isAwaitingUserToken, false);
});

test('userTokenWaitTimeout: a token in time wins', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userTokenWaitTimeout: 200 });
  const pending = storage.listFiles('b1');
  await tick();
  await storage.setUserToken(jwt(3600));
  await pending;
  await new Promise((r) => setTimeout(r, 220)); // the timer was cleared: no late rejection
  assert.equal(calls.length, 1);
});

test('the request timeout does not run while waiting for a token', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, timeout: 10 });
  const pending = storage.listFiles('b1');
  await new Promise((r) => setTimeout(r, 40));
  await storage.setUserToken(jwt(3600));
  assert.deepEqual(await pending, { files: [], nextCursor: null });
});

test('401 token_required puts the call back to waiting, then it goes on with the new token', async () => {
  const first = jwt(3600, 'a');
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => first });
  responses = [json(401, { code: 'token_required', message: 'A user token is required' })];
  let fired = 0;
  storage.onAwaitingUserToken(() => fired++);

  const pending = storage.getFile('f1');
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(storage.isAwaitingUserToken, true);
  assert.equal(fired, 1);

  const second = jwt(3600, 'b');
  responses = [json(200, { id: 'f1' })];
  await storage.setUserToken(second);

  assert.deepEqual(await pending, { id: 'f1' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['x-user-token'], second);
});

test('401 token_required on a bucket call is an error (bucket calls never wait)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY });
  responses = [json(401, { code: 'token_required', message: 'A user token is required' })];

  await assert.rejects(storage.listBuckets(), (e) => e.code === 'token_required');
  assert.equal(storage.isAwaitingUserToken, false);
});

// ---- the XMLHttpRequest upload path (onProgress) waits too -----------------

class FakeXHR {
  constructor() {
    this.upload = {};
    this.headers = {};
    FakeXHR.instances.push(this);
  }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
  abort() { this.onabort?.(); }
  send() {
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
      this.upload.onload?.({ lengthComputable: true, loaded: 100, total: 100 });
      this.status = 201;
      this.statusText = 'Created';
      const text = JSON.stringify({ id: 'f1' });
      this.responseText = text;
      this.response = new TextEncoder().encode(text).buffer;
      this.onload?.();
    }, 0);
  }
}

test('upload with onProgress (XMLHttpRequest) waits too: no request, no progress until sign-in', async () => {
  FakeXHR.instances = [];
  globalThis.XMLHttpRequest = FakeXHR;
  const storage = new RiviumStorage({ apiKey: API_KEY });
  const events = [];

  const pending = storage.upload('b1', 'a.txt', 'hello', { onProgress: (p) => events.push(p) });
  await tick();
  assert.equal(FakeXHR.instances.length, 0, 'no XMLHttpRequest while waiting');
  assert.equal(events.length, 0, 'no progress while waiting');
  assert.equal(storage.isAwaitingUserToken, true);

  const token = jwt(3600);
  await storage.setUserToken(token);
  const file = await pending;

  assert.equal(file.id, 'f1');
  assert.equal(FakeXHR.instances.length, 1);
  assert.equal(FakeXHR.instances[0].headers['x-user-token'], token);
  assert.equal(FakeXHR.instances[0].headers['x-user-id'], undefined);
  assert.ok(events.length > 0);
  assert.equal(events.at(-1).bytesSent, events.at(-1).totalBytes);
  assert.equal(calls.length, 0, 'fetch was not used');
});
