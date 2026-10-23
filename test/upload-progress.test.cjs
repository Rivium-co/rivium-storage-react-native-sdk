// Upload progress: with onProgress the upload goes through XMLHttpRequest
// (xhr.upload.onprogress) with the same request as the fetch path, the same
// errors and the same token refresh. Runs against the compiled build.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RiviumStorage, RiviumStorageException, SDK_VERSION } = require('../dist/index.js');
const { UploadProgressReporter } = require('../dist/upload-progress.js');

const API_KEY = 'rv_live_test';
const fileJson = {
  id: 'f1', bucketId: 'b1', path: 'a/b.bin', fileName: 'b.bin', mimeType: 'application/octet-stream', size: 3,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

/** React Native's FormData keeps the appended values as they are. */
class FakeFormData {
  constructor() { this.parts = []; }
  append(name, value) { this.parts.push([name, value]); }
}

const original = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, FormData: globalThis.FormData };
let fetchCalls;
let xhrs;
let xhrScript; // per-request: { status, body, progress: [[loaded,total],...], fail?: 'error'|'hang' }

class FakeXhr {
  constructor() {
    this.headers = {};
    this.upload = { onprogress: null };
    this.onload = this.onerror = this.ontimeout = this.onabort = null;
    this.status = 0;
    this.responseText = '';
    xhrs.push(this);
  }
  open(method, url, async) { Object.assign(this, { method, url, async }); }
  setRequestHeader(name, value) { this.headers[name] = value; }
  getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
  abort() { setImmediate(() => this.onabort && this.onabort()); }
  send(body) {
    this.body = body;
    const step = xhrScript.shift() || { status: 201, body: fileJson, progress: [] };
    if (step.fail === 'hang') return;
    setImmediate(() => {
      for (const [loaded, total] of step.progress || []) {
        this.upload.onprogress && this.upload.onprogress({ loaded, total, lengthComputable: true });
      }
      if (step.fail === 'error') { this.onerror(); return; }
      this.status = step.status;
      this.responseText = JSON.stringify(step.body);
      this.onload();
    });
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchScript;
beforeEach(() => {
  fetchCalls = [];
  fetchScript = [];
  xhrs = [];
  xhrScript = [];
  globalThis.FormData = FakeFormData;
  globalThis.XMLHttpRequest = FakeXhr;
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), method: init.method, headers: { ...(init.headers || {}) }, body: init.body });
    return fetchScript.length ? fetchScript.shift() : json(201, fileJson);
  };
});

afterEach(() => {
  Object.assign(globalThis, original);
});

const bytes = new Uint8Array(3000).map((_, i) => i % 251);
const options = { contentType: 'application/octet-stream', metadata: { k: 'v' } };

test('without onProgress: fetch, no XMLHttpRequest (unchanged)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  const file = await storage.upload('b1', 'a/b.bin', bytes, options);
  assert.equal(file.id, 'f1');
  assert.equal(fetchCalls.length, 1);
  assert.equal(xhrs.length, 0);
});

test('with onProgress: same method, URL, headers and body as the fetch path', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  await storage.upload('b1', 'a/b.bin', bytes, options);

  xhrScript.push({ status: 201, body: fileJson, progress: [[1000, 4200], [4200, 4200]] });
  const events = [];
  const file = await storage.upload('b1', 'a/b.bin', bytes, { ...options, onProgress: (p) => events.push(p) });

  assert.equal(file.id, 'f1');
  assert.equal(fetchCalls.length, 1);
  assert.equal(xhrs.length, 1);
  const viaFetch = fetchCalls[0];
  const viaXhr = xhrs[0];
  assert.equal(viaXhr.method, viaFetch.method);
  assert.equal(viaXhr.url, viaFetch.url);
  assert.equal(viaXhr.async, true);
  assert.deepEqual(viaXhr.headers, viaFetch.headers);
  assert.equal(viaXhr.headers['x-api-key'], API_KEY);
  assert.equal(viaXhr.headers['x-user-token'], 'a.b.c');
  assert.equal(viaXhr.headers['X-Rivium-SDK'], `react-native/${SDK_VERSION}`);
  assert.equal(viaXhr.headers['Content-Type'], undefined, 'multipart boundary is set by the platform');
  assert.ok(viaXhr.body instanceof FakeFormData);
  assert.deepEqual(viaXhr.body.parts, viaFetch.body.parts);
  assert.match(viaXhr.body.parts[0][1].uri, /^data:application\/octet-stream;base64,/);
  assert.deepEqual(events, [{ bytesSent: 1000, totalBytes: 4200 }, { bytesSent: 4200, totalBytes: 4200 }]);
});

test('progress is monotonic, clamped, and ends exactly once at total', async () => {
  xhrScript.push({ status: 201, body: fileJson, progress: [[100, 10000], [5000, 10000], [3000, 10000], [12000, 10000], [10000, 10000]] });
  const events = [];
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  await storage.upload('b1', 'a/b.bin', bytes, { onProgress: (p) => events.push(p) });

  assert.deepEqual(events.map((e) => e.bytesSent), [100, 5000, 10000]);
  assert.ok(events.every((e) => e.totalBytes === 10000 && e.bytesSent <= e.totalBytes));
});

