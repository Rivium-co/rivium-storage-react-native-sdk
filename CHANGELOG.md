# Changelog

## 0.2.0

### Added
- Rivium user token support: `tokenProvider` and `userToken` config options, `setUserToken(token | null)` and `refreshUserToken()`. The token is sent as `x-user-token` on every request (upload and download included); `x-user-id` is not sent while a token is present.
- The token is fetched lazily before the first request, cached, replaced shortly before it expires, and on a 401 `token_expired` / `token_invalid` the provider is asked once more and the request retried once. Concurrent requests share one provider call.
- A 401 `token_required` throws a `RiviumStorageException` (code `token_required`) that says to configure `tokenProvider`.
- `RiviumStorageException.code` now carries the server's error `code`.
- Tests (`npm test`, Node's built-in runner, no new dependencies).

### Changed
- `userId` / `setUserId()` are documented as legacy (the server can't verify a client-chosen id); behaviour unchanged.
- URL helpers (`getUrl`, `getTransformUrl`, `getDownloadUrl`) are documented as unable to carry the token; behaviour unchanged.

## 0.1.0

- Initial release.
