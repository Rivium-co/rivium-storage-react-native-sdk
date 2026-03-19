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
  <a href="https://www.npmjs.com/package/@rivium-storage/react-native"><img src="https://img.shields.io/npm/v/@rivium-storage/react-native.svg" alt="npm" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.0+" />
  <img src="https://img.shields.io/badge/React_Native-0.60+-61DAFB?logo=react&logoColor=black" alt="React Native 0.60+" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" />
</p>

---

## Installation

```bash
npm install @rivium-storage/react-native
```

## Quick Start

```typescript
import { RiviumStorage } from '@rivium-storage/react-native';

// Initialize
const storage = new RiviumStorage({ apiKey: 'YOUR_API_KEY' });

// Upload a file
const file = await storage.upload('my-bucket-id', 'images/photo.jpg', imageData, {
  contentType: 'image/jpeg',
});
console.log('Uploaded:', file.url ?? file.id);

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

## Features

- **File Upload & Download** — Upload from string, Uint8Array, or base64 with metadata
- **Bucket Management** — List, get by ID or name
- **URL Generation** — Public URLs, download URLs, and transform URLs
- **Image Transformations** — Resize, crop, format conversion, blur, sharpen, rotate
- **Policy Enforcement** — User-scoped access control via `userId`
- **TypeScript First** — Full type definitions included
- **Zero Dependencies** — Pure fetch-based, works on iOS and Android

## Documentation

For full documentation, visit [rivium.co/docs](https://rivium.co/cloud/rivium-storage/docs/sdks-react-native).
- [Rivium Cloud](https://rivium.co/cloud)
- [Rivium Console](https://console.rivium.co)

## License

MIT License — see [LICENSE](LICENSE) for details.