test('the final event is sent on success even if the platform skipped it', async () => {
  xhrScript.push({ status: 201, body: fileJson, progress: [[2000, 8000]] });
  const events = [];
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  await storage.upload('b1', 'a/b.bin', bytes, { onProgress: (p) => events.push(p) });
  assert.deepEqual(events.at(-1), { bytesSent: 8000, totalBytes: 8000 });
});

test('token_expired on the XHR path: provider asked again, re-sent once, progress stays monotonic', async () => {
  let n = 0;
  const storage = new RiviumStorage({ apiKey: API_KEY, tokenProvider: () => `t${++n}.x.y` });
  xhrScript.push({ status: 401, body: { statusCode: 401, code: 'token_expired', message: 'expired' }, progress: [[500, 1000], [1000, 1000]] });
  xhrScript.push({ status: 201, body: fileJson, progress: [[500, 1000], [1000, 1000]] });
  const events = [];

  const file = await storage.upload('b1', 'a/b.bin', bytes, { onProgress: (p) => events.push(p) });

  assert.equal(file.id, 'f1');
  assert.equal(xhrs.length, 2);
  assert.equal(xhrs[0].headers['x-user-token'], 't1.x.y');
  assert.equal(xhrs[1].headers['x-user-token'], 't2.x.y');
  assert.deepEqual(xhrs[1].body.parts, xhrs[0].body.parts);
  assert.deepEqual(events.map((e) => e.bytesSent), [500, 1000]);
});

test('HTTP errors map exactly like the fetch path (statusCode, code, message)', async () => {
  const errorBody = { statusCode: 403, code: 'policy_denied', message: 'Not allowed by bucket rules' };
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });

  fetchScript.push(json(403, errorBody));
  const viaFetch = await storage.upload('b1', 'a/b.bin', bytes).catch((e) => e);
  xhrScript.push({ status: 403, body: errorBody, progress: [[100, 100]] });
  const viaXhr = await storage.upload('b1', 'a/b.bin', bytes, { onProgress: () => {} }).catch((e) => e);

  assert.ok(viaXhr instanceof RiviumStorageException);
  assert.deepEqual(
    { message: viaXhr.message, statusCode: viaXhr.statusCode, code: viaXhr.code },
    { message: viaFetch.message, statusCode: viaFetch.statusCode, code: viaFetch.code },
  );
  assert.equal(viaXhr.statusCode, 403);
  assert.equal(viaXhr.code, 'policy_denied');
});

test('token_required waits, then userTokenWaitTimeout fails it the same way on both paths', async () => {
  const body = { statusCode: 401, code: 'token_required', message: 'token required' };
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c', userTokenWaitTimeout: 20 });
  fetchScript.push(json(401, body));
  const viaFetch = await storage.upload('b1', 'a/b.bin', bytes).catch((e) => e);
  xhrScript.push({ status: 401, body });
  await storage.setUserToken('a.b.c');
  const viaXhr = await storage.upload('b1', 'a/b.bin', bytes, { onProgress: () => {} }).catch((e) => e);
  assert.equal(viaFetch.code, 'token_required');
  assert.equal(viaXhr.message, viaFetch.message);
  assert.equal(viaXhr.code, 'token_required');
});

test('network failure maps like fetch in React Native ("Network request failed")', async () => {
  xhrScript.push({ fail: 'error' });
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  const error = await storage.upload('b1', 'a/b.bin', bytes, { onProgress: () => {} }).catch((e) => e);
  assert.ok(error instanceof RiviumStorageException);
  assert.equal(error.message, 'Upload error: Network request failed');
});

test('timeout aborts the XHR and maps to 408 TIMEOUT', async () => {
  xhrScript.push({ fail: 'hang' });
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c', timeout: 20 });
  const error = await storage.upload('b1', 'a/b.bin', bytes, { onProgress: () => {} }).catch((e) => e);
  assert.equal(error.statusCode, 408);
  assert.equal(error.code, 'TIMEOUT');
});

test('reporter throttles to ~50 ms or 1%', () => {
  let t = 0;
  const events = [];
  const r = new UploadProgressReporter((p) => events.push(p.bytesSent), 50, () => t);
  r.report(10, 10000);    // first
  r.report(50, 10000);    // +40 B at 0 ms: dropped
  r.report(110, 10000);   // +1%: sent
  t = 10; r.report(120, 10000);  // dropped
  t = 70; r.report(130, 10000);  // 60 ms later: sent
  r.report(10000, 10000); // final
  r.finish();             // already final: nothing
  assert.deepEqual(events, [10, 110, 130, 10000]);
});

test('a throwing onProgress does not break the upload', async () => {
  xhrScript.push({ status: 201, body: fileJson, progress: [[1, 2], [2, 2]] });
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  const originalError = console.error;
  console.error = () => {};
  try {
    const file = await storage.upload('b1', 'a/b.bin', bytes, { onProgress: () => { throw new Error('ui'); } });
    assert.equal(file.id, 'f1');
  } finally {
    console.error = originalError;
  }
});
