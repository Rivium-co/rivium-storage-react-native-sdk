# Changelog

## 0.2.0

### Added
- Sign users in with a Rivium user token — the same token Rivium Sync, Chat, Push and A/B Testing accept (a Rivium Auth sign-in token works as is). Pass a `tokenProvider` (or a `userToken`) in the config, or call `setUserToken()` / `refreshUserToken()` later. The SDK sends the token with every request and gets a new one when it expires, so your access rules see a verified user.
- New error code `token_required` on `RiviumStorageException` when the project requires a signed-in user and no token is available.
- `RiviumStorageException.code` now carries the error code returned by the server.

### Changed
- `userId` / `setUserId()` still work but are deprecated: the server can't verify a user ID sent by an app. Use `tokenProvider`.

## 0.1.0

- Initial release.
