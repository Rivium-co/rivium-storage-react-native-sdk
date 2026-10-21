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

// Initialize
const storage = new RiviumStorage({ apiKey: 'YOUR_API_KEY' });

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

## Sign users in (one token for every Rivium product)

One Rivium user token identifies your signed-in user in every Rivium product
(Storage, Sync, Chat, Push, A/B Testing). Storage sends it as `x-user-token` on
every request.

### 1. Your server mints the token

The token is signed by Rivium, so your bucket rules can trust who the user is.
Mint it on **your server** with your API key and server secret (never put the
server secret in an app):

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

With the Node SDK this is one call: `await storage.createUserToken(userId)`
(`@rivium/storage-node` 0.2.0+). Using **Rivium Auth**? Its sign-in token is
the same token: pass it as is, no server endpoint needed.

### 2. The app gives the SDK a token provider

```typescript
import { RiviumStorage } from '@rivium/storage-react-native';

const storage = new RiviumStorage({
  apiKey: 'YOUR_API_KEY',
  tokenProvider: async () => {
    const res = await fetch('https://your-server.example/rivium-token', { method: 'POST' });
    if (!res.ok) return null; // no one signed in
    return (await res.json()).token;
  },
});
```

The SDK asks for the token before the first request, keeps it, replaces it
shortly before it expires, and if the server answers `token_expired` or
`token_invalid` it asks once more and retries the request once. Concurrent
requests share one provider call.

- Call `await storage.refreshUserToken()` when the user signs in or out.
- `await storage.setUserToken(token)` sets a token you already hold (`null` clears it).
- If the project requires a user and none is available, requests fail with a
  `RiviumStorageException` whose `code` is `token_required`.
- `userId` / `setUserId()` still work (sent as `x-user-id`) but the server can't
  verify a client-chosen id: use `tokenProvider`. When a token is sent,
  `x-user-id` is not.
- `getUrl`, `getTransformUrl` and `getDownloadUrl` return plain URLs, which
  can't carry the token: use them for public buckets or signed URLs, and
  `download()` for private files.

## Features

- **File Upload & Download** — Upload from string, Uint8Array, or base64 with metadata
- **Bucket Management** — List, get by ID or name
- **URL Generation** — Public URLs, download URLs, and transform URLs
- **Image Transformations** — Resize, crop, format conversion, blur, sharpen, rotate
- **Policy Enforcement** — User-scoped access control with a Rivium user token (`tokenProvider`); legacy `userId` still supported
- **TypeScript First** — Full type definitions included
- **Zero Dependencies** — Pure fetch-based, works on iOS and Android

## Documentation

For full documentation, visit [rivium.co/docs](https://rivium.co/cloud/rivium-storage/docs/reactnative).
- [Rivium Cloud](https://rivium.co/cloud)
- [Rivium Console](https://console.rivium.co)

## License

MIT License — see [LICENSE](LICENSE) for details.
