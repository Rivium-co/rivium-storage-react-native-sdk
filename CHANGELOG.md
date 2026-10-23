# Changelog

## 0.2.1

- **Breaking:** File requests require a signed-in user (a Rivium user token). Without a token, file calls wait until your app signs a user in; see `isAwaitingUserToken`, `onAwaitingUserToken` and the optional `userTokenWaitTimeout`. `userId` / `setUserId` are removed.
- **Added:** Upload progress: `upload(..., { onProgress })` reports `{ bytesSent, totalBytes }`.
- **Added:** `getPublicUrl(fileId, transforms)` returns a file's public link (public buckets only). Pass image transform options to get a resized or converted image link that needs no key, ready for an image view. `publicImageUrl()` builds the same link from a saved public URL without a request.
- **Added:** Errors carry the server's error code and HTTP status (`code` and `statusCode` on `RiviumStorageException`), with constants in `StorageErrorCode`.
- **Added:** Uploads without a content type now get the right type for common formats (`.md`, `.csv`, `.heic`, `.m4a`, `.7z`, ...).
- **Changed:** `StorageFile` and `Bucket` contain only the fields the API returns.
- **Changed:** Paths, ids and image transform options are checked before a request is sent; invalid values fail with `invalid_path` or `invalid_transform`.
- **Fixed:** File paths with spaces, `#`, `?` or non-Latin characters are encoded correctly.
- **Fixed:** Redirects are no longer followed.

## 0.2.0

### Added
- Sign users in with a Rivium user token — the same token Rivium Sync, Chat, Push and A/B Testing accept (a Rivium Auth sign-in token works as is). Pass a `tokenProvider` (or a `userToken`) in the config, or call `setUserToken()` / `refreshUserToken()` later. The SDK sends the token with every request and gets a new one when it expires, so your access rules see a verified user.
- New error code `token_required` on `RiviumStorageException` when the project requires a signed-in user and no token is available.
- `RiviumStorageException.code` now carries the error code returned by the server.

### Changed
- `userId` / `setUserId()` still work but are deprecated: the server can't verify a user ID sent by an app. Use `tokenProvider`.

## 0.1.0

- Initial release.
