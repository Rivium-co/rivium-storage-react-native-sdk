import React, { useState } from 'react';
import { View } from 'react-native';
import { RiviumStorage, RiviumStorageException, StorageErrorCode } from '@rivium/storage-react-native';
import { legacyMatch } from '../bucket-setup';
import { fetchUserToken, useModel } from '../model';
import { Samples } from '../samples';
import { jwtPayload } from '../bytes';
import { ActionCard, ExpectErrorCard, Info, SectionTitle, describeFile } from '../ui';

/** Matchers on RiviumStorageException.statusCode / .code / .message. */
export const Expect = {
  status: (status: number) => (e: unknown) => e instanceof RiviumStorageException && e.statusCode === status,
  /** The code, or (older Storage API: no codes yet) a 400 with the known message; see isLegacyRefusal. */
  code: (code: string) => (e: unknown) =>
    e instanceof RiviumStorageException && (e.code === code || legacyMatch(code, e.statusCode, e.code, e.message)),
  message: (status: number, text: string) => (e: unknown) =>
    e instanceof RiviumStorageException && e.statusCode === status && e.message.toLowerCase().includes(text.toLowerCase()),
};

/** A well-formed id of a file that does not exist. */
export const MISSING_FILE_ID = '00000000-0000-4000-8000-000000000000';

