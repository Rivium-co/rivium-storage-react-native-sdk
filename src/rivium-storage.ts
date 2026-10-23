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
  RiviumStorageTokenProvider,
} from './models';
import { StorageErrorCode } from './error-codes';
import { SDK_HEADER, SDK_HEADER_VALUE } from './version';
import {
  encodePathSegments,
  bucketSegment,
  fileIdSegment,
  checkUploadPath,
  transformQuery,
  publicImageUrl,
} from './url-segments';
import { UploadProgressReporter } from './upload-progress';
import { contentTypeForPath } from './file-types';

/** Sends one request: `fetch`, or XMLHttpRequest when reporting upload progress. */
type Transport = (url: string, init: RequestInit) => Promise<Response>;

const fetchTransport: Transport = (url, init) => fetch(url, init);

/** The parts of XMLHttpRequest used here (React Native provides it globally). */
interface UploadXhr {
  status: number;
  /** The URL the response came from after redirects (empty or missing on old runtimes). */
  responseURL?: string;
  responseText: string;
  upload: { onprogress: ((event: { loaded: number; total: number; lengthComputable?: boolean }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string, async?: boolean): void;
  setRequestHeader(name: string, value: string): void;
  getAllResponseHeaders(): string;
  send(body?: unknown): void;
  abort(): void;
}

/// XMLHttpRequest follows redirects and can't be told not to (fetch is sent
/// with `redirect: 'error'`). The API never redirects, so a response from
/// another origin than the one asked is refused instead of used.
function cameFromOtherOrigin(requested: string, responseURL: string | null | undefined): boolean {
  if (!responseURL) return false;
  const origin = (u: string) => {
    const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)/i.exec(u);
    return m ? m[1].toLowerCase() : null;
  };
  const a = origin(responseURL);
  return a === null || a !== origin(requested);
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

/// Sends `init` with XMLHttpRequest, reporting `xhr.upload` progress, and
/// answers with a `Response` like fetch does (same headers and body object,
/// so the server receives the same request).
function xhrTransport(reporter: UploadProgressReporter): Transport {
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const Xhr = (globalThis as any).XMLHttpRequest as (new () => UploadXhr) | undefined;
      if (!Xhr) {
        reject(new TypeError('XMLHttpRequest is not available'));
        return;
      }
      const signal = init.signal ?? undefined;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const xhr = new Xhr();
      const onAbortSignal = () => xhr.abort();
      const cleanup = () => signal?.removeEventListener?.('abort', onAbortSignal);

      xhr.open(init.method ?? 'GET', url, true);
      const headers = (init.headers ?? {}) as Record<string, string>;
      for (const name of Object.keys(headers)) {
        xhr.setRequestHeader(name, headers[name]);
      }
      xhr.upload.onprogress = (event) => {
        reporter.report(event.loaded, event.lengthComputable === false ? 0 : event.total);
      };
      xhr.onload = () => {
        cleanup();
        if (cameFromOtherOrigin(url, xhr.responseURL)) {
          reject(new TypeError('The request was redirected to another site, so the response was not used'));
          return;
        }
        const status = xhr.status;
        if (status < 200 || status > 599) {
          reject(new TypeError('Network request failed'));
          return;
        }
        const responseHeaders: Record<string, string> = {};
        for (const line of (xhr.getAllResponseHeaders() || '').split(/\r?\n/)) {
          const i = line.indexOf(':');
          if (i > 0) responseHeaders[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
        const nullBody = status === 204 || status === 205 || status === 304;
        resolve(new Response(nullBody ? null : xhr.responseText ?? '', { status, headers: responseHeaders }));
      };
      xhr.onerror = () => {
        cleanup();
        reject(new TypeError('Network request failed'));
      };
      xhr.ontimeout = () => {
        cleanup();
        reject(new TypeError('Network request timed out'));
      };
      xhr.onabort = () => {
        cleanup();
        reject(abortError());
      };
      signal?.addEventListener?.('abort', onAbortSignal);
      xhr.send(init.body ?? null);
    });
}

const API_BASE_URL = 'https://storage.rivium.co';
const DEFAULT_TIMEOUT = 30000;

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

/// Base64 to a binary string (Hermes before RN 0.74 has no atob).
function decode64(input: string): string {
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '=') break;
    const value = BASE64_CHARS.indexOf(c);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

/// Seconds since the epoch at which a JWT expires, 0 if unreadable.
function tokenExpiry(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (!payload) return 0;
    let base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const binary = decode64(base64);
    const exp = JSON.parse(binary)?.exp;
    return typeof exp === 'number' ? exp : 0;
  } catch {
    return 0;
  }
}

/// The `code` of a JSON error body, without consuming the response.
async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body: any = await response.clone().json();
    return typeof body?.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
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
  private tokenProvider: RiviumStorageTokenProvider | null;
  /** A token set with `userToken` or `setUserToken()` without a provider. */
  private staticUserToken: string | null;
  private userToken: string | null = null;
  private userTokenExpiresAt = 0;
  private userTokenInFlight: Promise<string | null> | null = null;
  /**
   * Bumped whenever the token is replaced or dropped (sign-out, refresh). A
   * provider answer is kept only if no bump happened while it was pending, so
   * signing out during a provider call can't bring back the previous user's token.
   */
  private tokenGeneration = 0;
  /** `userTokenWaitTimeout` in ms; `null` = wait until a token arrives. */
  private userTokenWaitTimeout: number | null;
  /** Calls waiting for a user token, in the order they asked. */
  private tokenWaiters: Array<{
    resolve: (token: string) => void;
    timer: ReturnType<typeof setTimeout> | null;
  }> = [];
  private awaitingUserTokenListeners = new Set<() => void>();

