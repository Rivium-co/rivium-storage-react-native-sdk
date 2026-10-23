# Rivium Storage React Native example

An Expo app (SDK 52, React Native 0.76) that runs every feature of
`@rivium/storage-react-native` against your Rivium project and shows each
result (or the exact error) on screen. Light and dark mode.

It always runs the SDK **source in this repository**, never the npm package:

- `package.json` depends on `"@rivium/storage-react-native": "file:../"`.
- `metro.config.js` resolves `@rivium/storage-react-native` to `../src/index.ts`,
  so you don't need to rebuild `../dist` after an SDK change, and debug and
  release bundles both contain the current source.
- `tsconfig.json` maps the same name to `../src/index.ts` for type checking.

## What is in it

| Screen | SDK features |
| --- | --- |
| Setup | `new RiviumStorage({ apiKey, tokenProvider, timeout })`, `SDK_NAME` / `SDK_VERSION` |
| Sign in | `tokenProvider`, `refreshUserToken()`, `setUserToken()`, the `userToken` option, the live `isAwaitingUserToken` state, "calls wait until sign-in" (sign out → `listFiles()` waits → sign in → it completes), a note on using Rivium Auth instead (`tokenProvider: () => auth.getToken()`) |
| Run all checks | One-tap self-test: pass / fail / skip per step (including "calls wait until sign-in"), deletes what it created |
| Buckets | `listBuckets()`, `getBucket()`, `getBucketByName()` |
| Upload | `upload()` with a `string` and a `Uint8Array`, `contentType`, `metadata`; `onProgress` with a progress bar (a generated ~5 MB PNG of noise pixels and the pickers); file picker, photo library, camera; `رسید-۸۸۱۲.pdf`; a name with spaces; a signed upload link from your server (PUT + confirm) |
| Files | `listFiles()` with `prefix`, `limit`, `cursor` / `nextCursor`; `getFile`, `getFileByPath`, `download`, `delete`, `deleteByPath`, `deleteMany` |
| Images and links | Public link (public bucket), `download()` → data URI (private), signed link from your server, and why `getUrl()` in `<Image>` fails |
| Image transforms | `getTransformUrl()` with every option (width, height, fit, format, quality, blur, sharpen, rotate), shown with `<Image source={{ uri, headers }}>` and with `fetch` |
| Errors | Not found, type not allowed, content that doesn't match its declared type, too big, `executable_blocked`, access denied by rules, `server_secret_required` (an admin action from the app), `token_required` (no user within `userTokenWaitTimeout`), `token_invalid`, `token_expired`, and the provider renewing an expired token |

## 1. Install

```bash
cd Example
npm install
```

## 2. Keys and URLs

Never put real keys in a committed file. Copy the template:

```bash
cp .env.example .env    # git-ignored
```

| Variable | What to put |
| --- | --- |
| `EXPO_PUBLIC_RIVIUM_API_KEY` | The project's **public** key, `rv_live_…` (Console › Project settings › API keys). Never the server secret `rv_srv_…`: everything `EXPO_PUBLIC_` ends up inside the app. |
| `EXPO_PUBLIC_RIVIUM_TOKEN_URL` | Your token server's endpoint. `POST {"userId": "...", "expiresIn": 3600}` → `{"token": "..."}`. |
| `EXPO_PUBLIC_RIVIUM_SIGNED_URL_ENDPOINT` | Optional. Your server's signed-link endpoint. `POST {"fileId": "...", "expiresIn": 600}` → `{"url": "..."}`. |
| `EXPO_PUBLIC_RIVIUM_PUBLIC_BUCKET` / `..._PRIVATE_BUCKET` | Test bucket names (or ids), see step 3. |
| `EXPO_PUBLIC_RIVIUM_TEST_USER_ID` | The user id the app signs in as. |

Expo bakes these into the bundle when it is built, so restart Metro
(`npx expo start --clear`) or rebuild after changing `.env`. You can also edit
every value on the phone (Setup screen); edits stay on that phone until `.env`
changes.

### The token server

