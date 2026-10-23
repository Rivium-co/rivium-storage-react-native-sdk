import { RiviumStorageException } from './models';

/**
 * Checks for the values that go into a request: paths and ids in URLs, upload
 * paths in the body, and image transform options. Every refusal is a 400 with
 * a `code` (see `StorageErrorCode`) and is thrown before anything is sent.
 *
 * URL parsers (fetch, node-fetch, the WHATWG URL class) resolve `.` and `..`
 * segments, including the encoded `%2e` forms, so an unchecked `a/../../x`
 * would send the request to a different endpoint. Dot segments are refused,
 * and everything else is percent-encoded so it reaches the server as the exact
 * text the app passed. The same rules are in every Rivium Storage SDK.
 */

const INVALID_PATH = 'invalid_path';
const INVALID_TRANSFORM = 'invalid_transform';

export const DOT_PATH_MESSAGE = "File paths can't contain '.' or '..' segments";
export const DOT_ID_MESSAGE = "Ids and bucket names can't be empty, '.' or '..'";
export const URL_UNSAFE_PATH_MESSAGE = "Path can't contain '?', '#' or '%'";
export const BIDI_PATH_MESSAGE = "Path can't contain text-direction characters";

/** `?` and `#` end the path part of a URL; `%` could turn `%2e%2e` into `..`. New paths can't contain them. */
const URL_UNSAFE = /[?#%]/;
/** Text-direction marks would make a name look different from what it is. */
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

function refuse(message: string, code: string): RiviumStorageException {
  return new RiviumStorageException(message, 400, code);
}

/** True when the value is missing, empty, or only spaces and `/`. */
export function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.replace(/[\s/]/g, '') === '';
}

/** Throws `code` (400) when `value` is blank. */
function required(value: unknown, code: string, message: string): asserts value is string {
  if (isBlank(value)) throw refuse(message, code);
}

/** True for `.` or `..`, also percent-encoded (`%2e`, `%2E%2e`, `%252e`...), as a URL parser or the server reads it. */
export function isDotSegment(segment: string): boolean {
  let value = segment;
  for (let i = 0; i < 4; i++) {
    if (value === '.' || value === '..') return true;
    if (!value.includes('%')) return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return false;
    }
    if (decoded === value) return false;
    value = decoded;
  }
  return false;
}

function encode(segment: string, message: string): string {
  try {
    return encodeURIComponent(segment);
  } catch {
    // A lone UTF-16 surrogate can't be encoded.
    throw refuse(message, INVALID_PATH);
  }
}

