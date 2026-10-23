// Upload content types and server refusals as the app sees them: the type the
// multipart file part carries when no contentType is passed, and the server's
// `code`, `statusCode` and message on every path (fetch upload, XMLHttpRequest
// upload with onProgress, download, other requests).
// Runs against the compiled build: `npm test` builds first.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RiviumStorage, RiviumStorageException, StorageErrorCode } = require('../dist/index.js');

const API_KEY = 'rv_live_test';
const fileJson = {
  id: 'f1', bucketId: 'b1', path: 'a.md', fileName: 'a.md', mimeType: 'text/markdown', size: 3,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

/** React Native's FormData keeps the appended values as they are. */
class FakeFormData {
  constructor() { this.parts = []; }
  append(name, value) { this.parts.push([name, value]); }
}

class FakeXhr {
  constructor() { this.headers = {}; this.upload = { onprogress: null }; }
  open(method, url, async) { Object.assign(this, { method, url, async }); }
  setRequestHeader(name, value) { this.headers[name] = value; }
  getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
  abort() {}
  send(body) {
    this.body = body;
    sent.push({ via: 'xhr', body });
    const r = plans.shift() || { status: 201, body: fileJson };
    setImmediate(() => {
      this.upload.onprogress && this.upload.onprogress({ loaded: 10, total: 10, lengthComputable: true });
      this.status = r.status;
      this.responseText = JSON.stringify(r.body);
      this.onload();
    });
  }
}

const original = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, FormData: globalThis.FormData };
let plans;
let sent;

beforeEach(() => {
  plans = [];
  sent = [];
  globalThis.FormData = FakeFormData;
  globalThis.XMLHttpRequest = FakeXhr;
  globalThis.fetch = async (url, init) => {
    sent.push({ via: 'fetch', body: init.body });
    const r = plans.shift() || { status: 201, body: fileJson };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
});

afterEach(() => {
  Object.assign(globalThis, original);
});

/** The `file` part of the last request. */
function filePart() {
  return sent[sent.length - 1].body.parts.find(([name]) => name === 'file')[1];
}

// ---------- content type ----------

test('no contentType: the table type for the extension (string and bytes)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  const cases = [
    ['notes/a.md', '# hi', 'text/markdown'],
    ['data/a.CSV', new Uint8Array([97, 44, 98]), 'text/csv'],
    ['a.yml', 'a: 1', 'text/yaml'],
    ['photo.HEIC', new Uint8Array(4), 'image/heic'],
    ['backup.tar.gz', new Uint8Array(3), 'application/gzip'],
    ['voice.m4a', new Uint8Array(3), 'audio/x-m4a'],
  ];
  for (const [path, data, type] of cases) {
    await storage.upload('b1', path, data);
    const part = filePart();
    assert.equal(part.type, type, path);
    assert.ok(part.uri.startsWith(`data:${type};base64,`), path);
    assert.equal(part.name, path.split('/').pop());
  }
});

test('unknown extension, no extension, dot folder: application/octet-stream', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  for (const path of ['README', 'a.unknownext', '.config/settings', 'a/.env']) {
    await storage.upload('b1', path, 'x');
    assert.equal(filePart().type, 'application/octet-stream', path);
  }
});

test('an explicit contentType always wins', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  await storage.upload('b1', 'a.md', '# x', { contentType: 'text/x-markdown' });
  assert.equal(filePart().type, 'text/x-markdown');
});

test('the XMLHttpRequest path sends the same type', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  await storage.upload('b1', 'a.json', '{}', { onProgress: () => {} });
  assert.equal(sent[0].via, 'xhr');
  assert.equal(filePart().type, 'application/json');
});

// ---------- error codes ----------

const REFUSALS = [
  [400, StorageErrorCode.TypeNotAllowed, 'This bucket does not allow text/markdown files'],
  [400, StorageErrorCode.FileTooLarge, 'File is larger than the bucket limit (1 MB)'],
  [400, StorageErrorCode.ExecutableBlocked, 'Executable files are blocked in this bucket'],
  [401, StorageErrorCode.TokenInvalid, 'Invalid user token'],
  [401, StorageErrorCode.TokenExpired, 'User token expired - refresh it and retry'],
  [409, StorageErrorCode.PathTaken, 'A file already exists at this path'],
];

function refusal(status, code, message) {
  return { status, body: { statusCode: status, error: 'Bad Request', message, code } };
}

async function rejects(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  assert.fail('expected a rejection');
}

