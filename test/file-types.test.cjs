// The content type sent when the app passes no contentType: the Rivium Storage
// file types table (RiviumConsole/docs/storage-redesign/FILE-TYPES.md, "Send this
// type"). TABLE is a literal copy of that column, so a drifted map fails here.
// Runs against the compiled build: `npm test` builds first.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../dist/index.js');
const { contentTypeForPath, CONTENT_TYPES_BY_EXTENSION, DEFAULT_CONTENT_TYPE, FILE_TYPES_VERSION } = sdk;

const TABLE = [
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['gif', 'image/gif'],
  ['heic', 'image/heic'],
  ['heif', 'image/heif'],
  ['bmp', 'image/bmp'],
  ['pdf', 'application/pdf'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['ppt', 'application/vnd.ms-powerpoint'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['odt', 'application/vnd.oasis.opendocument.text'],
  ['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['odp', 'application/vnd.oasis.opendocument.presentation'],
  ['rtf', 'application/rtf'],
  ['txt', 'text/plain'],
  ['csv', 'text/csv'],
  ['json', 'application/json'],
  ['md', 'text/markdown'],
  ['markdown', 'text/markdown'],
  ['xml', 'application/xml'],
  ['yaml', 'text/yaml'],
  ['yml', 'text/yaml'],
  ['mp4', 'video/mp4'],
  ['m4v', 'video/x-m4v'],
  ['mov', 'video/quicktime'],
  ['webm', 'video/webm'],
  ['mkv', 'video/x-matroska'],
  ['mp3', 'audio/mpeg'],
  ['wav', 'audio/vnd.wave'],
  ['m4a', 'audio/x-m4a'],
  ['aac', 'audio/aac'],
  ['ogg', 'audio/ogg'],
  ['oga', 'audio/ogg'],
  ['opus', 'audio/opus'],
  ['flac', 'audio/x-flac'],
  ['zip', 'application/zip'],
  ['7z', 'application/x-7z-compressed'],
  ['tar', 'application/x-tar'],
  ['gz', 'application/gzip'],
  ['tgz', 'application/gzip'],
  ['rar', 'application/x-rar-compressed'],
  ['svg', 'image/svg+xml'],
  ['html', 'text/html'],
  ['htm', 'text/html'],
  ['xhtml', 'application/xhtml+xml'],
];

test('the map is exactly the FILE-TYPES.md table (version 1)', () => {
  assert.equal(FILE_TYPES_VERSION, 1);
  assert.equal(TABLE.length, 51);
  assert.deepEqual({ ...CONTENT_TYPES_BY_EXTENSION }, Object.fromEntries(TABLE));
});

test('every extension maps to its primary type', () => {
  for (const [ext, type] of TABLE) {
    assert.equal(contentTypeForPath(`file.${ext}`), type, ext);
    assert.equal(contentTypeForPath(`a/b/c/file.${ext}`), type, ext);
  }
});

test('upper and mixed case extensions', () => {
  for (const [ext, type] of TABLE) assert.equal(contentTypeForPath(`PHOTO.${ext.toUpperCase()}`), type, ext);
  assert.equal(contentTypeForPath('notes/Today.Md'), 'text/markdown');
  assert.equal(contentTypeForPath('IMG_0001.HEIC'), 'image/heic');
});

test('multi-dot names use the last extension', () => {
  assert.equal(contentTypeForPath('backup.tar.gz'), 'application/gzip');
  assert.equal(contentTypeForPath('report.final.v2.pdf'), 'application/pdf');
  assert.equal(contentTypeForPath('data.json.txt'), 'text/plain');
  assert.equal(contentTypeForPath('archive.zip.unknownext'), DEFAULT_CONTENT_TYPE);
});

test('no extension, dot files and dot folders: application/octet-stream', () => {
  assert.equal(DEFAULT_CONTENT_TYPE, 'application/octet-stream');
  for (const path of ['README', 'folder/file', '.env', 'a/.gitignore', 'photos.v2/raw', '.config/settings', 'trailing.', '', 'a/b/']) {
    assert.equal(contentTypeForPath(path), DEFAULT_CONTENT_TYPE, JSON.stringify(path));
  }
  // A dot folder does not hide the file's own extension.
  assert.equal(contentTypeForPath('.config/settings.yaml'), 'text/yaml');
  assert.equal(contentTypeForPath('photos.v2/cat.webp'), 'image/webp');
  assert.equal(contentTypeForPath('.hidden.json'), 'application/json');
});

test('unknown extensions and Object.prototype names', () => {
  for (const path of ['a.exe', 'a.js', 'a.css', 'a.constructor', 'a.toString', 'a.__proto__', 'a.hasOwnProperty']) {
    assert.equal(contentTypeForPath(path), DEFAULT_CONTENT_TYPE, path);
  }
});

