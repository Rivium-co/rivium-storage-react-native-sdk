import { base64ToBytes, utf8 } from './bytes';
import { SAMPLE_PNG_BASE64, TINY_PNG_BASE64 } from './samplePngs';
import { makeNoisePng } from './noisePng';

/** Test content made in code, so the example needs no bundled files. */
export const Samples = {
  /** A real 240x160 PNG. */
  png: (): Uint8Array => base64ToBytes(SAMPLE_PNG_BASE64),
  /** A real 16x16 PNG. */
  tinyPng: (): Uint8Array => base64ToBytes(TINY_PNG_BASE64),

  text: (body = 'Hello from the Rivium Storage React Native example'): Uint8Array =>
    utf8(`${body}\nCreated: ${new Date().toISOString()}\n`),

  /** A minimal one-page PDF. */
  pdf: (label: string): Uint8Array => {
    const content = `BT /F1 18 Tf 24 150 Td (${label.replace(/[^ -~]|[()\\]/g, '')}) Tj ET`;
    return utf8(
      [
        '%PDF-1.4',
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
        `4 0 obj << /Length ${content.length} >> stream`,
        content,
        'endstream endobj',
        '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
        'trailer << /Root 1 0 R >>',
        '%%EOF',
        '',
      ].join('\n'),
    );
  },

  /** HTML bytes, to show that declaring image/png does not fool the server. */
  html: (): Uint8Array =>
    utf8("<!doctype html><html><body><script>alert('not an image')</script></body></html>"),

  /** First bytes of a Windows program ("MZ" header). Harmless, but recognised as an executable. */
  fakeExe: (): Uint8Array => {
    const head = utf8('MZ');
    const filler = new Uint8Array(62).fill(0x90);
    const tail = utf8('This program cannot be run in DOS mode.');
    const out = new Uint8Array(head.length + filler.length + tail.length);
    out.set(head, 0);
    out.set(filler, head.length);
    out.set(tail, head.length + filler.length);
    return out;
  },

  /** A PNG padded with zeros to `size` bytes, for the too-big test. */
  oversizedPng: (size: number): Uint8Array => {
    const png = base64ToBytes(TINY_PNG_BASE64);
    const out = new Uint8Array(Math.max(size, png.length));
    out.set(png, 0);
    return out;
  },

  /** A ~5 MB PNG of noise pixels (see noisePng.ts), for watching upload progress move. */
  noisePng: (width = 1300, height = 1300): Uint8Array => makeNoisePng(width, height),

  /** A short unique stamp for file names. */
  stamp: (): string => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.floor(100 + Math.random() * 900)}`;
  },
};
