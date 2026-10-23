// Rivium Storage file types (version 1): the content type sent for each file
// extension when the app passes no contentType.
//
// MUST MATCH RiviumConsole/docs/storage-redesign/FILE-TYPES.md ("Send this type" column, JSON block):
// the same list the Console offers in a bucket's allowed types and the server stores. Generated from
// that file; change the table there first, then regenerate this map in every SDK.

/** Version of the shared file-types list this map was built from. */
export const FILE_TYPES_VERSION = 1;

/** The type sent for an extension the table doesn't know; the server then uses the extension itself. */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** Lower-case extension (no dot) → the content type to send (the type the server stores). */
export const CONTENT_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  md: 'text/markdown',
  markdown: 'text/markdown',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/vnd.wave',
  m4a: 'audio/x-m4a',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/x-flac',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  rar: 'application/x-rar-compressed',
  svg: 'image/svg+xml',
  html: 'text/html',
  htm: 'text/html',
  xhtml: 'application/xhtml+xml',
});

/**
 * The extension of a storage path: lower case, no dot, from the last `.` of the
 * last path segment. `''` when there is none (`README`, `.env`, `photos.v2/raw`).
 */
export function fileExtension(path: string): string {
  const segment = path.slice(path.lastIndexOf('/') + 1);
  const dot = segment.lastIndexOf('.');
  if (dot <= 0 || dot === segment.length - 1) return '';
  return segment.slice(dot + 1).toLowerCase();
}

/**
 * The content type for a storage path from its extension (case-insensitive), as listed in
 * the Rivium Storage file types table; `application/octet-stream` when the extension is
 * not in the table.
 *
 * @example contentTypeForPath('notes/Today.MD') // 'text/markdown'
 */
export function contentTypeForPath(path: string): string {
  const ext = fileExtension(path);
  return ext && Object.prototype.hasOwnProperty.call(CONTENT_TYPES_BY_EXTENSION, ext)
    ? CONTENT_TYPES_BY_EXTENSION[ext]
    : DEFAULT_CONTENT_TYPE;
}
