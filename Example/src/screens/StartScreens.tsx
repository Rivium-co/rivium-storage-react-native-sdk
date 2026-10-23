import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { RiviumStorage, SDK_VERSION } from '@rivium/storage-react-native';
import { useModel, fetchUserToken } from '../model';
import { hasRealApiKey, settingsFromBuild } from '../config';
import { jwtPayload, tokenSummary } from '../bytes';
import { ActionCard, Button, Card, Field, Info, SectionTitle, describeBucket, mono, useTheme } from '../ui';

export type ScreenName =
  | 'home'
  | 'setup'
  | 'signin'
  | 'selftest'
  | 'buckets'
  | 'upload'
  | 'files'
  | 'images'
  | 'transforms'
  | 'errors';

export const SCREEN_TITLES: Record<ScreenName, string> = {
  home: 'Rivium Storage',
  setup: 'Setup',
  signin: 'Sign in',
  selftest: 'Run all checks',
  buckets: 'Buckets',
  upload: 'Upload',
  files: 'Files',
  images: 'Images and links',
  transforms: 'Image transforms',
  errors: 'Errors',
};

export function identityLine(model: ReturnType<typeof useModel>): string {
  switch (model.identity) {
    case 'userToken':
      return `Acting as: ${model.signedInUserId} (user token)`;
    default:
      return model.awaitingUserToken
        ? 'Acting as: no user. File calls are WAITING for sign-in (isAwaitingUserToken).'
        : 'Acting as: no user (file calls will wait for sign-in)';
  }
}

// ============================================================
// Home
// ============================================================

export function HomeScreen({ open }: { open: (s: ScreenName) => void }) {
  const model = useModel();
  const t = useTheme();
  const row = (name: ScreenName, subtitle: string) => (
    <Pressable
      key={name}
      onPress={() => open(name)}
      style={({ pressed }) => [{ paddingVertical: 12, borderBottomWidth: 0.5, borderColor: t.border }, pressed && { opacity: 0.6 }]}
    >
      <Text style={{ color: t.text, fontSize: 16 }}>{SCREEN_TITLES[name]} ›</Text>
      <Text style={{ color: t.muted, fontSize: 12 }}>{subtitle}</Text>
    </Pressable>
  );
  return (
    <View>
      <Card>
        <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>
          @rivium/storage-react-native {SDK_VERSION}
        </Text>
        <Info>Runs the SDK source in this repository (../src through metro.config.js), never the npm package.</Info>
        <Text style={[mono, { color: t.text }]}>{identityLine(model)}</Text>
        {!hasRealApiKey(model.settings) ? (
          <Text style={{ color: t.orange, marginTop: 6 }}>No API key yet: open Setup or fill Example/.env.</Text>
        ) : null}
      </Card>
      <SectionTitle>Start here</SectionTitle>
      <Card>
        {row('setup', 'Public key, token server, test buckets')}
        {row('signin', 'tokenProvider, setUserToken, refreshUserToken, waiting for sign-in')}
        {row('selftest', 'One-tap self-test with pass/fail per step')}
      </Card>
      <SectionTitle>Features</SectionTitle>
      <Card>
        {row('buckets', 'listBuckets, getBucket, getBucketByName')}
        {row('upload', 'Bytes, files, photos, camera, metadata, Unicode names')}
        {row('files', 'List with prefix and paging, get, download, delete, delete many')}
        {row('images', 'Public link, download(), signed link, and the wrong way')}
        {row('transforms', 'Every transform option, shown live')}
        {row('errors', 'Trigger and read every error the SDK reports')}
      </Card>
    </View>
  );
}

// ============================================================
// Setup
// ============================================================