for (const progress of [false, true]) {
  const via = progress ? 'XMLHttpRequest (onProgress)' : 'fetch';
  test(`upload via ${via}: code, statusCode and server message reach the app`, async () => {
    const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
    for (const [status, code, message] of REFUSALS) {
      plans.push(refusal(status, code, message));
      const e = await rejects(storage.upload('b1', 'a.md', '# x', progress ? { onProgress: () => {} } : {}));
      assert.ok(e instanceof RiviumStorageException);
      assert.equal(e.code, code);
      assert.equal(e.statusCode, status);
      assert.equal(e.message, message);
    }
    assert.ok(sent.every((s) => s.via === (progress ? 'xhr' : 'fetch')));
  });

  test(`upload via ${via}: token_required waits, then userTokenWaitTimeout fails it with token_required`, async () => {
    const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c', userTokenWaitTimeout: 20 });
    plans.push(refusal(401, 'token_required', 'User token required'));
    const e = await rejects(storage.upload('b1', 'a.md', '# x', progress ? { onProgress: () => {} } : {}));
    assert.equal(e.code, StorageErrorCode.TokenRequired);
    assert.equal(e.statusCode, 401);
    assert.match(e.message, /setUserToken\(\) or refreshUserToken\(\)/);
    assert.equal(storage.isAwaitingUserToken, false);
  });
}

test('upload: a 403 rule denial keeps its status and message (no code)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  plans.push({ status: 403, body: { statusCode: 403, message: 'Access denied by bucket rules' } });
  const e = await rejects(storage.upload('b1', 'a.md', '# x'));
  assert.equal(e.statusCode, 403);
  assert.equal(e.code, undefined);
  assert.equal(e.message, 'Access denied by bucket rules');
});

test('upload: a validation message array is joined', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  plans.push({ status: 400, body: { statusCode: 400, message: ['path is required', 'path too long'] } });
  const e = await rejects(storage.upload('b1', 'a.md', '# x'));
  assert.equal(e.message, 'path is required, path too long');
});

test('download: the server message and code are kept', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  for (const [status, code, message] of [
    [401, StorageErrorCode.TokenExpired, 'User token expired - refresh it and retry'],
    [403, undefined, 'Access denied by bucket rules'],
    [404, undefined, 'File not found'],
  ]) {
    plans.push({ status, body: { statusCode: status, message, ...(code ? { code } : {}) } });
    const e = await rejects(storage.download('f1'));
    assert.equal(e.statusCode, status);
    assert.equal(e.code, code);
    assert.equal(e.message, message);
  }
});

test('download: no JSON body falls back to "Download failed: <status>"', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  globalThis.fetch = async () => new Response('Bad gateway', { status: 502 });
  const e = await rejects(storage.download('f1'));
  assert.equal(e.statusCode, 502);
  assert.equal(e.message, 'Download failed: 502');
});

test('other requests: the code is kept (getFile)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  plans.push(refusal(401, 'token_invalid', 'Invalid user token'));
  const e = await rejects(storage.getFile('f1'));
  assert.equal(e.code, 'token_invalid');
  assert.equal(e.statusCode, 401);
});

// ---------- image transform refusals ----------
// The SDK only builds transform URLs (the app fetches them); these are the
// bodies the transform route answers with. The SDK's own requests read them
// the same way, so code, statusCode and message reach the app.

const TRANSFORM_REFUSALS = [
  [415, StorageErrorCode.ImageFormatNotSupported,
    "This image format can't be resized: BMP. Supported: JPEG, PNG, WebP, GIF, AVIF, HEIC, TIFF, SVG."],
  [400, StorageErrorCode.NotAnImage, "This file isn't an image (application/pdf), so it can't be resized."],
  [422, StorageErrorCode.ImageDamaged, 'The image is damaged or incomplete (it may not have finished uploading).'],
  [413, StorageErrorCode.ImageTooLarge, 'This image is 12000×9000 (108 MP); images up to 50 MP can be resized.'],
];

test('transform refusals (415, 400, 422, 413): code, statusCode and message reach the app (download, getFile)', async () => {
  const storage = new RiviumStorage({ apiKey: API_KEY, userToken: 'a.b.c' });
  for (const [status, code, message] of TRANSFORM_REFUSALS) {
    plans.push(refusal(status, code, message));
    let e = await rejects(storage.download('f1'));
    assert.equal(e.statusCode, status);
    assert.equal(e.code, code);
    assert.equal(e.message, message);
    plans.push(refusal(status, code, message));
    e = await rejects(storage.getFile('f1'));
    assert.equal(e.statusCode, status);
    assert.equal(e.code, code);
    assert.equal(e.message, message);
  }
});
