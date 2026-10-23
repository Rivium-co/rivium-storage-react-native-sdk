// Paths and ids in request URLs, redirects, and signing out while the token
// provider is answering. A path or id must reach the server as the exact text
// the app passed: dot segments (also `%2e`) are refused before anything is
// sent, everything else is percent-encoded.
// Runs against the compiled build: `npm test` builds first.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RiviumStorage, RiviumStorageException, StorageErrorCode } = require('../dist/index.js');

const API_KEY = 'rv_live_test';
const BASE = 'https://storage.rivium.co';
const fileJson = {
  id: 'f1', bucketId: 'b1', path: 'a.txt', fileName: 'a.txt', mimeType: 'text/plain', size: 1,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

/** An XMLHttpRequest whose response may come from another URL (a followed redirect). */
class FakeXhr {
  constructor() { this.upload = {}; this.headers = {}; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(n, v) { this.headers[n] = v; }
  getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
  abort() {}
  send() {
    calls.push({ url: this.url, init: { method: this.method, headers: this.headers }, xhr: true });
    setTimeout(() => {
      this.status = 201;
      this.statusText = 'Created';
      this.responseURL = xhrResponseUrl ?? this.url;
      const text = JSON.stringify(fileJson);
      this.responseText = text;
      this.response = new TextEncoder().encode(text).buffer;
      this.onload?.();
    }, 0);
  }
}

const original = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest };
let calls;
let xhrResponseUrl;

beforeEach(() => {
  calls = [];
  xhrResponseUrl = undefined;
  globalThis.XMLHttpRequest = FakeXhr;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(fileJson), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});

afterEach(() => {
  globalThis.fetch = original.fetch;
  if (original.XMLHttpRequest) globalThis.XMLHttpRequest = original.XMLHttpRequest;
  else delete globalThis.XMLHttpRequest;
});

const isInvalidPath = (e) =>
  e instanceof RiviumStorageException && e.statusCode === 400 && e.code === StorageErrorCode.InvalidPath;

/** The path a real fetch would put on the wire for this URL. */
const wirePath = (url) => new URL(url).pathname;

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'ES256' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('dot and encoded-dot path segments are refused, nothing is sent (empty segments are dropped: see alignment.test.cjs)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  const bad = ['x/%2e%2e/%2e%2e/%2e%2e/6f1c2a9e', '..', '.', '../a', 'a/./b', 'a/../b', 'a/%2E%2e/b', '%2e'];
  for (const path of bad) {
    await assert.rejects(storage.getFileByPath('b1', path), isInvalidPath, path);
    await assert.rejects(storage.deleteByPath('b1', path), isInvalidPath, path);
  }
  assert.equal(calls.length, 0);
});

test('?, #, % and spaces in a path reach the server encoded, segment by segment', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  await storage.getFileByPath('b1', 'dir one/a?b#c%d.txt');
  await storage.deleteByPath('b1', 'x/%41 100%.png');
  assert.equal(wirePath(calls[0].url), '/api/v1/buckets/b1/files/dir%20one/a%3Fb%23c%25d.txt');
  assert.equal(new URL(calls[0].url).search, '');
  assert.equal(new URL(calls[0].url).hash, '');
  assert.equal(calls[1].init.method, 'DELETE');
  assert.equal(wirePath(calls[1].url), '/api/v1/buckets/b1/files/x/%2541%20100%25.png');
});

test('ids and bucket names are one encoded segment; a / stays inside it', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  await storage.getFile('a/b');
  await storage.getBucketByName('my bucket/x');
  await storage.getBucket('../x');
  await storage.upload('bucket/../x', 'a.txt', 'x');
  assert.deepEqual(calls.map((c) => wirePath(c.url)), [
    '/api/v1/files/a%2Fb',
    '/api/v1/buckets/name/my%20bucket%2Fx',
    '/api/v1/buckets/..%2Fx',
    '/api/v1/buckets/bucket%2F..%2Fx/files',
  ]);
  assert.equal(storage.getDownloadUrl('a b'), `${BASE}/api/v1/files/a%20b/download`);
});

