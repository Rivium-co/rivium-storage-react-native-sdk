import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { RiviumStorage, RiviumStorageException, SDK_NAME, SDK_VERSION, StorageErrorCode, UploadProgress, contentTypeForPath } from '@rivium/storage-react-native';
import { BucketFacts, BucketSetup, LEGACY_NOTE, SETUP_ONE_LINER } from '../bucket-setup';
import { fetchBytes, fetchTransform, loadPublicImage, TransformRefusal, useModel, withBusyRetry } from '../model';
import { hasRealApiKey } from '../config';
import { Samples } from '../samples';
import { isPngNotAllowed, isTypeNotAllowed, pngHeaderSize, PNG_NOT_ALLOWED } from '../noisePng';
import { sameBytes, tokenSummary, utf8 } from '../bytes';
import { Button, Card, Info, describeError, mono, useTheme } from '../ui';
import { Expect, MISSING_FILE_ID } from './ErrorsScreen';

type Status = 'running' | 'pass' | 'fail' | 'skip' | 'warn';
interface Step {
  name: string;
  status: Status;
  detail: string;
}

class Skip extends Error {}

/** A step that ran but found something to change (the bucket setup): WARN, not FAIL. */
class Warn extends Error {}

/** One test bucket, read with the SDK (the public key may read buckets). 404 = it doesn't exist. */
async function readBucket(storage: RiviumStorage, name: string): Promise<BucketFacts> {
  try {
    const b = await storage.getBucketByName(name);
    // blockExecutables: the SDK's Bucket type doesn't list it yet; newer APIs send it, older ones don't (= unknown).
    const block = (b as unknown as { blockExecutables?: unknown }).blockExecutables;
    return {
      name,
      found: true,
      visibility: b.visibility,
      allowedMimeTypes: b.allowedMimeTypes ?? null,
      maxFileSize: b.maxFileSize != null ? Number(b.maxFileSize) : null,
      blockExecutables: typeof block === 'boolean' ? block : null,
    };
  } catch (e) {
    if (e instanceof RiviumStorageException && e.statusCode === 404) return { name, found: false };
    throw e;
  }
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * One tap: runs the core flow against the two test buckets, shows pass / fail
 * / skip per step, and deletes every file it created. Use it to check an SDK
 * build (debug or release) on a phone in a minute.
 */
export function SelfTestScreen() {
  const model = useModel();
  const t = useTheme();
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);

  const runAll = async () => {
    setRunning(true);
    setSeconds(null);
    const started = Date.now();
    const list: Step[] = [];
    const push = () => setSteps([...list]);

    // The "Bucket setup" result. null (that step failed) = the dependent steps run as they are.
    let setup: BucketSetup | null = null;

    /** `needs`: the bucket setting the step needs (from "Bucket setup"); a string = SKIP with that hint. */
    const step = async (name: string, body: () => Promise<string>, needs?: (b: BucketSetup) => string | null) => {
      const entry: Step = { name, status: 'running', detail: '' };
      list.push(entry);
      push();
      try {
        const unmet = setup && needs ? needs(setup) : null;
        if (unmet) throw new Skip(unmet);
        entry.detail = await body();
        entry.status = 'pass';
      } catch (e) {
        if (e instanceof Skip) {
          entry.status = 'skip';
          entry.detail = e.message;
        } else if (e instanceof Warn) {
          entry.status = 'warn';
          entry.detail = e.message;
        } else {
          entry.status = 'fail';
          entry.detail = describeError(e);
        }
      }
      push();
      return entry.status;
    };

    const expectError = (name: string, matches: (e: unknown) => boolean, body: () => Promise<unknown>, needs?: (b: BucketSetup) => string | null) =>
      step(name, async () => {
        try {
          await body();
        } catch (e) {
          if (matches(e)) {
            // Expect.code also accepts an older Storage API's refusal (400, known message, no code): say so.
            const legacy = e instanceof RiviumStorageException && !e.code && e.statusCode === 400 ? ` — ${LEGACY_NOTE}` : '';
            return describeError(e).replace(/\n/g, ' — ') + legacy;
          }
          throw new Error(`Unexpected error: ${describeError(e)}`);
        }
        throw new Error('The call succeeded, an error was expected.');
      }, needs);

    const s = model.settings;
    const created: string[] = [];
    const drop = (id: string) => {
      const i = created.indexOf(id);
      if (i >= 0) created.splice(i, 1);
    };
    const stamp = Samples.stamp();

    try {
      const config = await step('Configuration', async () => {
        if (!hasRealApiKey(s)) throw new Error('Set the API key (Setup or Example/.env).');
        if (!s.publicBucket || !s.privateBucket) throw new Error('Set both test buckets.');
        return `SDK ${SDK_NAME}/${SDK_VERSION} · key ${s.apiKey.slice(0, 12)}…`;
      });
      if (config === 'fail') return;

      // First check against the service: are the test buckets set up the way the checks below expect?
      await step('Bucket setup', async () => {
        const b = new BucketSetup(await readBucket(model.storage, s.publicBucket), await readBucket(model.storage, s.privateBucket));
        setup = b;
        const diffs = b.differences();
        const unknown = b.unknowns();
        if (diffs.length) {
          throw new Warn([`${diffs.length} difference(s); the checks that need these settings are skipped:`, ...diffs.map((d) => `• ${d}`), ...unknown.map((u) => `• ${u}`), SETUP_ONE_LINER].join('\n'));
        }
        return [`${s.publicBucket}: public, every type the checks use · ${s.privateBucket}: private, images only, max ${b.priv.maxFileSize} B · executables blocked`, ...unknown].join('\n');
      });

      const signedIn = await step('Sign in: tokenProvider → token server', async () => {
        if (!s.tokenUrl) throw new Error('No token server URL (Setup). File calls wait for a signed-in user, so the checks stop here.');
        await model.signIn(s.testUserId);
        await model.storage.listBuckets();
        if (!model.lastToken) throw new Error('The provider returned no token.');
        return tokenSummary(model.lastToken).replace(/\n/g, ' · ');
      });
      if (signedIn === 'fail') return;

      await step('calls wait until sign-in: sign out → listFiles() waits → sign in → it completes', async () => {
        let fired = 0;
        const unsubscribe = model.storage.onAwaitingUserToken(() => {
          fired += 1;
        });
        try {
          await model.signOut();
          const pending = model.storage.listFiles(s.publicBucket, { limit: 1 });
          await new Promise((r) => setTimeout(r, 300));
          if (!model.storage.isAwaitingUserToken) throw new Error('isAwaitingUserToken should be true while signed out');
          if (fired !== 1) throw new Error(`onAwaitingUserToken fired ${fired} time(s), expected 1`);
          await model.signIn(s.testUserId); // refreshUserToken(): the waiting call goes on
          const page = await pending;
          if (model.storage.isAwaitingUserToken) throw new Error('isAwaitingUserToken should be false after sign-in');
          return `waited (isAwaitingUserToken true, onAwaitingUserToken once), then listed ${page.files.length} file(s) after sign-in`;
        } finally {
          unsubscribe();
          if (model.identity !== 'userToken') await model.signIn(s.testUserId);
        }
      });
      const storage = model.storage;
      const folder = `${model.userFolder}selftest-${stamp}/`;

      await step('listBuckets() sees both test buckets', async () => {
        const buckets = await storage.listBuckets();
        const names = new Set([...buckets.map((b) => b.name), ...buckets.map((b) => b.id)]);
        check(names.has(s.publicBucket), `${s.publicBucket} not in ${buckets.map((b) => b.name)}`);
        check(names.has(s.privateBucket), `${s.privateBucket} not in ${buckets.map((b) => b.name)}`);
        return `${buckets.length} buckets`;
      });
      await step('getBucketByName + getBucket (private)', async () => {
        const byName = await storage.getBucketByName(s.privateBucket);
        const byId = await storage.getBucket(byName.id);
        check(byId.id === byName.id, 'ids differ');
        return `${byId.name}: ${byId.visibility}, types ${byId.allowedMimeTypes?.join(',') || 'any'}, max ${byId.maxFileSize ?? 'none'}`;
      });

      const png = Samples.png();
      const imagePath = `${folder}image one.png`;
      let imageId = '';
      await step('upload PNG with metadata (private, name with spaces)', async () => {
        const file = await storage.upload(s.privateBucket, imagePath, png, { contentType: 'image/png', metadata: { test: 'selftest', n: 1 } });
        created.push(file.id);
        imageId = file.id;
        check(file.size === png.length, `size ${file.size} != ${png.length}`);
        return `${file.id} · ${file.size} B`;
      }, (b) => b.privateAllowsPng());
      await step('upload a second file (private)', async () => {
        const file = await storage.upload(s.privateBucket, `${folder}image-two.png`, Samples.tinyPng(), { contentType: 'image/png' });
        created.push(file.id);
        return file.id;
      }, (b) => b.privateAllowsPng());
      await step('getFile returns path and metadata', async () => {
        if (!imageId) throw new Skip('needs the private upload above');
        const file = await storage.getFile(imageId);
        check(file.path === imagePath, `path ${file.path}`);
        check(file.metadata?.test === 'selftest', `metadata ${JSON.stringify(file.metadata)}`);
        return file.mimeType;
      });
      await step('getFileByPath (path with spaces)', async () => {
        if (!imageId) throw new Skip('needs the private upload above');
        const file = await storage.getFileByPath(s.privateBucket, imagePath);
        check(file.id === imageId, `found ${file.id}`);
        return 'found';
      });
      await step('listFiles with prefix and paging (limit 1)', async () => {
        if (!imageId) throw new Skip('needs the private upload above');
        const first = await storage.listFiles(s.privateBucket, { prefix: folder, limit: 1 });
        check(first.files.length === 1, `page 1 has ${first.files.length}`);
        check(!!first.nextCursor, 'no nextCursor with 2 files and limit 1');
        const second = await storage.listFiles(s.privateBucket, { prefix: folder, limit: 1, cursor: first.nextCursor });
        check(second.files.length === 1, `page 2 has ${second.files.length}`);
        check(second.files[0].id !== first.files[0].id, 'same file on both pages');
        return '2 pages of 1';
      });
      await step('download returns the same bytes', async () => {
        if (!imageId) throw new Skip('needs the private upload above');
        const bytes = new Uint8Array(await storage.download(imageId));
        check(sameBytes(bytes, png), `${bytes.length} bytes differ from ${png.length}`);
        return `${bytes.length} B identical`;
      });
      await step('transform w=64 h=64 cover webp', async () => {
        if (!imageId) throw new Skip('needs the private upload above');
        const r = await fetchTransform(storage.getTransformUrl(imageId, { width: 64, height: 64, fit: 'cover', format: 'webp', quality: 70 }), model.riviumHeaders()).catch(
          (e: unknown) => {
            if (e instanceof TransformRefusal) throw new Error(`${e.title}: ${e.message} (${e.code ?? `HTTP ${e.status}`})`);
            throw e;
          },
        );
        check(r.contentType.startsWith('image/webp'), `type ${r.contentType}`);
        return `${r.bytes.length} B webp`;
      });
      await step('signed link opens without headers', async () => {
        if (!imageId) throw new Skip('needs the private upload above');
        if (!s.signedUrlEndpoint) throw new Skip('No signed-link endpoint configured.');
        const link = await model.signedLink(imageId, 120);
        const r = await fetchBytes(link);
        check(sameBytes(r.bytes, png), 'bytes differ');
        return '120 s link OK';
      });

      const receipt = `${folder}رسید-۸۸۱۲.pdf`;
      const pdf = Samples.pdf('Self-test receipt');
      let publicId = '';
      await step('upload Unicode name to public bucket', async () => {
        const file = await storage.upload(s.publicBucket, receipt, pdf, { contentType: 'application/pdf' });
        created.push(file.id);
        publicId = file.id;
        check(file.path === receipt, `path came back as ${file.path}`);
        return file.fileName;
      }, (b) => b.publicAllows('application/pdf'));
      await step('getFileByPath with the Unicode name', async () => {
        if (!publicId) throw new Skip('needs the public upload above');
        const file = await storage.getFileByPath(s.publicBucket, receipt);
        check(file.id === publicId, `found ${file.id}`);
        return 'found';
      });
      await step('public link opens without headers', async () => {
        if (!publicId) throw new Skip('needs the public upload above');
        const link = await model.publicLink(publicId);
        const r = await fetchBytes(link);
        check(sameBytes(r.bytes, pdf), 'bytes differ');
        return link.split('/')[2] ?? link;
      });

      await step('public transform link loads without headers (and a second load is a cache hit)', async () => {
        let file;
        try {
          file = await storage.upload(s.publicBucket, `${folder}public-transform.png`, Samples.png(), { contentType: 'image/png' });
        } catch (e) {
          if (isPngNotAllowed(e)) throw new Skip(PNG_NOT_ALLOWED);
          throw e;
        }
        created.push(file.id);
        let url: string;
        try {
          url = await storage.getPublicUrl(file.id, { width: 32, format: 'webp' });
        } catch (e) {
          if (e instanceof RiviumStorageException && e.statusCode === 403) {
            throw new Skip(`${s.publicBucket} isn't public (getPublicUrl answered 403): set its Visibility to Public in the Console to run this step.`);
          }
          throw e;
        }
        check(url.endsWith('?w=32&f=webp'), `unexpected URL ${url}`);
        // No headers at all. cache: 'no-store' adds an ignored _= parameter, so neither the phone's HTTP cache nor the
        // CDN answers: miss / hit below is the server's own transform cache.
        const load = () =>
          withBusyRetry(() => loadPublicImage(url, true)).catch((e: unknown) => {
            if (e instanceof TransformRefusal && e.code === StorageErrorCode.PlanFeatureLocked) {
              throw new Skip(`${e.message} (403 plan_feature_locked): this step needs a plan with image transforms.`);
            }
            if (e instanceof TransformRefusal) throw new Error(`${e.title}: ${e.message} (${e.code ?? `HTTP ${e.status}`})`);
            throw e;
          });
        const first = await load();
        check(first.status === 200 && first.contentType.startsWith('image/webp'), `first load: HTTP ${first.status}, ${first.contentType}`);
        check(first.cache === 'miss', `first load: X-Transform-Cache ${first.cache}, expected miss`);
        const second = await load();
        check(second.status === 200 && second.contentType.startsWith('image/webp'), `second load: HTTP ${second.status}, ${second.contentType}`);
        check(second.cache === 'hit' || second.cdn === 'HIT', `second load: X-Transform-Cache ${second.cache}, expected hit`);
        return `200 image/webp, miss then ${second.cache ?? second.cdn}, no headers`;
      }, (b) => b.publicAllows('image/png'));

      await step('upload progress reaches 100% (5 MB PNG, public)', async () => {
        // A real PNG of noise pixels: random bytes would be application/octet-stream, which image-only buckets refuse.
        const data = Samples.noisePng(1300, 1300);
        const header = pngHeaderSize(data);
        check(header?.width === 1300 && header?.height === 1300, `generated PNG header says ${JSON.stringify(header)}, expected 1300x1300`);
        check(data.length >= 2 * 1024 * 1024, `generated PNG is only ${data.length} B`);
        const events: UploadProgress[] = [];
        let file;
        try {
          file = await storage.upload(s.publicBucket, `${folder}progress-test.png`, data, {
            contentType: 'image/png',
            onProgress: (p) => events.push(p),
          });
        } catch (e) {
          if (isPngNotAllowed(e)) throw new Skip(PNG_NOT_ALLOWED);
          throw e;
        }
        created.push(file.id);
        const last = events[events.length - 1];
        if (!last) throw new Error('no progress events');
        check(last.bytesSent === last.totalBytes, `last event ${last.bytesSent} of ${last.totalBytes}`);
        check(last.totalBytes >= data.length, `total ${last.totalBytes} < file ${data.length}`);
        check(events.every((e, i) => i === 0 || e.bytesSent > events[i - 1].bytesSent), 'progress went backwards');
        check(events.every((e) => e.bytesSent <= e.totalBytes), 'bytesSent above totalBytes');
        check(file.size === data.length, `size ${file.size} != ${data.length}`);
        return `${events.length} events, last ${last.bytesSent} of ${last.totalBytes} B`;
      }, (b) => b.publicAllows('image/png'));

      await step('file types: .json / .csv / .md upload with no contentType', async () => {
        // No contentType: the SDK sends the type the file types table lists for the extension (the one the Console
        // offers in a bucket's allowed types), and the server stores exactly that.
        const cases: Array<[string, string, string]> = [
          ['data.json', JSON.stringify({ stamp }), 'application/json'],
          ['table.csv', 'name,score\nada,3\n', 'text/csv'],
          ['notes.md', `# Notes\n\nself-test ${stamp}\n`, 'text/markdown'],
        ];
        const out: string[] = [];
        for (const [name, body, want] of cases) {
          check(contentTypeForPath(name) === want, `contentTypeForPath(${name}) is ${contentTypeForPath(name)}, expected ${want}`);
          let file;
          try {
            file = await storage.upload(s.publicBucket, `${folder}types/${name}`, body);
          } catch (e) {
            if (isTypeNotAllowed(e)) {
              throw new Skip(`${s.publicBucket} doesn't allow ${want}: allow ${name.split('.').pop()!.toUpperCase()} in the Console (Bucket › Settings › Allowed file types) to run this step.`);
            }
            throw e;
          }
          created.push(file.id);
          check(file.mimeType === want, `${name} stored as ${file.mimeType}, expected ${want}`);
          check(file.size === utf8(body).length, `${name}: size ${file.size}`);
          out.push(`${name} → ${file.mimeType}`);
        }
        return out.join(' · ');
      }, (b) => b.publicAllows('application/json', 'text/csv', 'text/markdown'));

      await expectError('error: not found (404)', Expect.status(404), () => storage.getFile(MISSING_FILE_ID));
      await expectError('error: type not allowed (code type_not_allowed)', Expect.code(StorageErrorCode.TypeNotAllowed), async () => {
        created.push((await storage.upload(s.privateBucket, `${folder}note.txt`, Samples.text(), { contentType: 'text/plain' })).id);
      }, (b) => b.privateRefuses('text/plain'));
      await expectError('error: HTML declared as image/png (code type_not_allowed)', Expect.code(StorageErrorCode.TypeNotAllowed), async () => {
        created.push((await storage.upload(s.privateBucket, `${folder}fake.png`, Samples.html(), { contentType: 'image/png' })).id);
      }, (b) => b.privateRefuses('text/html'));
      await expectError('error: executable_blocked (.bat)', Expect.code(StorageErrorCode.ExecutableBlocked), async () => {
        created.push((await storage.upload(s.privateBucket, `${folder}run.bat`, Samples.tinyPng(), { contentType: 'image/png' })).id);
      }, (b) => b.blocksExecutables('private'));
      await expectError('error: token_invalid', Expect.code(StorageErrorCode.TokenInvalid), () =>
        new RiviumStorage({ apiKey: s.apiKey, userToken: 'not.a-real.token' }).listBuckets(),
      );

      await step('delete(fileId) then getFile is 404', async () => {
        if (!imageId) throw new Skip('needs the private upload above');
        await storage.delete(imageId);
        drop(imageId);
        try {
          await storage.getFile(imageId);
        } catch (e) {
          if (Expect.status(404)(e)) return 'gone';
          throw e;
        }
        throw new Error('still there');
      });
      await step('deleteByPath (public, Unicode)', async () => {
        if (!publicId) throw new Skip('needs the public upload above');
        await storage.deleteByPath(s.publicBucket, receipt);
        drop(publicId);
        return 'deleted';
      });
      await step('deleteMany cleans up the rest', async () => {
        if (!created.length) return 'nothing left';
        const result = await storage.deleteMany(created);
        check(result.deleted === created.length, `deleted ${result.deleted} of ${created.length}`);
        const n = created.length;
        created.length = 0;
        return `deleted ${n}`;
      });
    } finally {
      if (created.length) {
        // A step failed before cleanup; never leave test files behind silently.
        await step('Cleanup leftovers', async () => {
          const result = await model.storage.deleteMany(created);
          return `deleted ${result.deleted} of ${created.length}`;
        });
      }
      setSeconds((Date.now() - started) / 1000);
      setRunning(false);
    }
  };

  const count = (st: Status) => steps.filter((x) => x.status === st).length;
  const color = (st: Status) => (st === 'pass' ? t.green : st === 'fail' ? t.red : st === 'skip' ? t.orange : st === 'warn' ? t.violet : t.muted);
  const symbol = (st: Status) => (st === 'pass' ? '✓' : st === 'fail' ? '✗' : st === 'skip' ? '–' : st === 'warn' ? '!' : '…');

  return (
    <View>
      <Card>
        <Info>
          Signs in as the test user, then uploads, reads, lists, downloads, transforms, shares and deletes files in the two
          test buckets, checks the main errors, and cleans up. Needs the setup from README.md.
        </Info>
        <Button title={running ? 'Running…' : 'Run all checks'} onPress={runAll} disabled={running} />
        {steps.length ? (
          <Text style={{ marginTop: 10, fontWeight: '700', color: count('fail') ? t.red : running ? t.text : t.green }}>
            {`${count('pass')} passed · ${count('fail')} failed · ${count('skip')} skipped${count('warn') ? ` · ${count('warn')} warning (bucket setup)` : ''}${seconds !== null ? ` · ${seconds.toFixed(1)} s` : ''}`}
          </Text>
        ) : null}
      </Card>
      <Card>
        {steps.map((st, i) => (
          <View key={i} style={{ flexDirection: 'row', paddingVertical: 6 }}>
            <View style={{ width: 24 }}>
              {st.status === 'running' ? <ActivityIndicator size="small" /> : <Text style={{ color: color(st.status), fontWeight: '700' }}>{symbol(st.status)}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text }}>{st.name}</Text>
              {st.detail ? (
                <Text selectable style={[mono, { color: st.status === 'fail' ? t.red : st.status === 'warn' ? t.violet : t.muted }]}>
                  {st.detail}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}
