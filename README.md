<p align="center">
  <a href="https://rivium.co">
    <img src="https://rivium.co/logo.png" alt="Rivium" width="120" />
  </a>
</p>

<h3 align="center">Rivium Storage React Native SDK</h3>

<p align="center">
  File storage and image transformation SDK for React Native with upload, download, and on-the-fly image processing.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rivium/storage-react-native"><img src="https://img.shields.io/npm/v/@rivium/storage-react-native.svg" alt="npm" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.0+" />
  <img src="https://img.shields.io/badge/React_Native-0.60+-61DAFB?logo=react&logoColor=black" alt="React Native 0.60+" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" />
</p>

---

## Installation

```bash
npm install @rivium/storage-react-native
```

## Quick Start

```typescript
import { RiviumStorage } from '@rivium/storage-react-native';

// Initialize. File requests need a signed-in user: pass a token provider
// (Rivium Auth's, or your server's - see "Sign users in" below).
const storage = new RiviumStorage({
  apiKey: 'YOUR_API_KEY',
  tokenProvider: () => auth.getToken(),
});

// Upload a file
const file = await storage.upload('my-bucket-id', 'images/photo.jpg', imageData, {
  contentType: 'image/jpeg',
});
console.log('Uploaded:', file.id);

// Download a file
const data = await storage.download(file.id);

// Generate a transform URL (200x200 WebP thumbnail)
const url = storage.getTransformUrl(file.id, {
  width: 200,
  height: 200,
  format: 'webp',
});

// Delete a file
await storage.delete(file.id);
```

## Show images

**Public buckets: one link, no headers.** `getPublicUrl` with image options
returns the file's public link with those options, for example
`https://storage.rivium.co/public/<bucketId>/<path>?w=600&f=webp`. It needs no
key, user token or header, so it goes straight into `<Image source={{ uri }}>` or any image component:

```tsx
import { Image } from 'react-native';
import { publicImageUrl } from '@rivium/storage-react-native';

// A 600 px wide WebP, straight into <Image>: no headers
const url = await storage.getPublicUrl(file.id, { width: 600, format: 'webp' });
<Image source={{ uri: url }} style={{ width: 300, height: 200 }} />;

// A public link you stored earlier: the same URL, no request
const thumb = publicImageUrl(savedLink, { width: 200, height: 200, fit: 'cover', format: 'webp' });
```

- **Cached.** The same options always give the same URL (the SDK writes them in
  a fixed order), and the CDN and Rivium Storage keep each size / format of an
  image once: later views come from the cache and don't count as a new
  transform. Replacing the file's content updates the image (copies already in
  a browser or CDN cache can show the old one for up to a day).
- **Use a few fixed sizes.** One image keeps at most 50 variants (different
  option combinations). A new combination beyond that is refused with
  `too_many_variants` (429); the existing ones keep working. Pick a few sizes
  (for example 200, 600 and 1200 wide) instead of the exact size of every view.
- **Plan.** On a plan without image transforms (Free) the image URL answers
  `plan_feature_locked` (403). The plain public link, without options, always
  works.
- **Busy.** When image processing is busy the URL answers `transform_busy`
  (503, with a `Retry-After` header in seconds). `<Image>` calls `onError`: load it again (for example on a retry tap). When you `fetch` the URL yourself, retry after `Retry-After` seconds.
- **Already have the public link?** `publicImageUrl` builds the same URL from it
  without a request: store the public link once and make sizes as you need
  them. It checks the options the same way.
- **Private buckets** have no public link (`getPublicUrl` fails with 403).
  Load the image with `getTransformUrl` and your headers (unchanged, see below), `download` it, or show it from a signed link your server makes.

## Upload progress

Pass `onProgress` to show how much of a file has been sent (iOS and Android).
The last call has `bytesSent === totalBytes`.

```typescript
const file = await storage.upload('my-bucket-id', 'videos/clip.mp4', videoData, {
  contentType: 'video/mp4',
  onProgress: ({ bytesSent, totalBytes }) => {
    setProgress(bytesSent / totalBytes); // 0 to 1
  },
});
```

