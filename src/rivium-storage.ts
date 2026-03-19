import {
  RiviumStorageConfig,
  Bucket,
  StorageFile,
  ListFilesResult,
  DeleteManyResult,
  UploadOptions,
  ListFilesOptions,
  ImageTransforms,
  RiviumStorageException,
} from './models';

const API_BASE_URL = 'https://storage.rivium.co';
const DEFAULT_TIMEOUT = 30000;

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  return (ext && MIME_TYPES[ext]) || 'application/octet-stream';
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encode64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < len ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < len ? BASE64_CHARS[b2 & 63] : '=';
  }
  return result;
}

function stringToBytes(str: string): Uint8Array {
  const arr: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      arr.push(code);
    } else if (code < 0x800) {
      arr.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(++i);
      code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      arr.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      arr.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(arr);
}

/// RiviumStorage React Native SDK
///
/// Official SDK for RiviumStorage file storage and image transformation service.
///
/// Example:
/// ```ts
/// import { RiviumStorage } from '@rivium-storage/react-native';
///
/// const storage = new RiviumStorage({ apiKey: 'rv_live_xxx' });
///
/// // Upload a file
/// const file = await storage.upload('my-bucket', 'images/photo.jpg', imageBytes, {
///   contentType: 'image/jpeg',
/// });
///
/// // Get transformed URL
/// const thumbnailUrl = storage.getTransformUrl(file.id, { width: 200, height: 200 });
/// ```
export class RiviumStorage {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private _userId: string | null;

