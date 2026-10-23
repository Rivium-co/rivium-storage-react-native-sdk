// Header-free image URLs for public buckets: getPublicUrl(fileId, transforms)
// and the pure helper publicImageUrl(publicUrl, transforms). The same rules
// are in every Rivium Storage SDK (Android, iOS, Flutter, React Native, Web,
// Node). Runs against the compiled build: `npm test` builds first.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../dist/index.js');

const { RiviumStorage, StorageErrorCode, publicImageUrl } = sdk;
const SdkError = sdk.RiviumStorageException;

const LINK = 'https://storage.rivium.co/public/b1/photos/my%20cat.png';
const originalFetch = globalThis.fetch;
let calls;
let answer;

beforeEach(() => {
  calls = [];
  answer = { status: 200, body: { url: LINK } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const storage = () => new RiviumStorage({ apiKey: 'rv_live_test' });
const refused = (code, status = 400) => (e) => e instanceof SdkError && e.statusCode === status && e.code === code;

test('getPublicUrl(id, transforms): the public link plus the options, short names in a fixed order', async () => {
  const url = await storage().getPublicUrl('f1', {
    rotate: 90, sharpen: 2, blur: 1, quality: 70, format: 'WEBP', fit: 'Contain', height: 300, width: 600,
  });
  assert.equal(url, `${LINK}?w=600&h=300&fit=contain&f=webp&q=70&blur=1&sharpen=2&rotate=90`);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/api/v1/files/f1/url');
  assert.equal(calls[0].init.method, 'GET');
});

test('getPublicUrl: only the options that are set; jpg is jpeg; sizes above 4096 are 4096; equal options = equal URL', async () => {
  const s = storage();
  assert.equal(await s.getPublicUrl('f1', { width: 600, format: 'webp' }), `${LINK}?w=600&f=webp`);
  assert.equal(await s.getPublicUrl('f1', { format: 'webp', width: 600 }), `${LINK}?w=600&f=webp`);
  assert.equal(await s.getPublicUrl('f1', { width: 5000, format: 'jpg' }), `${LINK}?w=4096&f=jpeg`);
  assert.equal(await s.getPublicUrl('f1', { width: undefined, quality: null, fit: '' }), LINK);
  assert.equal(await s.getPublicUrl('f1', {}), LINK);
  assert.equal(await s.getPublicUrl('f1'), LINK);
});

test('getPublicUrl: a refused option throws invalid_transform before any request', async () => {
  const s = storage();
  const bad = [
    { format: 'gif' }, { fit: 'stretch' }, { width: 0 }, { height: -1 }, { quality: 0 }, { quality: 101 },
    { blur: 21 }, { blur: -1 }, { sharpen: 11 }, { width: 1.5 }, { rotate: Number.NaN },
  ];
  for (const t of bad) await assert.rejects(s.getPublicUrl('f1', t), refused('invalid_transform'), JSON.stringify(t));
  assert.equal(calls.length, 0);
});

test('getPublicUrl: a private bucket keeps the server 403 (with or without options)', async () => {
  answer = { status: 403, body: { statusCode: 403, message: 'File is not in a public bucket' } };
  const s = storage();
  for (const t of [undefined, { width: 200 }]) {
    await assert.rejects(s.getPublicUrl('f1', t), (e) => e instanceof SdkError && e.statusCode === 403 && e.message === 'File is not in a public bucket');
  }
});

test('publicImageUrl(publicUrl, transforms): no request, same URL as getPublicUrl', async () => {
  const s = storage();
  const t = { width: 600, height: 400, fit: 'cover', format: 'avif', quality: 50 };
  const fromServer = await s.getPublicUrl('f1', t);
  calls = [];
  assert.equal(publicImageUrl(LINK, t), fromServer);
  assert.equal(RiviumStorage.publicImageUrl(LINK, t), fromServer);
  assert.equal(publicImageUrl(LINK), LINK);
  assert.equal(calls.length, 0);
});

test('publicImageUrl: a query or # already on the link is replaced', () => {
  assert.equal(publicImageUrl(`${LINK}?w=100&f=png`, { width: 300 }), `${LINK}?w=300`);
  assert.equal(publicImageUrl(`${LINK}#top`, { format: 'webp' }), `${LINK}?f=webp`);
  assert.equal(publicImageUrl(`${LINK}?v=2`, {}), LINK);
});

test('publicImageUrl: invalid_transform for options, invalid_path for a link that is not a public file link', () => {
  assert.throws(() => publicImageUrl(LINK, { format: 'bmp' }), refused('invalid_transform'));
  assert.throws(() => publicImageUrl(LINK, { quality: 0 }), refused('invalid_transform'));
  for (const link of ['', 'photos/cat.png', 'https://storage.rivium.co/api/v1/transform/f1',
    'https://storage.rivium.co/public/b1', 'https://storage.rivium.co/public/b1/', 'ftp://x/public/b1/a.png', null, 42]) {
    assert.throws(() => publicImageUrl(link, { width: 10 }), refused('invalid_path'), String(link));
  }
});

test('the new codes: transform_busy, too_many_variants, plan_feature_locked', () => {
  assert.equal(StorageErrorCode.TransformBusy, 'transform_busy');
  assert.equal(StorageErrorCode.TooManyVariants, 'too_many_variants');
  assert.equal(StorageErrorCode.PlanFeatureLocked, 'plan_feature_locked');
});