export function SetupScreen() {
  const model = useModel();
  const [s, setS] = useState(model.settings);
  const [saved, setSaved] = useState('');
  const set = (key: keyof typeof s) => (v: string) => setS({ ...s, [key]: v.trim() });
  return (
    <View>
      <Info>
        The app holds only the PUBLIC key (rv_live_…). The server secret (rv_srv_…) stays on your server: the token server
        uses it to mint user tokens and signed links. Values come from Example/.env at build time; edits here are saved on
        this phone only.
      </Info>
      <Card>
        <Field label="API key (rv_live_…)" value={s.apiKey} onChangeText={set('apiKey')} />
        <Field
          label="Token endpoint (POST {userId} → {token})"
          value={s.tokenUrl}
          onChangeText={set('tokenUrl')}
          placeholder="http://192.168.1.20:4000/token"
        />
        <Field
          label="Signed-link endpoint (POST {fileId, expiresIn} → {url})"
          value={s.signedUrlEndpoint}
          onChangeText={set('signedUrlEndpoint')}
          placeholder="http://192.168.1.20:4000/signed-url"
        />
        <Field label="Public bucket (name or id)" value={s.publicBucket} onChangeText={set('publicBucket')} />
        <Field label="Private images-only bucket (blocks executables)" value={s.privateBucket} onChangeText={set('privateBucket')} />
        <Field label="Test user id" value={s.testUserId} onChangeText={set('testUserId')} />
        <Button
          title="Apply (recreate the SDK client)"
          onPress={async () => {
            await model.updateSettings(s);
            setSaved('Saved. new RiviumStorage({ apiKey, tokenProvider }) created.');
          }}
        />
        <Button
          title="Reset to build values"
          secondary
          destructive
          onPress={async () => {
            const build = settingsFromBuild();
            setS(build);
            await model.updateSettings(build);
            setSaved('Reset to the values in .env.');
          }}
        />
        {saved ? <Info>{saved}</Info> : null}
      </Card>
      <Info>The SDK always talks to https://storage.rivium.co; the base URL is not configurable.</Info>
    </View>
  );
}

// ============================================================
// Sign in
// ============================================================

export function SignInScreen() {
  const model = useModel();
  const t = useTheme();
  const [userId, setUserId] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [waitResult, setWaitResult] = useState('');

  const state =
    model.identity === 'userToken'
      ? `Signed in as ${model.signedInUserId} with a user token.\n${tokenSummary(model.lastToken)}`
      : 'No user. File calls (upload, listFiles, download, delete…) wait until a user signs in; bucket calls still work.';

  return (
    <View>
      <Card>
        <Text style={[mono, { color: t.text }]}>{state}</Text>
        <Info>Token provider calls so far: {model.providerCalls}</Info>
        <Text style={{ color: model.awaitingUserToken ? t.orange : t.muted, marginTop: 6 }}>
          {model.awaitingUserToken
            ? 'isAwaitingUserToken: true — file calls are waiting for a signed-in user. Sign in to let them go on.'
            : 'isAwaitingUserToken: false'}
        </Text>
      </Card>
      <Info>
        Using Rivium Auth? No token server needed: its token is the Rivium user token. new RiviumStorage({'{'} apiKey,
        tokenProvider: () =&gt; auth.getToken() {'}'}) with auth = createRiviumAuth(…) from @rivium/auth-react-native, and
        call storage.refreshUserToken() from auth.onAuthStateChanged. This example keeps the demo token server so it can
        sign in as any test user.
      </Info>

      <SectionTitle>tokenProvider (recommended)</SectionTitle>
      <ActionCard
        title="Sign in with a user token"
        info="Use this in every new app. Your server checks its own session and mints a short-lived Rivium user token with the server secret. The SDK gets it through tokenProvider before the first request, renews it before it expires, and retries once on token_expired / token_invalid. Access rules then see a VERIFIED user."
        button="Sign in"
        action={async () => {
          const id = userId || model.settings.testUserId;
          await model.signIn(id); // provider now returns this user's token; refreshUserToken()
          const buckets = await model.storage.listBuckets();
          if (!model.lastToken) throw new Error('The provider returned no token.');
          return `Signed in as ${id}. A request just ran with the token (${buckets.length} buckets visible).\n${tokenSummary(model.lastToken)}`;
        }}
      >
        <Field label="User id (your app's own user id)" value={userId} onChangeText={setUserId} placeholder={model.settings.testUserId} />
      </ActionCard>
      <ActionCard
        title="Sign out"
        info="The provider returns null from now on, and refreshUserToken() asks it again. File calls then wait (isAwaitingUserToken) until the next sign-in."
        button="Sign out"
        destructive
        action={async () => {
          await model.signOut();
          return 'Signed out.';
        }}
      />
      <ActionCard
        title="refreshUserToken()"
        info="Ask the provider again now. Call it when the user signs in or out, or switches accounts."
        button="Refresh token"
        action={async () => {
          const before = model.providerCalls;
          await model.storage.refreshUserToken();
          return `Provider asked ${model.providerCalls - before} time(s).\n${tokenSummary(model.lastToken)}`;
        }}
      />

      <SectionTitle>Tokens you already hold</SectionTitle>
      <ActionCard
        title="userToken option / setUserToken()"
        info="For apps that already hold a token (for example the Rivium Auth sign-in token). Without a provider the SDK can't renew it, so call setUserToken again when you refresh it. Shown on a separate client without a provider."
        button="Use this token"
        action={async () => {
          const token =
            manualToken || (await fetchUserToken(model.settings.tokenUrl, model.settings.testUserId));
          const client = new RiviumStorage({ apiKey: model.settings.apiKey });
          await client.setUserToken(token);
          const user = String(jwtPayload(token)?.sub ?? model.settings.testUserId);
          const page = await client.listFiles(model.settings.privateBucket, { prefix: `users/${user}/`, limit: 5 });
          return `Token accepted. ${page.files.length} file(s) in this user's folder.\n${tokenSummary(token)}`;
        }}
      >
        <Field label="Paste a token (or leave empty to fetch one now)" value={manualToken} onChangeText={setManualToken} />
      </ActionCard>

      <SectionTitle>Calls wait until sign-in</SectionTitle>
      <ActionCard
        title="Sign out, then listFiles()"
        info="File calls never go out without a user token. With no one signed in, listFiles() sends nothing and does not fail: it waits, isAwaitingUserToken turns true and onAwaitingUserToken fires once. Then tap Sign in above: the waiting call completes by itself. (userTokenWaitTimeout makes it fail with token_required instead; see Errors.)"
        button="Sign out and start listFiles()"
        action={async () => {
          await model.signOut();
          setWaitResult('listFiles() is waiting…');
          const started = Date.now();
          model.storage
            .listFiles(model.settings.publicBucket, { limit: 3 })
            .then((page) =>
              setWaitResult(
                `listFiles() completed after ${((Date.now() - started) / 1000).toFixed(1)} s of waiting: ${page.files.length} file(s).`,
              ),
            )
            .catch((e) => setWaitResult(`listFiles() failed: ${(e as Error).message}`));
          await new Promise((r) => setTimeout(r, 300));
          return `Signed out. isAwaitingUserToken = ${model.storage.isAwaitingUserToken}: nothing was sent. Now tap Sign in above.`;
        }}
      />
      {waitResult ? (
        <Card>
          <Text style={[mono, { color: t.text }]}>{waitResult}</Text>
        </Card>
      ) : null}
    </View>
  );
}