  /// Create a new RiviumStorage instance
  ///
  /// [config.apiKey] - Your project API key (rv_live_xxx or rv_test_xxx)
  /// [config.timeout] - Optional request timeout in milliseconds (default: 30000)
  constructor(config: RiviumStorageConfig) {
    if (!config.apiKey) {
      throw new RiviumStorageException('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = API_BASE_URL;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this._userId = config.userId ?? null;
  }

  /// Set the user ID for bucket policy enforcement
  setUserId(userId: string | null): void {
    this._userId = userId;
  }

  /// Get the current user ID
  get userId(): string | null {
    return this._userId;
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
    if (this._userId) {
      h['x-user-id'] = this._userId;
    }
    return h;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    options?: {
      body?: Record<string, unknown>;
      fromJson?: (data: Record<string, unknown>) => T;
      fromJsonList?: (data: unknown[]) => T;
    },
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: this.headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status >= 400) {
        let message = `HTTP ${response.status}`;
        try {
          const error: any = await response.json();
          message = error.message ?? message;
        } catch {
          // ignore parse errors
        }
        throw new RiviumStorageException(message, response.status);
      }

      if (response.status === 204) {
        return {} as T;
      }

      const text = await response.text();
      if (!text) {
        return {} as T;
      }

      const data = JSON.parse(text);

      if (options?.fromJson) {
        return options.fromJson(data);
      }
      if (options?.fromJsonList) {
        return options.fromJsonList(data);
      }

      return data as T;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof RiviumStorageException) throw e;
      if ((e as Error).name === 'AbortError') {
        throw new RiviumStorageException('Request timeout', 408, 'TIMEOUT');
      }
      throw new RiviumStorageException(`Network error: ${(e as Error).message}`);
    }
  }

  // ==========================================
  // Bucket Operations
  // ==========================================

  /// List all buckets in the project
  async listBuckets(): Promise<Bucket[]> {
    return this.request<Bucket[]>('GET', '/api/v1/buckets', {
      fromJsonList: (list) => list as Bucket[],
    });
  }

  /// Get bucket by ID
  async getBucket(bucketId: string): Promise<Bucket> {
    return this.request<Bucket>('GET', `/api/v1/buckets/${bucketId}`, {
      fromJson: (data) => data as unknown as Bucket,
    });
  }

  /// Get bucket by name
  async getBucketByName(name: string): Promise<Bucket> {
    return this.request<Bucket>('GET', `/api/v1/buckets/name/${name}`, {
      fromJson: (data) => data as unknown as Bucket,
    });
  }

  // ==========================================
  // File Operations
  // ==========================================

  /// Upload a file to a bucket
  ///
  /// [bucketId] - Bucket ID or name
  /// [path] - File path within the bucket
  /// [data] - File content as Uint8Array or string
  /// [options] - Upload options (contentType, metadata)
  async upload(
    bucketId: string,
    path: string,
    data: Uint8Array | string,
    options: UploadOptions = {},
  ): Promise<StorageFile> {
    const contentType = options.contentType ?? getMimeType(path);
    const fileName = path.split('/').pop() ?? 'file';

    // Build multipart body manually — React Native (Hermes) does not support
    // creating Blob from ArrayBuffer/Uint8Array, so we construct the raw
    // multipart payload as a string with base64-encoded binary data handled
    // via the React Native FormData approach.
    const formData = new FormData();

    if (typeof data === 'string') {
      // For string data, append as a file-like object that React Native understands
      formData.append('file', {
        uri: `data:${contentType};base64,${encode64(stringToBytes(data))}`,
        type: contentType,
        name: fileName,
      } as any);
    } else {
      // For Uint8Array, convert to base64 data URI
      formData.append('file', {
        uri: `data:${contentType};base64,${encode64(data)}`,
        type: contentType,
        name: fileName,
      } as any);
    }

    formData.append('path', path);

    if (options.metadata) {
      formData.append('metadata', JSON.stringify(options.metadata));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'x-api-key': this.apiKey,
      };
      if (this._userId) {
        headers['x-user-id'] = this._userId;
      }

      const response = await fetch(
        `${this.baseUrl}/api/v1/buckets/${bucketId}/files`,
        {
          method: 'POST',
          headers,
          body: formData,
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      if (response.status >= 400) {
        let message = `Upload failed: ${response.status}`;
        try {
          const error: any = await response.json();
          message = error.message ?? message;
        } catch {
          // ignore parse errors
        }
        throw new RiviumStorageException(message, response.status);
      }

      return (await response.json()) as StorageFile;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof RiviumStorageException) throw e;
      if ((e as Error).name === 'AbortError') {
        throw new RiviumStorageException('Request timeout', 408, 'TIMEOUT');
      }
      throw new RiviumStorageException(`Upload error: ${(e as Error).message}`);
    }
  }

  /// List files in a bucket
  async listFiles(
    bucketId: string,
    options: ListFilesOptions = {},
  ): Promise<ListFilesResult> {
    const params: string[] = [];
    if (options.prefix) params.push(`prefix=${encodeURIComponent(options.prefix)}`);
    if (options.limit) params.push(`limit=${options.limit}`);
    if (options.cursor) params.push(`cursor=${encodeURIComponent(options.cursor)}`);

    const query = params.length > 0 ? `?${params.join('&')}` : '';

    return this.request<ListFilesResult>(
      'GET',
      `/api/v1/buckets/${bucketId}/files${query}`,
      {
        fromJson: (data) => data as unknown as ListFilesResult,
      },
    );
  }

  /// Get file by ID
  async getFile(fileId: string): Promise<StorageFile> {
    return this.request<StorageFile>('GET', `/api/v1/files/${fileId}`, {
      fromJson: (data) => data as unknown as StorageFile,
    });
  }

  /// Get file by path in bucket
  async getFileByPath(bucketId: string, path: string): Promise<StorageFile> {
    return this.request<StorageFile>(
      'GET',
      `/api/v1/buckets/${bucketId}/files/${path}`,
      {
        fromJson: (data) => data as unknown as StorageFile,
      },
    );
  }

  /// Download file content
  async download(fileId: string): Promise<ArrayBuffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(
        `${this.baseUrl}/api/v1/files/${fileId}/download`,
        {
          headers: this._userId
            ? { 'x-api-key': this.apiKey, 'x-user-id': this._userId }
            : { 'x-api-key': this.apiKey },
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      if (response.status >= 400) {
        throw new RiviumStorageException(
          `Download failed: ${response.status}`,
          response.status,
        );
      }

      return response.arrayBuffer();
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof RiviumStorageException) throw e;
      throw new RiviumStorageException(`Download error: ${(e as Error).message}`);
    }
  }

  /// Delete a file by ID
  async delete(fileId: string): Promise<void> {
    await this.request('DELETE', `/api/v1/files/${fileId}`);
  }

  /// Delete a file by path in bucket
  async deleteByPath(bucketId: string, path: string): Promise<void> {
    await this.request('DELETE', `/api/v1/buckets/${bucketId}/files/${path}`);
  }

  /// Delete multiple files by IDs
  ///
  /// Returns the number of files successfully deleted
  async deleteMany(fileIds: string[]): Promise<DeleteManyResult> {
    return this.request<DeleteManyResult>('POST', '/api/v1/files/delete-many', {
      body: { ids: fileIds },
      fromJson: (data) => data as unknown as DeleteManyResult,
    });
  }

  // ==========================================
  // URL Generation
  // ==========================================

  /// Get public URL for a file (only works for public buckets)
  getUrl(fileId: string): string {
    return `${this.baseUrl}/api/v1/files/${fileId}/url`;
  }

  /// Get URL with image transformations
  ///
  /// [fileId] - The file ID
  /// [transforms] - Image transformation options
  getTransformUrl(fileId: string, transforms?: ImageTransforms): string {
    const params: string[] = [];

    if (transforms) {
      if (transforms.width) params.push(`w=${transforms.width}`);
      if (transforms.height) params.push(`h=${transforms.height}`);
      if (transforms.fit) params.push(`fit=${transforms.fit}`);
      if (transforms.format) params.push(`f=${transforms.format}`);
      if (transforms.quality) params.push(`q=${transforms.quality}`);
      if (transforms.blur) params.push(`blur=${transforms.blur}`);
      if (transforms.sharpen) params.push(`sharpen=${transforms.sharpen}`);
      if (transforms.rotate) params.push(`rotate=${transforms.rotate}`);
    }

    const query = params.length > 0 ? `?${params.join('&')}` : '';
    return `${this.baseUrl}/api/v1/transform/${fileId}${query}`;
  }

  /// Get download URL (for direct access without SDK)
  getDownloadUrl(fileId: string): string {
    return `${this.baseUrl}/api/v1/files/${fileId}/download`;
  }
}