The app never holds the server secret. Your server checks its own session,
mints a Rivium user token with the server secret (`createUserToken(userId)` in
`@rivium/storage-node`, or `POST https://auth.rivium.co/users/token`) and
returns it. The Node.js example in `../../nodejs/Example` is that server: copy its
`.env.example` to `.env` (API key + server secret), set `HOST=0.0.0.0` and
`ALLOWED_HOSTS=<your Mac's LAN address>` for a real phone, run `npm run server`
(port 4000), and use that address (`http://192.168.x.x:4000/token`,
`.../signed-url`). Anyone on that network can then get user tokens for the
project, so use a TEST project; the server can also require a shared
`DEMO_TOKEN` (sent as the `x-demo-token` header; add it to `postJson` in
`src/model.tsx` if you turn it on). The app also uses its
`/signed-upload` and `/confirm-upload` next to `/token`. Android emulator:
`10.0.2.2`; iOS simulator: `localhost`.

Plain HTTP is allowed for local addresses on iOS (`NSAllowsLocalNetworking`)
and, on Android, for **every** address (`usesCleartextTraffic: true` in
`app.json` through `expo-build-properties`, which has no option to limit it to
`localhost` / `10.0.2.2`). That is for this example and a local test server
only: remove it in a real app, and use HTTPS for your token server.

## 3. Test buckets

Every Rivium Storage example uses the same two buckets. The Node.js example
creates them (once; safe to repeat):

```bash
cd ../../nodejs/Example && npm run setup-buckets   # or POST /setup-test-buckets on its server
```

Or create them by hand in the Console › Rivium Storage:

1. **`rivium-example-public`**: visibility **public**, any file type, **Block
   executable files** on, access rules from the **userFolders** template.
2. **`rivium-example-private-images`**: visibility **private**, allowed types
   JPEG / PNG / GIF / WebP, max file size **1 MB**, **Block executable files**
   on, access rules from the **userFolders** template.

userFolders: a signed-in user reads and lists the whole bucket, and uploads and
deletes only under `users/{their user id}/`, so the example puts every file
under `users/<you>/example/`.

File calls always need a signed-in user: while no one is signed in they wait
(`isAwaitingUserToken`) and go on after sign-in.

## 4. Run on a phone (debug and release)

The app uses native modules (image picker, file system), so build it with
`expo run` (a development build), not Expo Go:

```bash
npm run ios                # debug, iOS (add --device to pick a phone)
npm run android            # debug, Android
npm run ios:release        # expo run:ios --configuration Release
npm run android:release    # expo run:android --variant release
```

`expo run` creates `ios/` and `android/` (git-ignored). Release builds embed
the JS bundle Metro makes from `../src` at build time, so rebuild after an SDK
change.

Checks without a phone:

```bash
npm run typecheck          # tsc --noEmit, against ../src
npm run bundle:check       # expo export for iOS and Android (Metro resolves ../src)
```

## 5. Check an SDK build quickly

Open **Run all checks** and tap the button. It signs in as the test user,
uploads, reads, lists (two pages), downloads and compares bytes, transforms,
opens a signed link and a public link without headers, uploads and finds a
Unicode file name, uploads a ~5 MB PNG of noise pixels and checks its upload progress
reaches 100%, uploads `.json` / `.csv` / `.md` files with no `contentType` and checks
the stored type, checks the main errors by their `code` (`type_not_allowed`,
`executable_blocked`, …), deletes, and removes every file it created.

**Bucket setup** runs first: it reads both test buckets with the SDK and compares them with what the checks expect (public bucket: public, allows PNG, PDF, TXT, JSON, CSV and Markdown, where no allowed types means any; private bucket: private, images only, max 1 MB; both: Block executable files on), which is exactly what `npm run setup-buckets` in `sdk/nodejs/Example` creates. When they match it passes; otherwise it shows **WARN** with each difference and the Console setting to change (`Console › Storage › Buckets › <name> › Settings › …`), and every check that needs that setting (type not allowed, HTML declared as image/png, `executable_blocked`, upload progress, file types, the PDF / text uploads) is skipped with the same hint instead of failing. A field an older Storage API doesn't send (`blockExecutables`) counts as unknown, not wrong. Against an older Storage API that refuses without an error `code`, the error checks accept the 400 with the known message and add "server sent no code (older Storage API)".

## Showing images: the short version

- Public bucket: GET `storage.getUrl(fileId)` with the `x-api-key` header once;
  it answers `{"url": "..."}`, a link that needs no headers.
- Private bucket: `download()` and show the bytes (a `data:` URI), or ask your
  server for a signed link.
- Transforms: `<Image source={{ uri: storage.getTransformUrl(id, {...}), headers: { 'x-api-key': ..., 'x-user-token': ... } }} />`.
- Never `<Image source={{ uri: storage.getUrl(id) }} />`: that address needs
  the `x-api-key` header and answers JSON, not an image.
