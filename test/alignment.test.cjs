// The rules every Rivium Storage SDK applies the same way (Android, iOS,
// Flutter, React Native, Web, Node): paths in URLs, upload paths, empty
// arguments, the answers' fields, the error codes and the transform options.
// Runs against the compiled build: `npm test` builds first.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../dist/index.js');

const { RiviumStorage, StorageErrorCode } = sdk;
const SdkError = sdk.RiviumStorageException;

const DATE = '2026-10-23T09:15:02.123Z';
/** A file answer with exactly the §11 fields. */
const FILE = {
  id: 'f1', bucketId: 'b1', path: 'docs/a.txt', fileName: 'a.txt', mimeType: 'text/plain', size: 3000000000,
  checksum: null, metadata: null, uploadedBy: null, uploadedAt: null, createdAt: DATE, updatedAt: DATE,
};
const BUCKET = {
  id: 'b1', name: 'docs', description: null, visibility: 'public', allowedMimeTypes: null,
  maxFileSize: 2147483647, blockExecutables: true, createdAt: DATE, updatedAt: DATE,
};

const originalFetch = globalThis.fetch;
let calls;
let next;

beforeEach(() => {
  calls = [];
  next = FILE;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const storage = () => new RiviumStorage({ apiKey: 'rv_live_test', userToken: 'a.b.c' });
const wirePath = (url) => new URL(url).pathname;
const refused = (code, status = 400) => (e) => e instanceof SdkError && e.statusCode === status && e.code === code;

test('empty segments are dropped from paths in URLs (leading, trailing, repeated /)', async () => {
  const s = storage();
  await s.getFileByPath('b1', '/a');
  await s.getFileByPath('b1', 'a/');
  await s.getFileByPath('b1', 'a//b');
  await s.deleteByPath('b1', '//x///y//');
  assert.deepEqual(calls.map((c) => wirePath(c.url)), [
    '/api/v1/buckets/b1/files/a',
    '/api/v1/buckets/b1/files/a',
    '/api/v1/buckets/b1/files/a/b',
    '/api/v1/buckets/b1/files/x/y',
  ]);
});

test('. and .. segments are refused, also percent-encoded, nothing is sent', async () => {
  const s = storage();
  for (const path of ['.', '..', 'a/./b', 'a/../b', '../a', '%2e', '%2E%2e', 'x/%2e%2e/y', 'a/%252e%252e/b']) {
    await assert.rejects(s.getFileByPath('b1', path), refused('invalid_path'), path);
    await assert.rejects(s.deleteByPath('b1', path), refused('invalid_path'), path);
  }
  assert.equal(calls.length, 0);
});

test('?, #, %, spaces and other scripts are encoded segment by segment', async () => {
  const s = storage();
  await s.getFileByPath('b1', 'dir one/a?b#c%d.txt');
  await s.getFileByPath('b1', 'фото/日本.png');
  assert.equal(wirePath(calls[0].url), '/api/v1/buckets/b1/files/dir%20one/a%3Fb%23c%25d.txt');
  assert.equal(new URL(calls[0].url).search, '');
  assert.equal(new URL(calls[0].url).hash, '');
  assert.equal(wirePath(calls[1].url), `/api/v1/buckets/b1/files/${encodeURIComponent('фото')}/${encodeURIComponent('日本.png')}`);
});

test('ids are one encoded segment; ., .. and %2e%2e ids are refused', async () => {
  const s = storage();
  await s.getFile('a/b');
  await s.getBucketByName('my bucket');
  assert.deepEqual(calls.map((c) => wirePath(c.url)), ['/api/v1/files/a%2Fb', '/api/v1/buckets/name/my%20bucket']);
  for (const id of ['.', '..', '%2e%2e']) {
    await assert.rejects(s.getFile(id), refused('invalid_path'), id);
    await assert.rejects(s.getBucket(id), refused('invalid_path'), id);
  }
  assert.equal(calls.length, 2);
});

test('empty arguments are refused before any request: bucket_required, file_id_required, path_required', async () => {
  const s = storage();
  for (const blank of ['', '  ', '/', ' / ']) {
    await assert.rejects(s.getBucket(blank), refused('bucket_required'));
    await assert.rejects(s.getBucketByName(blank), refused('bucket_required'));
    await assert.rejects(s.listFiles(blank), refused('bucket_required'));
    await assert.rejects(s.upload(blank, 'a.txt', 'x'), refused('bucket_required'));
    await assert.rejects(s.getFileByPath(blank, 'a.txt'), refused('bucket_required'));
    await assert.rejects(s.deleteByPath(blank, 'a.txt'), refused('bucket_required'));
    await assert.rejects(s.getFile(blank), refused('file_id_required'));
    await assert.rejects(s.download(blank), refused('file_id_required'));
    await assert.rejects(s.delete(blank), refused('file_id_required'));
    await assert.rejects(s.getPublicUrl(blank), refused('file_id_required'));
    assert.throws(() => s.getUrl(blank), refused('file_id_required'));
    assert.throws(() => s.getDownloadUrl(blank), refused('file_id_required'));
    assert.throws(() => s.getTransformUrl(blank), refused('file_id_required'));
    await assert.rejects(s.getFileByPath('b1', blank), refused('path_required'));
    await assert.rejects(s.deleteByPath('b1', blank), refused('path_required'));
    await assert.rejects(s.upload('b1', blank, 'x'), refused('path_required'));
  }
  assert.equal(calls.length, 0);
});

test('upload paths: ?, #, %, text-direction marks and dot segments are refused with the server messages', async () => {
  const s = storage();
  const cases = [
    ['a?b.txt', "Path can't contain '?', '#' or '%'"],
    ['a#b.txt', "Path can't contain '?', '#' or '%'"],
    ['100%.txt', "Path can't contain '?', '#' or '%'"],
    ['x/%2e%2e/y.txt', "Path can't contain '?', '#' or '%'"],
    ['a\u202eb.txt', "Path can't contain text-direction characters"],
    ['a\u200fb.txt', "Path can't contain text-direction characters"],
    ['a/../b.txt', "File paths can't contain '.' or '..' segments"],
    ['./b.txt', "File paths can't contain '.' or '..' segments"],
  ];
  for (const [path, message] of cases) {
    await assert.rejects(s.upload('b1', path, 'x'), (e) => refused('invalid_path')(e) && e.message === message, path);
  }
  assert.equal(calls.length, 0);
});

/** React Native's FormData keeps the appended values as they are. */
class FakeFormData {
  constructor() { this.parts = []; }
  append(name, value) { this.parts.push([name, value]); }
  get(name) { return this.parts.find(([n]) => n === name)?.[1]; }
}

test('upload paths are normalised like the server: leading, trailing and repeated / dropped', async () => {
  const realFormData = globalThis.FormData;
  globalThis.FormData = FakeFormData;
  try {
    const s = storage();
    await s.upload('b1', '/photos//2026/a b.png/', 'x');
    const form = calls[0].init.body;
    assert.equal(form.get('path'), 'photos/2026/a b.png');
    assert.equal(form.get('file').name, 'a b.png');
  } finally {
    globalThis.FormData = realFormData;
  }
});

test('answers with only the §11 fields decode; nullable fields stay null, nextCursor may be null', async () => {
  const s = storage();
  assert.deepEqual(await s.getFile('f1'), FILE);
  next = BUCKET;
  assert.deepEqual(await s.getBucket('b1'), BUCKET);
  next = { files: [FILE], nextCursor: null };
  const list = await s.listFiles('b1');
  assert.equal(list.nextCursor, null);
  assert.equal(list.files[0].size, 3000000000);
  assert.equal('url' in list.files[0], false);
});

test('getPublicUrl returns the public link from GET /files/:id/url', async () => {
  const s = storage();
  next = { url: 'https://storage.rivium.co/public/b1/docs/a%20b.txt' };
  assert.equal(await s.getPublicUrl('f1'), 'https://storage.rivium.co/public/b1/docs/a%20b.txt');
  assert.equal(wirePath(calls[0].url), '/api/v1/files/f1/url');
  assert.equal(calls[0].init.method, 'GET');
});

test('StorageErrorCode has the same 29 codes as every Rivium Storage SDK', () => {
  assert.deepEqual(Object.values(StorageErrorCode).sort(), [
    'access_denied', 'bucket_required', 'executable_blocked', 'file_id_required', 'file_required', 'file_too_large',
    'image_damaged', 'image_format_not_supported', 'image_too_large',
    'invalid_ids', 'invalid_path', 'invalid_rules', 'invalid_transform', 'ip_not_allowed', 'not_an_image',
    'path_required', 'path_taken', 'plan_feature_locked',
    'server_secret_required', 'source_too_large', 'token_expired', 'token_invalid', 'token_required', 'too_many_variants', 'transform_busy', 'type_not_allowed',
    'upload_expired', 'upload_missing', 'upload_rejected',
  ]);
});

test('transform options: allowed values pass, the rest is refused with invalid_transform', () => {
  const s = storage();
  const url = s.getTransformUrl('f1', {
    width: 5000, height: 10, fit: 'Cover', format: 'jpg', quality: 100, blur: 20, sharpen: 10, rotate: 90,
  });
  assert.equal(url, 'https://storage.rivium.co/api/v1/transform/f1?w=4096&h=10&fit=cover&f=jpeg&q=100&blur=20&sharpen=10&rotate=90');
  assert.equal(s.getTransformUrl('f1', { format: 'avif', fit: 'outside', quality: 1, blur: 0, sharpen: 0 }),
    'https://storage.rivium.co/api/v1/transform/f1?fit=outside&f=avif&q=1&blur=0&sharpen=0');
  assert.equal(s.getTransformUrl('f1'), 'https://storage.rivium.co/api/v1/transform/f1');
  const bad = [
    { format: 'gif' }, { format: 'tiff' }, { fit: 'stretch' }, { width: 0 }, { height: -1 }, { quality: 0 },
    { quality: 101 }, { blur: 21 }, { blur: -1 }, { sharpen: 11 }, { width: 1.5 }, { rotate: Number.NaN },
  ];
  for (const t of bad) assert.throws(() => s.getTransformUrl('f1', t), refused('invalid_transform'), JSON.stringify(t));
});