export function ErrorsScreen() {
  const model = useModel();
  const [expiredToken, setExpiredToken] = useState<string | null>(null);
  const s = model.settings;

  return (
    <View>
      <Info>
        Each card makes the server refuse something on purpose and shows the exact RiviumStorageException (statusCode, code,
        message), so you know what to catch.
      </Info>

      <SectionTitle>Not found</SectionTitle>
      <ExpectErrorCard
        title="getFile on a missing id"
        info="The id is well-formed but no such file exists (or it was deleted)."
        expected="statusCode 404"
        matches={Expect.status(404)}
        action={async () => describeFile(await model.storage.getFile(MISSING_FILE_ID))}
      />
      <ExpectErrorCard
        title="download a missing file"
        info="download() keeps the server's message, statusCode and code, like every other call."
        expected="statusCode 404"
        matches={Expect.status(404)}
        action={async () => `${(await model.storage.download(MISSING_FILE_ID)).byteLength} bytes`}
      />
      <ExpectErrorCard
        title="getBucketByName on a missing bucket"
        info="A bucket name that does not exist in this project."
        expected="statusCode 404"
        matches={Expect.status(404)}
        action={async () => JSON.stringify(await model.storage.getBucketByName(`no-such-bucket-${Samples.stamp()}`))}
      />

      <SectionTitle>What the bucket accepts</SectionTitle>
      <ExpectErrorCard
        title="Type not allowed"
        info="A text file into the images-only private bucket."
        expected={'400, code "type_not_allowed" (StorageErrorCode.TypeNotAllowed)'}
        matches={Expect.code(StorageErrorCode.TypeNotAllowed)}
        action={async () => {
          await model.ensureSignedIn();
          return describeFile(await model.storage.upload(s.privateBucket, model.userFolder + `notes-${Samples.stamp()}.txt`, Samples.text(), { contentType: 'text/plain' }));
        }}
      />
      <ExpectErrorCard
        title="Content doesn't match the declared type"
        info="HTML bytes declared as image/png. The server reads the real content, so an images-only bucket refuses it: a renamed page can't sneak in as a picture."
        expected={'400, code "type_not_allowed" (the message names text/html, declared image/png)'}
        matches={Expect.code(StorageErrorCode.TypeNotAllowed)}
        action={async () => {
          await model.ensureSignedIn();
          return describeFile(await model.storage.upload(s.privateBucket, model.userFolder + `fake-${Samples.stamp()}.png`, Samples.html(), { contentType: 'image/png' }));
        }}
      />
      <ExpectErrorCard
        title="Too big"
        info="Reads the private bucket's maxFileSize and uploads a PNG one byte larger (skipped when the limit is over 25 MB)."
        expected={'400, code "file_too_large" (StorageErrorCode.FileTooLarge)'}
        matches={Expect.code(StorageErrorCode.FileTooLarge)}
        action={async () => {
          await model.ensureSignedIn();
          const bucket = await model.storage.getBucketByName(s.privateBucket);
          if (!bucket.maxFileSize) throw new Error('The bucket has no size limit: set one (e.g. 1 MB) in the Console.');
          if (bucket.maxFileSize > 25 * 1024 * 1024) throw new Error(`Limit is ${bucket.maxFileSize} bytes; set 1 MB on the test bucket so this stays small.`);
          return describeFile(await model.storage.upload(bucket.id, model.userFolder + `big-${Samples.stamp()}.png`, Samples.oversizedPng(bucket.maxFileSize + 1), { contentType: 'image/png' }));
        }}
      />
      <ExpectErrorCard
        title="Executable blocked (by name)"
        info={'A real PNG saved as "run.bat" in the private bucket, which has "Block executable files" on. The type is allowed, the name is a script: refused.'}
        expected={'400, code "executable_blocked"'}
        matches={Expect.code(StorageErrorCode.ExecutableBlocked)}
        action={async () => {
          await model.ensureSignedIn();
          return describeFile(await model.storage.upload(s.privateBucket, model.userFolder + `run-${Samples.stamp()}.bat`, Samples.tinyPng(), { contentType: 'image/png' }));
        }}
      />
      <ExpectErrorCard
        title="Executable blocked (fake .exe)"
        info={'A harmless file starting with the Windows "MZ" header, named setup.exe, into the PUBLIC bucket. Refused only if that bucket also has "Block executable files" on (otherwise it is stored: then delete it).'}
        expected={'400, code "executable_blocked"'}
        matches={Expect.code(StorageErrorCode.ExecutableBlocked)}
        action={async () => {
          const file = await model.storage.upload(s.publicBucket, model.userFolder + `setup-${Samples.stamp()}.exe`, Samples.fakeExe(), { contentType: 'application/octet-stream' });
          model.remember(file);
          return `Stored (this bucket doesn't block executables):\n${describeFile(file)}`;
        }}
      />

      <SectionTitle>Access rules</SectionTitle>
      <ExpectErrorCard
        title="Upload into someone else's folder"
        info="Signed in as you, writing to users/<another user>/. The userFolders rule only lets you write in your own folder."
        expected="statusCode 403"
        matches={Expect.status(403)}
        action={async () => {
          await model.ensureSignedIn();
          return describeFile(await model.storage.upload(s.privateBucket, `users/someone-else/example/x-${Samples.stamp()}.png`, Samples.tinyPng(), { contentType: 'image/png' }));
        }}
      />

      <SectionTitle>Admin actions</SectionTitle>
      <ExpectErrorCard
        title="Create a bucket from the app"
        info="Creating or changing buckets, access rules and visibility, and making signed links, is for your server (server secret) or the Console. From an app (public key + user token) the API answers 403 server_secret_required. The app SDK has no such calls, so this card sends POST /api/v1/buckets itself."
        expected={'403, code "server_secret_required"'}
        matches={Expect.code(StorageErrorCode.ServerSecretRequired)}
        action={async () => {
          await model.ensureSignedIn();
          const base = model.storage.getDownloadUrl('x').split('/api/')[0];
          const response = await fetch(`${base}/api/v1/buckets`, {
            method: 'POST',
            headers: { ...model.riviumHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `rn-example-not-allowed-${Samples.stamp()}` }),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new RiviumStorageException(
              typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`,
              response.status,
              typeof body?.code === 'string' ? body.code : undefined,
            );
          }
          return `Created?! ${JSON.stringify(body)}`;
        }}
      />

      <SectionTitle>User tokens</SectionTitle>
      <ExpectErrorCard
        title="token_required (no user in time)"
        info="File calls need a signed-in user: with no token they wait instead of failing. A client with no token and userTokenWaitTimeout: 1500 gives up after 1.5 s with 401 token_required. Without the option it would wait until a user signs in."
        expected={'401, code "token_required"'}
        matches={Expect.code(StorageErrorCode.TokenRequired)}
        action={async () => {
          const page = await new RiviumStorage({ apiKey: s.apiKey, userTokenWaitTimeout: 1500 }).listFiles(s.publicBucket, { limit: 1 });
          return `${page.files.length} files (no token was needed?!)`;
        }}
      />
      <ExpectErrorCard
        title="token_invalid"
        info="A client holding a token that is not a Rivium user token, with no provider to ask for another."
        expected={'401, code "token_invalid"'}
        matches={Expect.code(StorageErrorCode.TokenInvalid)}
        action={async () => {
          const page = await new RiviumStorage({ apiKey: s.apiKey, userToken: 'not.a-real.token' }).listFiles(s.publicBucket, { limit: 1 });
          return `${page.files.length} files`;
        }}
      />
      <ExpectErrorCard
        title="token_expired (takes ~70 s)"
        info="Asks your token server for a 60-second token (the shortest Rivium mints), waits until it has expired, then uses it on a client without a provider."
        expected={'401, code "token_expired"'}
        matches={Expect.code(StorageErrorCode.TokenExpired)}
        action={async () => {
          const token = await fetchUserToken(s.tokenUrl, s.testUserId, 60);
          const exp = Number(jwtPayload(token)?.exp ?? Date.now() / 1000 + 60);
          const waitMs = Math.max(0, exp * 1000 - Date.now()) + 8000;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          setExpiredToken(token);
          const page = await new RiviumStorage({ apiKey: s.apiKey, userToken: token }).listFiles(s.publicBucket, { limit: 1 });
          return `${page.files.length} files (did the token server ignore expiresIn?)`;
        }}
      />
      <ActionCard
        title="Provider renews an expired token by itself"
        info="Same expired token, but now from a tokenProvider: the server answers token_expired, the SDK asks the provider once more and retries. Your code just sees success. Run token_expired first."
        action={async () => {
          if (!expiredToken) throw new Error('Run the token_expired card first.');
          let calls = 0;
          const client = new RiviumStorage({
            apiKey: s.apiKey,
            tokenProvider: async () => {
              calls += 1;
              return calls === 1 ? expiredToken : fetchUserToken(s.tokenUrl, s.testUserId);
            },
          });
          const page = await client.listFiles(s.publicBucket, { limit: 1 });
          return `Succeeded (${page.files.length} file). Provider asked ${calls} times: expired token, then a fresh one.`;
        }}
      />
    </View>
  );
}