// ============================================================
// Buckets
// ============================================================

export function BucketsScreen() {
  const model = useModel();
  const [bucketId, setBucketId] = useState('');
  const [bucketName, setBucketName] = useState('');
  return (
    <View>
      <Info>
        With the public key an app may READ buckets (list, get). Creating, changing and deleting buckets and access rules
        needs the server secret (403 server_secret_required), so they are not in the app SDKs: use the Console or your
        server.
      </Info>
      <ActionCard
        title="listBuckets()"
        info="All buckets of the project the key belongs to. Use it to find a bucket id, or to check the key works."
        action={async () => {
          const buckets = await model.storage.listBuckets();
          if (buckets[0] && !bucketId) setBucketId(buckets[0].id);
          return `${buckets.length} bucket(s)\n${buckets.map((b) => `• ${b.name} [${b.visibility}] ${b.id}`).join('\n')}`;
        }}
      />
      <ActionCard
        title="getBucket(bucketId)"
        info="One bucket by id: visibility, allowed types and size limit. Check these before an upload to tell the user early."
        action={async () => describeBucket(await model.storage.getBucket(bucketId))}
      >
        <Field label="Bucket id" value={bucketId} onChangeText={setBucketId} />
      </ActionCard>
      <ActionCard
        title="getBucketByName(name)"
        info="The same, by the name you gave the bucket in the Console. Every file method also accepts a bucket name where it asks for bucketId."
        action={async () => {
          const bucket = await model.storage.getBucketByName(bucketName || model.settings.privateBucket);
          setBucketId(bucket.id);
          return describeBucket(bucket);
        }}
      >
        <Field label="Bucket name" value={bucketName} onChangeText={setBucketName} placeholder={model.settings.privateBucket} />
      </ActionCard>
    </View>
  );
}
