// X-Rivium-SDK: every Rivium Storage API request names the SDK (react-native/<version>).
// Runs against the compiled build: `npm test` builds first.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { RiviumStorage, SDK_NAME, SDK_VERSION } = require('../dist/index.js');
const pkg = require('../package.json');

const originalFetch = globalThis.fetch;
let calls;

const fileJson = {
  id: 'f1', bucketId: 'b1', path: 'a.txt', fileName: 'a.txt', mimeType: 'text/plain', size: 5,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: { ...(init.headers || {}) }, method: init.method || 'GET' });
    if (String(url).endsWith('/download')) return new Response('hello', { status: 200 });
    const body = (init.method || 'GET') === 'POST' ? fileJson : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('SDK_NAME is react-native and SDK_VERSION matches package.json', () => {
  assert.equal(SDK_NAME, 'react-native');
  assert.equal(SDK_VERSION, pkg.version);
  assert.match(`${SDK_NAME}/${SDK_VERSION}`, /^[A-Za-z0-9._+-]{1,32}\/[A-Za-z0-9._+-]{1,32}$/);
});

test('bucket, upload and download requests send X-Rivium-SDK', async () => {
  const storage = new RiviumStorage({ apiKey: 'rv_live_test', userToken: 'a.b.c' });

  await storage.listBuckets();
  await storage.upload('b1', 'a.txt', 'hello');
  await storage.download('f1');

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.headers['X-Rivium-SDK'], `react-native/${SDK_VERSION}`);
  }
});

test('it is sent together with the user token', async () => {
  const storage = new RiviumStorage({ apiKey: 'rv_live_test', userToken: 'a.b.c' });

  await storage.listBuckets();

  assert.equal(calls[0].headers['X-Rivium-SDK'], `react-native/${SDK_VERSION}`);
  assert.equal(calls[0].headers['x-user-token'], 'a.b.c');
});