test('ids that are . or .. are refused (also as %2e%2e), nothing is sent (empty ids: alignment.test.cjs)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  for (const id of ['.', '..', '%2e%2e']) {
    await assert.rejects(storage.getFile(id), isInvalidPath);
    await assert.rejects(storage.delete(id), isInvalidPath);
    await assert.rejects(storage.download(id), isInvalidPath);
    await assert.rejects(storage.getBucket(id), isInvalidPath);
    await assert.rejects(storage.getBucketByName(id), isInvalidPath);
    await assert.rejects(storage.listFiles(id), isInvalidPath);
    await assert.rejects(storage.upload(id, 'a.txt', 'x'), isInvalidPath);
    assert.throws(() => storage.getUrl(id), isInvalidPath);
    assert.throws(() => storage.getDownloadUrl(id), isInvalidPath);
    assert.throws(() => storage.getTransformUrl(id, { width: 10 }), isInvalidPath);
  }
  assert.equal(calls.length, 0);
});

test('every fetch is sent with redirect: "error"', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  await storage.listBuckets();
  await storage.getFileByPath('b1', 'a.txt');
  await storage.download('f1');
  await storage.upload('b1', 'a.txt', 'x');
  assert.equal(calls.length, 4);
  for (const c of calls) assert.equal(c.init.redirect, 'error', c.url);
});

test('an XMLHttpRequest upload answered from another origin is refused', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  xhrResponseUrl = 'https://evil.example.com/steal';
  await assert.rejects(
    storage.upload('b1', 'a.txt', 'x', { onProgress: () => {} }),
    (e) => e instanceof RiviumStorageException && /redirected/.test(e.message),
  );
  // Same origin (no redirect) is fine.
  xhrResponseUrl = undefined;
  const file = await storage.upload('b1', 'a.txt', 'x', { onProgress: () => {} });
  assert.equal(file.id, 'f1');
  assert.ok(calls.every((c) => c.xhr));
});

test('signing out while the provider is answering does not bring back the previous user token', async () => {
  const pending = deferred();
  let signedIn = true;
  let asked = 0;
  const storage = new RiviumStorage({
    apiKey: API_KEY,
    tokenProvider: () => {
      asked++;
      return asked === 1 ? pending.promise : signedIn ? jwt('user-b') : null;
    },
  });

  const first = storage.listBuckets(); // provider call 1 in flight (user A)
  await new Promise((r) => setImmediate(r));
  signedIn = false;
  await storage.setUserToken(null); // sign out
  pending.resolve(jwt('user-a')); // the old answer arrives late
  await first;

  await storage.listBuckets();
  const tokens = calls.map((c) => c.init.headers['x-user-token']);
  assert.deepEqual(tokens, [undefined, undefined]);
  assert.equal(asked, 2);
});

test('refreshUserToken while an older provider call is pending keeps the newer token', async () => {
  const pending = deferred();
  let asked = 0;
  const storage = new RiviumStorage({
    apiKey: API_KEY,
    tokenProvider: () => (++asked === 1 ? pending.promise : jwt('user-b')),
  });

  const first = storage.listBuckets(); // call 1 (user A) in flight
  await new Promise((r) => setImmediate(r));
  await storage.refreshUserToken(); // call 2 answers user B
  pending.resolve(jwt('user-a'));
  await first;

  await storage.listBuckets();
  const last = calls[calls.length - 1].init.headers['x-user-token'];
  assert.equal(last, jwt('user-b'));
  assert.ok(calls.every((c) => c.init.headers['x-user-token'] !== jwt('user-a')));
});

test('a provider that throws synchronously does not wedge later requests', async () => {
  let asked = 0;
  const storage = new RiviumStorage({
    apiKey: API_KEY,
    tokenProvider: () => {
      asked++;
      if (asked === 1) throw new Error('boom');
      return jwt('user-b');
    },
  });
  const origError = console.error;
  console.error = () => {};
  try {
    await storage.listBuckets();
  } finally {
    console.error = origError;
  }
  await storage.listBuckets();
  assert.equal(asked, 2);
  assert.equal(calls[1].init.headers['x-user-token'], jwt('user-b'));
});
