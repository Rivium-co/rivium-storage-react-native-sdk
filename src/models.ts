/// RiviumStorage configuration
export interface RiviumStorageConfig {
  /// API Key for project identification (rv_live_xxx or rv_test_xxx)
  apiKey: string;

  /// Request timeout in milliseconds (default: 30000)
  timeout?: number;

  /// Optional user ID for bucket policy enforcement
  userId?: string;
}

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
