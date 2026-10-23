// App-facing answers carry only the documented fields (no storage keys,
// project/organisation ids or deletion flags). The SDK hands them over as is.
// Runs against the compiled build: `npm test` builds first.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RiviumStorage } = require('../dist/index.js');

const FILE = {
  id: 'f1', bucketId: 'b1', path: 'docs/a.txt', fileName: 'a.txt', mimeType: 'text/plain', size: 5,
  checksum: 'sha256-x', metadata: { k: 'v' }, uploadedBy: 'user-1',
  uploadedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
/** The same file as an older upload: every `T | null` field present and null. */
const OLD_FILE = { ...FILE, id: 'f0', checksum: null, metadata: null, uploadedBy: null, uploadedAt: null };
const BUCKET = {
  id: 'b1', name: 'docs', description: null, visibility: 'private', maxFileSize: 1048576,
  allowedMimeTypes: ['text/plain'], blockExecutables: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

class FakeFormData { append() {} }
const original = { fetch: globalThis.fetch, FormData: globalThis.FormData };
let next;
beforeEach(() => {
  globalThis.FormData = FakeFormData;
  globalThis.fetch = async () => new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
afterEach(() => Object.assign(globalThis, original));

test('file, bucket and list answers with only the whitelisted fields come back unchanged', async () => {
  const storage = new RiviumStorage({ apiKey: 'rv_live_test', userToken: 'a.b.c' });
  next = FILE;
  assert.deepEqual(await storage.getFile('f1'), FILE);
  assert.deepEqual(await storage.getFileByPath('b1', 'docs/a.txt'), FILE);
  assert.deepEqual(await storage.upload('b1', 'docs/a.txt', 'hello'), FILE);
  next = BUCKET;
  assert.deepEqual(await storage.getBucket('b1'), BUCKET);
  next = [BUCKET];
  assert.deepEqual(await storage.listBuckets(), [BUCKET]);
  next = { files: [FILE, OLD_FILE], nextCursor: 'c' };
  assert.deepEqual(await storage.listFiles('b1'), { files: [FILE, OLD_FILE], nextCursor: 'c' });
  next = { files: [], nextCursor: null };
  assert.deepEqual(await storage.listFiles('b1', { cursor: 'c' }), { files: [], nextCursor: null });
});
