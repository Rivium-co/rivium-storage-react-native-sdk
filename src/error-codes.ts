/**
 * The `code` a Rivium Storage refusal carries (on the SDK error's `code`), so an
 * app can react to the reason instead of matching message text. The same list
 * is in every Rivium Storage SDK. A refusal without a code (a `404`, a `429`)
 * has `code` undefined: check `statusCode` then.
 *
 * @example
 * try {
 *   await storage.upload('avatars', 'me.heic', bytes);
 * } catch (e) {
 *   if (e.code === StorageErrorCode.TypeNotAllowed) showToast('This file type is not allowed here');
 * }
 */
export const StorageErrorCode = {
  /** 400: the bucket's allowed types don't include this file's format (Console › Bucket › Settings). */
  TypeNotAllowed: 'type_not_allowed',
  /** 400: the file is larger than the bucket's size limit. */
  FileTooLarge: 'file_too_large',
  /** 400: the bucket blocks executable files and this one is (by name or content). */
  ExecutableBlocked: 'executable_blocked',
  /** 400: the upload had no file. */
  FileRequired: 'file_required',
  /** 409: a file already exists at this path. */
  PathTaken: 'path_taken',
  /**
   * 400: the path was refused. The SDK refuses before sending anything a path
   * with a `.` or `..` segment (also written as `%2e`), an id or bucket name
   * that is `.` or `..`, and a new file path with `?`, `#`, `%` or
   * text-direction characters; the server refuses the rest (control
   * characters, a name starting or ending with a space, too long).
   */
  InvalidPath: 'invalid_path',
  /** 400, from the SDK before anything is sent: the file path is empty (or only spaces and `/`). */
  PathRequired: 'path_required',
  /** 400, from the SDK before anything is sent: the file id is empty. */
  FileIdRequired: 'file_id_required',
  /** 400, from the SDK before anything is sent: the bucket id or name is empty. */
  BucketRequired: 'bucket_required',
  /** 400: `deleteMany` needs 1 to 1,000 file ids. */
  InvalidIds: 'invalid_ids',
  /** 400: an access rule is wrong (the message names the first problem). */
  InvalidRules: 'invalid_rules',
  /** 400: an image transform option isn't allowed (the SDK checks before building the URL). */
  InvalidTransform: 'invalid_transform',
  /** 413: the image is too large to transform (over 25 MB). */
  SourceTooLarge: 'source_too_large',
  /** 415: the image's format can't be resized (the message names it and lists the supported formats). */
  ImageFormatNotSupported: 'image_format_not_supported',
  /** 400: the file isn't an image, so it can't be resized (the message names its type). */
  NotAnImage: 'not_an_image',
  /** 422: the image is damaged or incomplete (it may not have finished uploading). */
  ImageDamaged: 'image_damaged',
  /** 413: the image has too many pixels to resize (up to 50 megapixels; the message gives its size). */
  ImageTooLarge: 'image_too_large',
  /** 401: the project requires a signed-in user and no user token was sent. */
  TokenRequired: 'token_required',
  /** 401: the user token is not valid for this project. */
  TokenInvalid: 'token_invalid',
  /** 401: the user token expired. */
  TokenExpired: 'token_expired',
  /** 403: the bucket's access rules refused the request. */
  AccessDenied: 'access_denied',
  /** 403: the project's IP allow-list doesn't include this server. */
  IpNotAllowed: 'ip_not_allowed',
  /** 403: only your server (with the server secret) may do this. */
  ServerSecretRequired: 'server_secret_required',
  /** 400: a signed upload was refused when it was registered (too big, type, rules or plan). */
  UploadRejected: 'upload_rejected',
  /** 409: nothing has been uploaded to the signed upload link yet. */
  UploadMissing: 'upload_missing',
  /** 409: the signed upload link expired before a file arrived. */
  UploadExpired: 'upload_expired',
  /**
   * 503: image processing is busy (every image worker is in use). Try again after the `Retry-After` header's
   * seconds (2). Image views (an `<img>`, Coil, Glide, AsyncImage, Image.network) load the URL again by themselves.
   */
  TransformBusy: 'transform_busy',
  /**
   * 429, public image URLs only: this image already has 50 different sizes / formats, so a new combination is
   * refused (the existing ones keep working). Use a few fixed sizes.
   */
  TooManyVariants: 'too_many_variants',
  /** 403: image transforms aren't included in the project's plan (Free). Upgrade the plan to use them. */
  PlanFeatureLocked: 'plan_feature_locked',
} as const;

/** One of the `StorageErrorCode` values. Other codes may be added later, so keep a default branch. */
export type StorageErrorCode = (typeof StorageErrorCode)[keyof typeof StorageErrorCode];