  /** Seconds before expiry at which a token is replaced. */
  private static readonly TOKEN_REFRESH_SKEW_S = 60;

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
    this.tokenProvider = config.tokenProvider ?? null;
    this.staticUserToken = config.userToken ?? null;
    const wait = config.userTokenWaitTimeout;
    this.userTokenWaitTimeout = typeof wait === 'number' && wait >= 0 ? wait : null;
  }

  // ==========================================
  // Rivium user token
  // ==========================================

  /// Replace the user token, or pass `null` when the user signs out.
  ///
  /// With a `tokenProvider`, the token is used until it nears expiry and then
  /// the provider is asked again; `null` makes the next request ask the
  /// provider. Without one, the token is used as is until you replace it.
  ///
  /// A token releases every call waiting for one (`isAwaitingUserToken`), in
  /// the order they were made. `null` leaves waiting calls waiting.
  async setUserToken(token: string | null): Promise<void> {
    if (this.tokenProvider) {
      this.tokenGeneration++;
      this.userTokenInFlight = null;
      this.userToken = token;
      this.userTokenExpiresAt = token ? tokenExpiry(token) : 0;
    } else {
      this.staticUserToken = token;
    }
    this.releaseUserTokenWaiters(token);
  }

  /// Ask `tokenProvider` again. Call this when the user signs in or out.
  /// When it now returns a token, calls waiting for one go on.
  async refreshUserToken(): Promise<void> {
    this.invalidateUserToken();
    this.releaseUserTokenWaiters(await this.ensureUserToken());
  }

  /// True while at least one call is waiting for a user token: file requests
  /// need a signed-in user, and no token is held and `tokenProvider` (if any)
  /// returned `null`. Show your sign-in screen; the calls go on by themselves
  /// after `setUserToken(token)` or `refreshUserToken()`.
  get isAwaitingUserToken(): boolean {
    return this.tokenWaiters.length > 0;
  }

  /// Called once each time calls start waiting for a user token. Returns a
  /// function that removes the callback.
  onAwaitingUserToken(callback: () => void): () => void {
    this.awaitingUserTokenListeners.add(callback);
    return () => {
      this.awaitingUserTokenListeners.delete(callback);
    };
  }

  /// The token for a file request: the held one, else the provider's answer,
  /// else wait until the app signs a user in.
  private async userTokenForRequest(): Promise<string> {
    const token = await this.ensureUserToken();
    return token ?? this.waitForUserToken();
  }

  /// The token held right now, without asking the provider.
  private heldUserToken(): string | null {
    return this.tokenProvider ? this.userToken : this.staticUserToken;
  }

  /// Resolves with the next user token (`setUserToken`, `refreshUserToken`, or
  /// the provider answering another request). Nothing is sent meanwhile. With
  /// `userTokenWaitTimeout` it rejects with `token_required` (401) after that
  /// many milliseconds.
  private waitForUserToken(): Promise<string> {
    const held = this.heldUserToken();
    if (held) return Promise.resolve(held);
    return new Promise<string>((resolve, reject) => {
      const waiter = { resolve, timer: null as ReturnType<typeof setTimeout> | null };
      const startsWaiting = this.tokenWaiters.length === 0;
      this.tokenWaiters.push(waiter);
      if (this.userTokenWaitTimeout !== null) {
        waiter.timer = setTimeout(() => {
          const i = this.tokenWaiters.indexOf(waiter);
          if (i < 0) return;
          this.tokenWaiters.splice(i, 1);
          reject(
            new RiviumStorageException(
              'No Rivium user token arrived within userTokenWaitTimeout. File requests need a signed-in user: sign the user in, then call setUserToken() or refreshUserToken().',
              401,
              StorageErrorCode.TokenRequired,
            ),
          );
        }, this.userTokenWaitTimeout);
      }
      if (startsWaiting) {
        for (const listener of Array.from(this.awaitingUserTokenListeners)) {
          try {
            listener();
          } catch (e) {
            console.error('[RiviumStorage] onAwaitingUserToken callback threw:', e);
          }
        }
      }
    });
  }

  /// Lets every waiting call go on with `token`, in the order they asked.
  private releaseUserTokenWaiters(token: string | null): void {
    if (!token || this.tokenWaiters.length === 0) return;
    const waiters = this.tokenWaiters;
    this.tokenWaiters = [];
    for (const waiter of waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(token);
    }
  }

  /// The server said `token_required` although `token` was sent: forget it,
  /// so the call waits for a new one instead of sending it again.
  private dropUserToken(token: string | null): void {
    if (!token) return;
    if (this.tokenProvider) {
      if (this.userToken === token) this.invalidateUserToken();
    } else if (this.staticUserToken === token) {
      this.staticUserToken = null;
    }
  }

  /// The current user token, fetched through `tokenProvider` when needed.
  /// Concurrent callers share one in-flight provider call.
  private async ensureUserToken(): Promise<string | null> {
    if (!this.tokenProvider) return this.staticUserToken;

    const nowS = Math.floor(Date.now() / 1000);
    if (
      this.userToken &&
      (this.userTokenExpiresAt === 0 ||
        this.userTokenExpiresAt - RiviumStorage.TOKEN_REFRESH_SKEW_S > nowS)
    ) {
      return this.userToken;
    }
    if (this.userTokenInFlight) return this.userTokenInFlight;

    const provider = this.tokenProvider;
    const generation = this.tokenGeneration;
    // `settled` covers a provider that throws synchronously: the finally
    // below then runs before `inFlight` is assigned.
    let settled = false;
    let inFlight: Promise<string | null> | null = null;
    inFlight = (async () => {
      try {
        const token = (await provider()) ?? null;
        // Signed out or replaced meanwhile: this answer belongs to the old user.
        if (generation !== this.tokenGeneration) return this.userToken;
        this.userToken = token;
        this.userTokenExpiresAt = token ? tokenExpiry(token) : 0;
        this.releaseUserTokenWaiters(token);
        return token;
      } catch (e) {
        console.error('[RiviumStorage] tokenProvider failed:', e);
        // Keep the old token: it may still be valid, and the server decides.
        return this.userToken;
      } finally {
        settled = true;
        if (this.userTokenInFlight === inFlight) this.userTokenInFlight = null;
      }
    })();
    if (!settled) this.userTokenInFlight = inFlight;

    return inFlight;
  }

  /** Drop the cached token so the next request asks the provider again. */
  private invalidateUserToken(): void {
    this.tokenGeneration++;
    this.userTokenInFlight = null;
    this.userToken = null;
    this.userTokenExpiresAt = 0;
  }

  /// Every API call goes through here. Each request names the project
  /// (`x-api-key`) and the SDK (`X-Rivium-SDK: <name>/<version>`) and carries
  /// the user token when one is held.
  ///
  /// `userToken: true` (file and transform routes) never sends without a
  /// token: the call waits for one (see `isAwaitingUserToken`), and a 401
  /// `token_required` puts it back to waiting. On a 401 `token_expired` or
  /// `token_invalid` the provider is asked once more and the request retried
  /// once, so a transient expiry never reaches the caller.
  ///
  /// The `timeout` covers each HTTP attempt, never the wait for a token.
  /// A timed-out attempt rejects with an `AbortError`.
  private async authedFetch(
    url: string,
    init: RequestInit,
    options: { extraHeaders?: Record<string, string>; transport?: Transport; userToken?: boolean } = {},
  ): Promise<Response> {
    const transport = options.transport ?? fetchTransport;
    const needsToken = options.userToken === true;
    let refreshed = false;
    let token = needsToken ? await this.userTokenForRequest() : await this.ensureUserToken();

    for (;;) {
      const headers: Record<string, string> = {
        'x-api-key': this.apiKey,
        [SDK_HEADER]: SDK_HEADER_VALUE,
      };
      if (token) headers['x-user-token'] = token;
      Object.assign(headers, options.extraHeaders);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      let response: Response;
      try {
        // Never follow a redirect: the next hop would receive the key and user token.
        response = await transport(url, { ...init, headers, redirect: 'error', signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.status !== 401) return response;
      const code = await readErrorCode(response);
      if (needsToken && code === 'token_required') {
        this.dropUserToken(token);
        token = await this.waitForUserToken();
        continue;
      }
      if ((code === 'token_expired' || code === 'token_invalid') && this.tokenProvider && !refreshed) {
        refreshed = true;
        this.invalidateUserToken();
        token = needsToken ? await this.userTokenForRequest() : await this.ensureUserToken();
        continue;
      }
      return response;
    }
  }

  /// The exception for a failed response, with the server's `code`.
  private async errorFrom(
    response: Response,
    fallback: string,
    useServerMessage = true,
  ): Promise<RiviumStorageException> {
    let message = fallback;
    let code: string | undefined;
    try {
      const error: any = await response.json();
      const serverMessage = Array.isArray(error?.message) ? error.message.join(', ') : error?.message;
      if (useServerMessage && typeof serverMessage === 'string' && serverMessage) message = serverMessage;
      if (typeof error?.code === 'string') code = error.code;
    } catch {
      // ignore parse errors
    }
    if (code === 'token_required') {
      message = this.tokenProvider || this.staticUserToken
        ? 'This project requires a signed-in user, and no Rivium user token was available (tokenProvider returned null?). Sign the user in, then call refreshUserToken().'
        : 'This project requires a Rivium user token. Pass tokenProvider to new RiviumStorage({ ... }) returning a token minted by your server (POST https://auth.rivium.co/users/token) or a Rivium Auth sign-in token.';
    }
    return new RiviumStorageException(message, response.status, code);
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  private async request<T>(
    method: string,
    endpoint: string,
    options?: {
      body?: Record<string, unknown>;
      fromJson?: (data: Record<string, unknown>) => T;
      fromJsonList?: (data: unknown[]) => T;
      /** File and transform routes: wait for a user token before sending. */
      userToken?: boolean;
    },
  ): Promise<T> {
    try {
      const response = await this.authedFetch(
        `${this.baseUrl}${endpoint}`,
        {
          method,
          body: options?.body ? JSON.stringify(options.body) : undefined,
        },
        { extraHeaders: { 'Content-Type': 'application/json' }, userToken: options?.userToken },
      );

      if (response.status >= 400) {
        throw await this.errorFrom(response, `HTTP ${response.status}`);
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
    return this.request<Bucket>('GET', `/api/v1/buckets/${bucketSegment(bucketId)}`, {
      fromJson: (data) => data as unknown as Bucket,
    });
  }

  /// Get bucket by name
  async getBucketByName(name: string): Promise<Bucket> {
    return this.request<Bucket>('GET', `/api/v1/buckets/name/${bucketSegment(name)}`, {
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
  /// [options] - Upload options (contentType, metadata, onProgress)
  ///
  /// With `options.onProgress` the upload is sent with XMLHttpRequest, which
  /// reports bytes sent on iOS and Android; the request is the same.
  async upload(
    bucketId: string,
    path: string,
    data: Uint8Array | string,
    options: UploadOptions = {},
  ): Promise<StorageFile> {
    const bucket = bucketSegment(bucketId);
    // Normalised like the server stores it; `?`, `#`, `%`, text-direction
    // characters and `.` / `..` segments are refused before anything is sent.
    const filePath = checkUploadPath(path);
    // The app's type, else the file types table's type for the extension
    // (the one the Console offers and the server stores), else octet-stream.
    const contentType = options.contentType || contentTypeForPath(filePath);
    const fileName = filePath.split('/').pop() ?? 'file';

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

    formData.append('path', filePath);

    if (options.metadata) {
      formData.append('metadata', JSON.stringify(options.metadata));
    }

    const reporter = options.onProgress ? new UploadProgressReporter(options.onProgress) : null;

    try {
      const response = await this.authedFetch(
        `${this.baseUrl}/api/v1/buckets/${bucket}/files`,
        {
          method: 'POST',
          body: formData,
        },
        {
          userToken: true,
          transport: reporter ? xhrTransport(reporter) : fetchTransport,
        },
      );

      if (response.status >= 400) {
        throw await this.errorFrom(response, `Upload failed: ${response.status}`);
      }

      const file = (await response.json()) as StorageFile;
      reporter?.finish();
      return file;
    } catch (e) {
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
      `/api/v1/buckets/${bucketSegment(bucketId)}/files${query}`,
      {
        fromJson: (data) => data as unknown as ListFilesResult,
        userToken: true,
      },
    );
  }

  /// Get file by ID
  async getFile(fileId: string): Promise<StorageFile> {
    return this.request<StorageFile>('GET', `/api/v1/files/${fileIdSegment(fileId)}`, {
      fromJson: (data) => data as unknown as StorageFile,
      userToken: true,
    });
  }

  /// Get file by path in bucket
  async getFileByPath(bucketId: string, path: string): Promise<StorageFile> {
    return this.request<StorageFile>(
      'GET',
      `/api/v1/buckets/${bucketSegment(bucketId)}/files/${encodePathSegments(path)}`,
      {
        fromJson: (data) => data as unknown as StorageFile,
        userToken: true,
      },
    );
  }

  /// Download file content
  async download(fileId: string): Promise<ArrayBuffer> {

    try {
      const response = await this.authedFetch(
        `${this.baseUrl}/api/v1/files/${fileIdSegment(fileId)}/download`,
        {},
        { userToken: true },
      );

      if (response.status >= 400) {
        throw await this.errorFrom(response, `Download failed: ${response.status}`);
      }

      return response.arrayBuffer();
    } catch (e) {
      if (e instanceof RiviumStorageException) throw e;
      if ((e as Error).name === 'AbortError') {
        throw new RiviumStorageException('Request timeout', 408, 'TIMEOUT');
      }
      throw new RiviumStorageException(`Download error: ${(e as Error).message}`);
    }
  }

  /// Delete a file by ID
  async delete(fileId: string): Promise<void> {
    await this.request('DELETE', `/api/v1/files/${fileIdSegment(fileId)}`, { userToken: true });
  }

  /// Delete a file by path in bucket
  async deleteByPath(bucketId: string, path: string): Promise<void> {
    await this.request('DELETE', `/api/v1/buckets/${bucketSegment(bucketId)}/files/${encodePathSegments(path)}`, {
      userToken: true,
    });
  }

  /// Delete multiple files by IDs
  ///
  /// Returns the number of files successfully deleted
  async deleteMany(fileIds: string[]): Promise<DeleteManyResult> {
    return this.request<DeleteManyResult>('POST', '/api/v1/files/delete-many', {
      body: { ids: fileIds },
      fromJson: (data) => data as unknown as DeleteManyResult,
      userToken: true,
    });
  }

  // ==========================================
  // Links
  // ==========================================

  /// The public link of a file in a PUBLIC bucket:
  /// `https://storage.rivium.co/public/<bucketId>/<path>`. Anyone can open
  /// it without a key or token, so it goes straight into an image view.
  /// One request to `GET /api/v1/files/:id/url`; a file in a private bucket
  /// is refused with `403` (it has no public link: use `download()`, or a
  /// signed link from your server).
  ///
  /// With `transforms` the link is a resized / converted image, still with
  /// no headers: `getPublicUrl(id, { width: 600, format: 'webp' })` gives
  /// `.../public/<bucketId>/<path>?w=600&f=webp`, for `<img src>`, `srcset`
  /// or React Native's `<Image source={{ uri }}>`. The options are checked
  /// first (`invalid_transform`, 400, before any request) and written in a
  /// fixed order, so the same options always give the same URL: the CDN and
  /// the server cache it as one image (replacing the file updates it). One
  /// image keeps at most 50 different variants (`too_many_variants`, 429):
  /// use a few fixed sizes. Plans without image transforms (Free) answer
  /// `plan_feature_locked` (403).
  async getPublicUrl(fileId: string, transforms?: ImageTransforms): Promise<string> {
    // invalid_transform before any request.
    const query = transformQuery(transforms);
    // Works with the key alone (no user token), so it never waits for one.
    const result = await this.request<{ url: string }>('GET', `/api/v1/files/${fileIdSegment(fileId)}/url`);
    return query ? publicImageUrl(result.url, transforms) : result.url;
  }

  /// The image URL for a public link you already have (from `getPublicUrl()`,
  /// saved in your database), with no request: the link plus the transform
  /// options, checked and written exactly as `getPublicUrl(id, transforms)`
  /// writes them. Throws `invalid_transform` (400) for an option the server
  /// would refuse and `invalid_path` (400) when `publicUrl` isn't a public
  /// file link. Also exported as the function `publicImageUrl`.
  static publicImageUrl(publicUrl: string, transforms?: ImageTransforms): string {
    return publicImageUrl(publicUrl, transforms);
  }

  /// The API address `GET /api/v1/files/:id/url`. Called with the
  /// `x-api-key` header it answers `{ url }`, the public link above; the
  /// address itself is not a link to the file. Use `getPublicUrl()`, which
  /// makes that request for you.
  getUrl(fileId: string): string {
    return `${this.baseUrl}/api/v1/files/${fileIdSegment(fileId)}/url`;
  }

  /// The API address of a transformed image:
  /// `/api/v1/transform/:id?w=&h=&fit=&f=&q=&blur=&sharpen=&rotate=`.
  ///
  /// Options are checked first: `format` jpeg / png / webp / avif, `fit`
  /// cover / contain / fill / inside / outside, `width` / `height` 1..4096
  /// (larger values are sent as 4096), `quality` 1..100, `blur` 0..20,
  /// `sharpen` 0..10; anything else throws `invalid_transform` (400).
  ///
  /// Like every `/api/v1` address it needs the `x-api-key` header (and the
  /// user token where your rules ask for one), so load it with `fetch` and
  /// headers, not as a plain `<img src>`.
  getTransformUrl(fileId: string, transforms?: ImageTransforms): string {
    const query = transformQuery(transforms);
    return `${this.baseUrl}/api/v1/transform/${fileIdSegment(fileId)}${query}`;
  }

  /// The API address of a file's bytes, `/api/v1/files/:id/download`. It
  /// needs the `x-api-key` header (and the user token where your rules ask
  /// for one); `download()` sends them for you.
  getDownloadUrl(fileId: string): string {
    return `${this.baseUrl}/api/v1/files/${fileIdSegment(fileId)}/download`;
  }
}