`totalBytes` is the size of the whole request, so it is a little larger than
the file.

## File types

When you don't pass `contentType`, the SDK picks it from the path's extension,
using the same list of formats the Console offers in a bucket's allowed types
(`.md` → `text/markdown`, `.csv` → `text/csv`, `.heic` → `image/heic`,
`.wav` → `audio/vnd.wave`, …). An explicit `contentType` always wins. An extension
that isn't in the list is sent as `application/octet-stream`, and Rivium Storage
then goes by the extension and the file's content. `contentTypeForPath(path)`
returns the type the SDK would send.

A format the bucket doesn't allow is refused with the `type_not_allowed` code
(see below): turn it on in the Console under Storage › your bucket › Settings.

## Handling errors

A refused request throws a `RiviumStorageException` with the server's `message`, the HTTP
`statusCode` and a `code` you can switch on:

```typescript
import { RiviumStorageException, StorageErrorCode } from '@rivium/storage-react-native';

try {
  await storage.upload('my-bucket-id', 'notes/today.md', '# Today');
} catch (e) {
  if (!(e instanceof RiviumStorageException)) throw e;
  switch (e.code) {
    case StorageErrorCode.TypeNotAllowed:    // 400: the bucket doesn't allow this format
    case StorageErrorCode.FileTooLarge:      // 400: larger than the bucket's size limit
    case StorageErrorCode.ExecutableBlocked: // 400: the bucket blocks executable files
      console.warn(e.message);
      break;
    case StorageErrorCode.PathTaken:         // 409: a file already exists at this path
      break;
    case StorageErrorCode.InvalidPath:       // 400, nothing sent: a '.' / '..' / empty path segment
      break;
    case StorageErrorCode.TokenRequired:     // 401: no user signed in within userTokenWaitTimeout
    case StorageErrorCode.TokenInvalid:
    case StorageErrorCode.TokenExpired:
      break;
    default:
      if (e.code === StorageErrorCode.AccessDenied) { /* denied by the bucket's access rules */ }
  }
}
```

