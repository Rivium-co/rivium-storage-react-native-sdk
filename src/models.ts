/// RiviumStorage configuration
export interface RiviumStorageConfig {
  /// API Key for project identification (rv_live_xxx or rv_test_xxx)
  apiKey: string;

  /// Request timeout in milliseconds (default: 30000)
  timeout?: number;

  /// Legacy: a user id sent as the `x-user-id` header for bucket rules.
  ///
  /// NOTE: this is a plain string the client chooses, so the server cannot
  /// verify it - anyone who unpacks your app can change it. Use
  /// `tokenProvider` instead. Ignored by the server whenever a user token is
  /// sent.
  userId?: string;

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
  /// Return `null` when no one is signed in, and call `refreshUserToken()`
  /// when the user signs in or out. Same option as the other Rivium SDKs.
  tokenProvider?: RiviumStorageTokenProvider;

  /// A user token you already hold. `tokenProvider` is preferred: a static
  /// token cannot be refreshed when it expires.
  userToken?: string;
}

/// Returns the signed-in user's Rivium user token, or `null` when no one is
/// signed in.
export type RiviumStorageTokenProvider = () => string | null | Promise<string | null>;

/// Bucket model
export interface Bucket {
  id: string;
  name: string;
  projectId: string;
  organizationId: string;
  visibility: string;
  allowedMimeTypes?: string[];
  maxFileSize?: number;
  policiesEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/// Storage file model
export interface StorageFile {
  id: string;
  bucketId: string;
  path: string;
  fileName: string;
  mimeType: string;
  size: number;
  checksum?: string;
  storageKey: string;
  metadata?: Record<string, unknown>;
  uploadedBy?: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  url?: string;
}

/// List files result
export interface ListFilesResult {
  files: StorageFile[];
  nextCursor?: string;
}

/// Upload options
export interface UploadOptions {
  /// Content type (MIME type) of the file
  contentType?: string;

  /// Custom metadata to attach to the file
  metadata?: Record<string, unknown>;
}

/// List files options
export interface ListFilesOptions {
  /// Filter files by path prefix
  prefix?: string;

  /// Maximum number of files to return
  limit?: number;

  /// Cursor for pagination
  cursor?: string;
}

/// Image transformation options
export interface ImageTransforms {
  /// Target width in pixels
  width?: number;

  /// Target height in pixels
  height?: number;

  /// Resize mode: cover, contain, fill, inside, outside
  fit?: string;

  /// Output format: jpeg, png, webp, avif
  format?: string;

  /// Compression quality (1-100)
  quality?: number;

  /// Blur amount (0-100)
  blur?: number;

  /// Sharpen amount (0-100)
  sharpen?: number;

  /// Rotation in degrees (90, 180, 270)
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