/** The non-empty `/`-separated segments of a path (leading, trailing and repeated `/` dropped, as the server does). */
function segmentsOf(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

/**
 * A file path for a URL. Leading, trailing and repeated `/` are dropped (as
 * the server stores paths); each segment is percent-encoded (`%` becomes
 * `%25`, `?` `%3F`, `#` `%23`, a space `%20`, other scripts as UTF-8).
 * Throws `path_required` when no name is left and `invalid_path` for a `.` or
 * `..` segment (also written as `%2e`).
 */
export function encodePathSegments(path: string): string {
  required(path, 'path_required', 'A file path is required');
  const segments = segmentsOf(path);
  if (segments.some(isDotSegment)) throw refuse(DOT_PATH_MESSAGE, INVALID_PATH);
  return segments.map((s) => encode(s, DOT_PATH_MESSAGE)).join('/');
}

/**
 * The path of a NEW file (upload, signed upload), normalised the way the
 * server stores it: leading, trailing and repeated `/` dropped. Throws
 * `path_required` when no name is left, and `invalid_path` for `?`, `#`, `%`,
 * text-direction characters or a `.` / `..` segment, with the server's
 * messages, so the app gets the error without a request.
 */
export function checkUploadPath(path: string): string {
  required(path, 'path_required', 'A file path is required');
  if (URL_UNSAFE.test(path)) throw refuse(URL_UNSAFE_PATH_MESSAGE, INVALID_PATH);
  if (BIDI.test(path)) throw refuse(BIDI_PATH_MESSAGE, INVALID_PATH);
  const segments = segmentsOf(path);
  if (segments.some(isDotSegment)) throw refuse(DOT_PATH_MESSAGE, INVALID_PATH);
  return segments.join('/');
}

/** A bucket id or name as one URL segment: `bucket_required` when blank, `invalid_path` for `.` / `..`. */
export function bucketSegment(value: string): string {
  required(value, 'bucket_required', 'A bucket id or name is required');
  return encodeSegment(value);
}

/** A file id as one URL segment: `file_id_required` when blank, `invalid_path` for `.` / `..`. */
export function fileIdSegment(value: string): string {
  required(value, 'file_id_required', 'A file id is required');
  return encodeSegment(value);
}

/**
 * A single id or name (policy id, upload id, ...) for a URL: the whole value
 * percent-encoded as one segment, so a `/` in it becomes `%2F`. Throws
 * `invalid_path` (400) when it is empty, `.` or `..`.
 */
export function encodeSegment(value: string): string {
  if (typeof value !== 'string' || value === '' || isDotSegment(value)) throw refuse(DOT_ID_MESSAGE, INVALID_PATH);
  return encode(value, DOT_ID_MESSAGE);
}

/** Output formats the transform endpoint makes. */
export const TRANSFORM_FORMATS = ['jpeg', 'png', 'webp', 'avif'] as const;
/** Resize modes of the transform endpoint. */
export const TRANSFORM_FITS = ['cover', 'contain', 'fill', 'inside', 'outside'] as const;
/** Largest width / height; bigger values are sent as this (the server does the same). */
export const MAX_TRANSFORM_DIMENSION = 4096;

interface TransformInput {
  width?: number;
  height?: number;
  fit?: string;
  format?: string;
  quality?: number;
  blur?: number;
  sharpen?: number;
  rotate?: number;
}

/**
 * The query parameters for image transform options, in a fixed order. Throws
 * `invalid_transform` (400) for anything the server would refuse: `format`
 * not jpeg / png / webp / avif (`jpg` is sent as `jpeg`), `fit` not cover /
 * contain / fill / inside / outside, `width` / `height` below 1, `quality`
 * outside 1..100, `blur` outside 0..20, `sharpen` outside 0..10, or a number
 * that isn't whole. Widths and heights above 4096 are sent as 4096.
 */
export function transformParams(transforms?: TransformInput | null): Array<[string, string]> {
  const params: Array<[string, string]> = [];
  if (!transforms) return params;
  const bad = (message: string) => refuse(message, INVALID_TRANSFORM);
  const whole = (name: string, value: unknown): number | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value)) throw bad(`${name} must be a whole number`);
    return value;
  };
  const range = (name: string, value: unknown, min: number, max: number): number | undefined => {
    const n = whole(name, value);
    if (n !== undefined && (n < min || n > max)) throw bad(`${name} must be between ${min} and ${max}`);
    return n;
  };
  const size = (name: string, value: unknown): number | undefined => {
    const n = whole(name, value);
    if (n === undefined) return undefined;
    if (n < 1) throw bad(`${name} must be at least 1`);
    return Math.min(n, MAX_TRANSFORM_DIMENSION);
  };
  const oneOf = (name: string, value: unknown, allowed: readonly string[]): string | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    let v = typeof value === 'string' ? value.toLowerCase() : '';
    if (name === 'format' && v === 'jpg') v = 'jpeg';
    if (!allowed.includes(v)) throw bad(`${name} must be one of ${allowed.join(', ')}`);
    return v;
  };

  const width = size('width', transforms.width);
  const height = size('height', transforms.height);
  const fit = oneOf('fit', transforms.fit, TRANSFORM_FITS);
  const format = oneOf('format', transforms.format, TRANSFORM_FORMATS);
  const quality = range('quality', transforms.quality, 1, 100);
  const blur = range('blur', transforms.blur, 0, 20);
  const sharpen = range('sharpen', transforms.sharpen, 0, 10);
  const rotate = whole('rotate', transforms.rotate);

  if (width !== undefined) params.push(['w', String(width)]);
  if (height !== undefined) params.push(['h', String(height)]);
  if (fit !== undefined) params.push(['fit', fit]);
  if (format !== undefined) params.push(['f', format]);
  if (quality !== undefined) params.push(['q', String(quality)]);
  if (blur !== undefined) params.push(['blur', String(blur)]);
  if (sharpen !== undefined) params.push(['sharpen', String(sharpen)]);
  if (rotate !== undefined) params.push(['rotate', String(rotate)]);
  return params;
}

/** `?w=..&h=..` for the transform URL, or `''` when there are no options. */
export function transformQuery(transforms?: TransformInput | null): string {
  const params = transformParams(transforms);
  if (params.length === 0) return '';
  return `?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

export const PUBLIC_URL_MESSAGE =
  'Expected a public file link (https://storage.rivium.co/public/<bucketId>/<path>), as getPublicUrl() returns';

/** `https://host/public/<bucketId>/<path...>`: the public link of a file. */
const PUBLIC_LINK = /^https?:\/\/[^/?#]+\/public\/[^/?#]+\/[^?#]+$/i;

/**
 * The header-free image URL for a file in a PUBLIC bucket: its public link
 * (as `getPublicUrl()` returns it) plus the transform options, e.g.
 * `https://storage.rivium.co/public/<bucketId>/<path>?w=600&f=webp`. No
 * request is made. The options are checked and written as in
 * `transformQuery()` (only the options that are set, short names, fixed
 * order), so the same options always give the same URL, which the CDN and
 * the server cache as one image. A query or `#` already on the link is
 * dropped. Throws `invalid_transform` (400) for an option the server would
 * refuse and `invalid_path` (400) when `publicUrl` isn't a public file link.
 */
export function publicImageUrl(publicUrl: string, transforms?: TransformInput | null): string {
  const query = transformQuery(transforms);
  const base = typeof publicUrl === 'string' ? publicUrl.trim().split(/[?#]/, 1)[0] : '';
  if (!PUBLIC_LINK.test(base)) throw refuse(PUBLIC_URL_MESSAGE, INVALID_PATH);
  return `${base}${query}`;
}