The SDK never follows a redirect. Paths, ids and image transform options are checked before anything is
sent: see [Paths, links and image transforms](#paths-links-and-image-transforms).

## What the answers contain

A `StorageFile` has `id`, `bucketId`, `path`, `fileName`, `mimeType`, `size`, `checksum`, `metadata`,
`uploadedBy`, `uploadedAt`, `createdAt` and `updatedAt` (`checksum`, `metadata`, `uploadedBy` and `uploadedAt` are
`null` when empty). A `Bucket` has `id`, `name`, `description`, `visibility`, `allowedMimeTypes` (`null` = every
type), `maxFileSize`, `blockExecutables`, `createdAt` and `updatedAt`. Dates are ISO 8601 strings. `listFiles()`
answers `{ files, nextCursor }`, with `nextCursor` `null` on the last page.

## Paths, links and image transforms

- **Paths.** Pass paths as you write them: each part is percent-encoded for you,
  so spaces, `?`, `#`, `%` and other scripts are fine when you read or delete by
  path. Leading, trailing and repeated `/` are dropped, as the server stores
  paths (`/a//b/` is `a/b`). A `.` or `..` part (also written `%2e`) is refused
  with `invalid_path` before anything is sent. An empty bucket, file id or path
  fails at once with `bucket_required`, `file_id_required` or `path_required`.
- **New files.** An upload path can't contain `?`, `#`, `%`, text-direction
  characters or a `.` / `..` part: the SDK refuses it with `invalid_path` (and
  the server's message) before sending anything.
- **Public link.** `await storage.getPublicUrl(fileId)` returns
  `https://storage.rivium.co/public/<bucketId>/<path>` for a file in a
  **public** bucket. Anyone can open it without a key or token, so it goes
  straight into `<Image source={{ uri }} />` or a browser. A file in a private bucket has no public link
  (`403`): use `download`, or a signed link from your server.
- **Public image links.** With image options, `getPublicUrl` returns a
  resized / converted image URL that needs no headers, and `publicImageUrl`
  builds it from a stored public link: see [Show images](#show-images).
- **API addresses.** `getUrl`, `getDownloadUrl` and `getTransformUrl` return
  `/api/v1` addresses. They need the `x-api-key` header (and the user token
  where your rules ask for one), so load them with an HTTP client that sends
  headers, never as a plain image URL.
- **Image transforms.** `format`: `jpeg` (default), `png`, `webp` or `avif`;
  `fit`: `cover`, `contain`, `fill`, `inside` or `outside`; `width` / `height`:
  1 or more (above 4096 sent as 4096); `quality`: 1-100; `blur`: 0-20;
  `sharpen`: 0-10; `rotate`: degrees. `getTransformUrl` throws `invalid_transform` for anything else, before building the URL. Images over 25 MB can't be
  transformed (`source_too_large`); see [Handling transform errors](#handling-transform-errors) for why else a transform can fail.

```typescript
const link = await storage.getPublicUrl(file.id); // public bucket only
// "https://storage.rivium.co/public/<bucketId>/photos/my%20cat.png"
<Image source={{ uri: link }} />

const thumb = storage.getTransformUrl(file.id, { width: 200, height: 200, fit: 'cover', format: 'webp' });
// load with the x-api-key header
```

### Handling transform errors

The SDK builds the transform URL; your app fetches it. When the image can't be
made, the answer is JSON instead of an image, with `statusCode`, `code` and a
`message` you can show to your users. Read `code` to decide what to do:

`<Image>` only reports that loading failed. To tell the user why, fetch the
same URL with the headers and read the body:

```typescript
const res = await fetch(thumb, { headers: { 'x-api-key': API_KEY } }); // + x-user-token when signed in
if (!res.ok) {
  const { code, message } = await res.json().catch(() => ({}));
  switch (code) {
    case StorageErrorCode.NotAnImage: showError('Pick an image file.'); break;
    case StorageErrorCode.ImageDamaged: showError('Upload it again.'); break;
    default: showError(message ?? `HTTP ${res.status}`);
  }
}
```

| Status | `code` | What the message says |
| --- | --- | --- |
| 415 | `image_format_not_supported` | This image format can't be resized: BMP. Supported: JPEG, PNG, WebP, GIF, AVIF, HEIC, TIFF, SVG. |
| 400 | `not_an_image` | This file isn't an image (application/pdf), so it can't be resized. |
| 422 | `image_damaged` | The image is damaged or incomplete (it may not have finished uploading). |
| 413 | `image_too_large` | This image is 12000×9000 (108 MP); images up to 50 MP can be resized. |
| 413 | `source_too_large` | The image is over 25 MB. |
| 400 | `invalid_transform` | An option isn't allowed (the message names it). |
| 503 | `transform_busy` | Image processing is busy. Try again in a moment. (Retry after the `Retry-After` header's seconds.) |
| 429 | `too_many_variants` | Public image URLs: this image already has 50 sizes / formats. Use one of the sizes you already use. |
| 403 | `plan_feature_locked` | Image transforms aren't included in this project's plan. Upgrade to use them. |

## Sign users in (one token for every Rivium product)

Signed Rivium user tokens are required for file requests; the SDK waits for a
token until your app signs a user in (`isAwaitingUserToken` /
`onAwaitingUserToken`, optional `userTokenWaitTimeout`). The legacy
`userId` / `setUserId` and `x-user-id` are removed.

One Rivium user token identifies your signed-in user in every Rivium product
(Storage, Sync, Chat, Push, A/B Testing), so your bucket rules can trust who
the user is. Storage sends it as `x-user-token`. Listing and reading buckets
(`listBuckets`, `getBucket`, `getBucketByName`) and `getPublicUrl` need no
user and never wait.

### Sign users in with Rivium Auth

[Rivium Auth](https://rivium.co/cloud/rivium-auth/docs/other-products)
(`@rivium/auth-react-native`) signs users in with only your public key, and its token is the
Rivium user token. Pass its provider; no server needed:

```typescript
import * as Keychain from 'react-native-keychain';
import { createRiviumAuth, keychainStorage } from '@rivium/auth-react-native';
import { RiviumStorage } from '@rivium/storage-react-native';

const auth = createRiviumAuth({ apiKey: 'YOUR_API_KEY', storage: keychainStorage(Keychain) });

const storage = new RiviumStorage({
  apiKey: 'YOUR_API_KEY',
  tokenProvider: () => auth.getToken(), // null while signed out: file calls wait
});

// After a sign-in, sign-out or switch of user, ask the provider again.
auth.onAuthStateChanged(() => {
  storage.refreshUserToken();
});
```

### Or mint tokens on your own server

For your own user ids, mint the token on **your server** with your API key
and server secret (never put the server secret in an app):

```typescript
// Express example, behind your own session check
app.post('/rivium-token', async (req, res) => {
  const r = await fetch('https://auth.rivium.co/users/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.RIVIUM_API_KEY!,
      'x-server-secret': process.env.RIVIUM_SERVER_SECRET!,
    },
    body: JSON.stringify({ userId: req.session.userId /*, expiresIn: 3600 */ }),
  });
  const { token, expiresAt } = await r.json();
  res.json({ token, expiresAt });
});
```

With the Node SDK this is one call: `await storage.createUserToken(userId)`.
The app then gives the SDK a provider that calls your endpoint:

```typescript
import { RiviumStorage } from '@rivium/storage-react-native';

const storage = new RiviumStorage({
  apiKey: 'YOUR_API_KEY',
  tokenProvider: async () => {
    const res = await fetch('https://your-server.example/rivium-token', { method: 'POST' });
    if (!res.ok) return null; // no one signed in: file calls wait
    return (await res.json()).token;
  },
});
```

### How the token is used

The SDK asks the provider before the first file request, keeps the token,
replaces it shortly before it expires, and if the server answers
`token_expired` or `token_invalid` it asks once more and retries the request
once. Concurrent requests share one provider call.

- **No token yet: file calls wait.** With no token held and the provider
  returning `null` (nobody signed in), `upload`, `listFiles`, `getFile`,
  `getFileByPath`, `download`, `delete`, `deleteByPath` and `deleteMany`
  send nothing and don't fail: they wait. `isAwaitingUserToken`
  is `true` meanwhile, and `onAwaitingUserToken(callback)` is called once each
  time calls start waiting (it returns a function that removes the callback),
  so you can show your sign-in screen. Upload progress starts only when the
  upload is sent.
- After sign-in, call `await storage.refreshUserToken()` (the provider now
  returns a token) or `await storage.setUserToken(token)`: every waiting call
  goes on, in the order it was made. `setUserToken(null)` (sign-out) leaves
  waiting calls waiting.
- `userTokenWaitTimeout` (milliseconds, no limit by default) makes a waiting
  call fail instead, with a `RiviumStorageException` whose `code` is
  `token_required` (`StorageErrorCode.TokenRequired`, status 401).
- If the server answers `token_required`, the call goes back to waiting.
- The request `timeout` covers each request, never the wait for a token.
- `getUrl`, `getTransformUrl` and `getDownloadUrl` return API addresses that
  need your key and the user token; see [Paths, links and image transforms](#paths-links-and-image-transforms).
- Managing buckets, access rules and signed links is for your server (Node
  SDK with the server secret): from an app it is refused with
  `server_secret_required` (403).

## Features

- **File Upload & Download** — Upload from string, Uint8Array, or base64 with metadata and upload progress
- **Bucket Management** — List, get by ID or name
- **Links** — Public links for public buckets (`getPublicUrl`), plus download and transform addresses
- **Image Transformations** — Resize, crop, format conversion, blur, sharpen, rotate
- **Policy Enforcement** — User-scoped access control with a signed Rivium user token (`tokenProvider`, Rivium Auth or your server); file calls wait until a user is signed in
- **TypeScript First** — Full type definitions included
- **Zero Dependencies** — Built on fetch and XMLHttpRequest, works on iOS and Android

## Documentation

For full documentation, visit [rivium.co/docs](https://rivium.co/cloud/rivium-storage/docs/reactnative).
- [Rivium Cloud](https://rivium.co/cloud)
- [Rivium Console](https://console.rivium.co)

## License

MIT License — see [LICENSE](LICENSE) for details.
