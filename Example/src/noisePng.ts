/**
 * A real PNG of random-noise pixels, made in plain TypeScript (React Native has no canvas).
 *
 * Used by the upload progress demo: noise does not compress, so the file is about
 * width x height x 3 bytes (1300x1300 is ~4.8 MB) and the progress bar visibly moves.
 * It is a real image/png, so buckets that allow only images accept it (random bytes
 * would be application/octet-stream, which they refuse).
 *
 * PNG layout: signature, IHDR (size, 8-bit RGB), one IDAT, IEND. Each chunk is
 * length + type + data + CRC-32. The IDAT holds a zlib stream whose deflate blocks
 * are STORED (not compressed, at most 65535 bytes each), followed by Adler-32.
 * The image data is one filter byte (0 = none) at the start of every row, then RGB.
 */
import { RiviumStorageException, StorageErrorCode } from '@rivium/storage-react-native';
import { legacyMatch } from './bucket-setup';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 over the chunk type + data, as PNG wants it. */
function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 of the uncompressed data (the zlib trailer). */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  const NMAX = 5552; // the most bytes before the sums must be reduced (keeps them exact)
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(bytes.length, i + NMAX);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function makeNoisePng(width = 1300, height = 1300): Uint8Array {
  // 1. Raw image data: per row a filter byte 0, then random R, G, B.
  const rowBytes = width * 3 + 1;
  const raw = new Uint8Array(rowBytes * height);
  for (let i = 0; i < raw.length; i += 4) {
    const r = (Math.random() * 0x100000000) >>> 0;
    raw[i] = r & 0xff;
    raw[i + 1] = (r >>> 8) & 0xff;
    raw[i + 2] = (r >>> 16) & 0xff;
    raw[i + 3] = r >>> 24; // writes past the end of a typed array are ignored
  }
  for (let y = 0; y < height; y++) raw[y * rowBytes] = 0;

  // 2. zlib stream: 2-byte header, stored deflate blocks (5-byte header each), Adler-32.
  const MAX_BLOCK = 65535;
  const blocks = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
  const zlibLength = 2 + blocks * 5 + raw.length + 4;

  // 3. Whole file: signature (8) + IHDR (12 + 13) + IDAT (12 + zlib) + IEND (12).
  const out = new Uint8Array(8 + 25 + 12 + zlibLength + 12);
  const view = new DataView(out.buffer);
  let p = 0;
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  p = 8;

  const chunk = (type: string, length: number, write: () => void) => {
    view.setUint32(p, length);
    const typeStart = p + 4;
    for (let i = 0; i < 4; i++) out[typeStart + i] = type.charCodeAt(i);
    p = typeStart + 4;
    write(); // writes `length` bytes and moves p
    view.setUint32(p, crc32(out, typeStart, p));
    p += 4;
  };

  chunk('IHDR', 13, () => {
    view.setUint32(p, width);
    view.setUint32(p + 4, height);
    out[p + 8] = 8; // bit depth
    out[p + 9] = 2; // colour type: RGB
    out[p + 10] = 0; // compression: deflate
    out[p + 11] = 0; // filter method
    out[p + 12] = 0; // no interlace
    p += 13;
  });

  chunk('IDAT', zlibLength, () => {
    out[p++] = 0x78; // zlib header: deflate, 32 KB window
    out[p++] = 0x01; // no preset dictionary, fastest; (0x78 << 8 | 0x01) % 31 === 0
    for (let offset = 0, n = 0; n < blocks; n++) {
      const len = Math.min(MAX_BLOCK, raw.length - offset);
      out[p++] = n === blocks - 1 ? 1 : 0; // BFINAL on the last block, BTYPE 00 = stored
      out[p++] = len & 0xff; // LEN, little-endian
      out[p++] = len >>> 8;
      out[p++] = ~len & 0xff; // NLEN = one's complement of LEN
      out[p++] = (~len >>> 8) & 0xff;
      out.set(raw.subarray(offset, offset + len), p);
      p += len;
      offset += len;
    }
    view.setUint32(p, adler32(raw));
    p += 4;
  });

  chunk('IEND', 0, () => {});
  return out;
}

/** Width and height from a PNG's signature + IHDR chunk, or null when the bytes are not a PNG. */
export function pngHeaderSize(b: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return null;
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** The progress demo's PNG was refused because the bucket doesn't allow image/png (400 "... is not allowed in this bucket"). */
export function isPngNotAllowed(e: unknown): boolean {
  return isTypeNotAllowed(e);
}

/** The bucket refused the file's format (the SDK error's code, not its message text). */
export function isTypeNotAllowed(e: unknown): boolean {
  if (!(e instanceof RiviumStorageException)) return false;
  // An older Storage API refuses with the same message but no code.
  return e.code === StorageErrorCode.TypeNotAllowed || legacyMatch('type_not_allowed', e.statusCode, e.code, e.message);
}

export const PNG_NOT_ALLOWED =
  "This bucket doesn't allow image/png. Allow PNG in the Console (Bucket › Settings › Allowed file types) to run this check.";
