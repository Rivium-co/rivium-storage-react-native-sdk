/// RiviumStorage configuration
export interface RiviumStorageConfig {
  /// API Key for project identification (rv_live_xxx or rv_test_xxx)
  apiKey: string;

  /// Request timeout in milliseconds (default: 30000)
  timeout?: number;

  /// Returns a Rivium user token for the signed-in user, minted by YOUR server.
  ///
  /// Your backend calls `POST https://auth.rivium.co/users/token` with your API
  /// key AND your server secret (never ship the secret in an app) and returns
  /// the token. A Rivium Auth sign-in token works as is. The SDK asks for it
  /// before the first request, sends it as `x-user-token` on every request,
  /// replaces it shortly before it expires, and asks again (retrying the
  /// request once) if the server says it expired or is invalid. This is what
  /// makes the user in your bucket rules trustworthy.
  ///
  /// File requests always need a signed-in user. Return `null` when no one
  /// is signed in: file calls then wait (`isAwaitingUserToken`) until you call
  /// `refreshUserToken()` or `setUserToken()` after sign-in. With Rivium Auth
  /// this is `() => auth.getToken()`. Same option as the other Rivium SDKs.
  tokenProvider?: RiviumStorageTokenProvider;

  /// A user token you already hold. `tokenProvider` is preferred: a static
  /// token cannot be refreshed when it expires.
  userToken?: string;

  /// How long a file call may wait for a user token, in milliseconds. When it
  /// passes the call fails with `token_required` (401). Default: no limit,
  /// the call waits until a user signs in.
  userTokenWaitTimeout?: number;
}

/// Returns the signed-in user's Rivium user token, or `null` when no one is
/// signed in.
export type RiviumStorageTokenProvider = () => string | null | Promise<string | null>;

/// Bucket model
export interface Bucket {
  id: string;
  name: string;
  description: string | null;
  visibility: 'public' | 'private';
  /** File types the bucket accepts; `null` = every type. */
  allowedMimeTypes: string[] | null;
  /** Largest file the bucket accepts, in bytes. */
  maxFileSize: number;
  /** Whether executable files are refused. */
  blockExecutables: boolean;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/// Storage file model
export interface StorageFile {
  id: string;
  bucketId: string;
  /** Full path in the bucket. */
  path: string;
  /** Last path segment. */
  fileName: string;
  mimeType: string;
  /** Bytes. */
  size: number;
  /** MD5 hex of the content. */
  checksum: string | null;
  /** Your own metadata, as sent with the upload. */
  metadata: Record<string, unknown> | null;
  /** The app user who uploaded it (token user or the user your server named). */
  uploadedBy: string | null;
  /** ISO 8601 time of the last upload; `null` on older files. */
  uploadedAt: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/// List files result
export interface ListFilesResult {
  files: StorageFile[];
  /** Pass as `cursor` for the next page; `null` on the last page. */
  nextCursor: string | null;
}

/// Upload options
export interface UploadOptions {
  /// Content type (MIME type) of the file. When omitted: the type the Rivium
  /// Storage file types table lists for the path's extension (`.md` →
  /// `text/markdown`, `.heic` → `image/heic`, …), else
  /// `application/octet-stream`.
  contentType?: string;

  /// Custom metadata to attach to the file
  metadata?: Record<string, unknown>;

  /// Called while the file is sent, with the bytes sent so far and the size
  /// of the whole request (the file plus a few hundred bytes of form fields).
  /// `bytesSent` only grows and the last call has `bytesSent === totalBytes`.
  onProgress?: (progress: UploadProgress) => void;
}

/// Upload progress passed to `UploadOptions.onProgress`.
export interface UploadProgress {
  /// Bytes of the request body sent so far.
  bytesSent: number;

  /// Size of the request body in bytes.
  totalBytes: number;
}

/// List files options
export interface ListFilesOptions {
  /// Filter files by path prefix
  prefix?: string;

  /// Maximum number of files to return
  limit?: number;

  /// Cursor for pagination
  cursor?: string | null;
}

/// Image transformation options. Values outside these ranges throw
/// `invalid_transform` before a URL is built.
export interface ImageTransforms {
  /// Target width in pixels, 1 or more (values above 4096 are sent as 4096)
  width?: number;

  /// Target height in pixels, 1 or more (values above 4096 are sent as 4096)
  height?: number;

  /// Resize mode: `cover`, `contain`, `fill`, `inside` or `outside`
  fit?: string;

  /// Output format: `jpeg` (the default), `png`, `webp` or `avif`
  format?: string;

  /// Compression quality, 1..100
  quality?: number;

  /// Blur, 0..20 (0 = none)
  blur?: number;

  /// Sharpen, 0..10 (0 = none)
  sharpen?: number;

  /// Rotation in degrees, a whole number (multiples of 90 recommended)
  rotate?: number;
}

/// Delete many files result
export interface DeleteManyResult {
  deleted: number;
}

/// RiviumStorage error
export class RiviumStorageException extends Error {
  public statusCode?: number;
  public code?: string;

  constructor(message: string, statusCode?: number, code?: string) {
    super(message);
    this.name = 'RiviumStorageException';
    this.statusCode = statusCode;
    this.code = code;
  }
}
