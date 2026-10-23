import React, { createContext, useContext, useEffect, useReducer } from 'react';
import { RiviumStorage, StorageErrorCode, StorageFile } from '@rivium/storage-react-native';
import { fromUtf8 } from './bytes';
import { ExampleSettings, saveSettings, settingsFromBuild } from './config';

export type Identity = 'anonymous' | 'userToken';

/** Plain HTTP failure (for the links the SDK returns as strings). */
export class HttpFailure extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body}`);
    this.name = 'HttpFailure';
  }
}

/**
 * A refused image transform as an app should show it: a title per `code`, the
 * server's message, the code and what to do. The app fetches transform URLs
 * itself, so it reads `code` / `message` from the JSON body of the non-2xx
 * answer (never the raw body or the URL with the file id).
 */
export class TransformRefusal extends Error {
  readonly code: string | undefined;
  readonly title: string;
  readonly hint: string | undefined;
  /** Seconds from the `Retry-After` header (`transform_busy` sends 2), when the answer had one. */
  retryAfter: number | undefined;

  constructor(public status: number, body: string) {
    let json: { code?: unknown; message?: unknown } = {};
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object') json = parsed;
    } catch {
      // not JSON: status only
    }
    const message = Array.isArray(json.message)
      ? json.message.join(', ')
      : typeof json.message === 'string' && json.message
        ? json.message
        : `The server answered HTTP ${status}.`;
    super(message);
    this.name = 'TransformRefusal';
    this.code = typeof json.code === 'string' && json.code ? json.code : undefined;
    [this.title, this.hint] = transformTitle(this.code, status);
  }

  /** The lines under the title. */
  get details(): string {
    return [this.message, `code: ${this.code ?? '(none)'} · HTTP ${this.status}`, this.hint ? `What to do: ${this.hint}` : null]
      .filter(Boolean)
      .join('\n');
  }
}

function transformTitle(code: string | undefined, status: number): [string, string | undefined] {
  const denied: [string, string] = ['Access denied', "The bucket's access rules refused this user."];
  switch (code) {
    case StorageErrorCode.ImageFormatNotSupported:
      return ['Format not supported', 'Convert it to JPEG, PNG or WebP and upload it again.'];
    case StorageErrorCode.NotAnImage:
      return ['Not an image', 'Pick an image file.'];
    case StorageErrorCode.ImageDamaged:
      return ['Image damaged', 'Upload it again.'];
    case StorageErrorCode.ImageTooLarge:
      return ['Image too large', 'Use a smaller image (up to 50 megapixels).'];
    case StorageErrorCode.InvalidTransform:
      return ['Invalid options', 'Change the transform options.'];
    case StorageErrorCode.SourceTooLarge:
      return ['File too large', 'Use an image under 25 MB.'];
    case StorageErrorCode.PlanFeatureLocked:
      return ['Not in your plan', "Image transforms aren't in this project's plan (Free). Upgrade the plan, or show the plain public link."];
    case StorageErrorCode.TooManyVariants:
      return ['Too many sizes', 'This image already has 50 sizes / formats. Use a few fixed sizes (for example 200, 600 and 1200 wide).'];
    case StorageErrorCode.TransformBusy:
      return ['Busy', 'Image processing is busy. Try again in a moment.'];
    case StorageErrorCode.TokenRequired:
    case StorageErrorCode.TokenInvalid:
    case StorageErrorCode.TokenExpired:
      return ['Sign-in needed', 'Sign in again (Setup), then retry.'];
    case StorageErrorCode.AccessDenied:
      return denied;
  }
  if (status === 403) return denied;
  if (status === 404) return ['File not found', 'Upload the image again.'];
  return ["Couldn't transform the image", undefined];
}

/** GET a transform address with headers; a refusal becomes a TransformRefusal. */
export async function fetchTransform(url: string, headers: Record<string, string>): Promise<FetchedBytes> {
  try {
    return await fetchBytes(url, headers);
  } catch (e) {
    if (e instanceof HttpFailure) throw new TransformRefusal(e.status, e.body);
    throw e;
  }
}

/** A public image URL loaded with no headers at all. */
export interface PublicImageLoad {
  status: number;
  contentType: string;
  bytes: number;
  /** `X-Transform-Cache`: miss (made now), hit (from the cache), uncached; null when absent. */
  cache: string | null;
  /** `CF-Cache-Status` when the CDN answered (HIT = the CDN's copy). */
  cdn: string | null;
}

/**
 * GET a public image URL with NO headers (no key, no user token), as <Image source={{ uri }}> does. A refusal becomes
 * a TransformRefusal with `retryAfter`. `noStore`: fetch's `cache: 'no-store'`, which in React Native adds an ignored
 * `_=<time>` parameter, so neither the phone's HTTP cache nor the CDN answers (the server's own cache still does).
 */
export async function loadPublicImage(url: string, noStore = false): Promise<PublicImageLoad> {
  const response = await fetch(url, noStore ? { cache: 'no-store' } : undefined);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (response.status < 200 || response.status >= 300) {
    const refusal = new TransformRefusal(response.status, fromUtf8(bytes.subarray(0, 2000)));
    const retryAfter = Number(response.headers.get('retry-after'));
    if (response.headers.get('retry-after') !== null && Number.isFinite(retryAfter) && retryAfter >= 0) refusal.retryAfter = retryAfter;
    throw refusal;
  }
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '?',
    bytes: bytes.length,
    cache: response.headers.get('x-transform-cache'),
    cdn: response.headers.get('cf-cache-status'),
  };
}

/** `load()`, retried once after Retry-After when the server answers 503 transform_busy. */
export async function withBusyRetry<T>(load: () => Promise<T>, onBusy?: (seconds: number) => void): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (!(e instanceof TransformRefusal) || e.code !== StorageErrorCode.TransformBusy) throw e;
    const seconds = e.retryAfter ?? 2;
    onBusy?.(seconds);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    return load();
  }
}

export interface FetchedBytes {
  bytes: Uint8Array;
  status: number;
  contentType: string;
}

/** fetch() that throws HttpFailure on a non-2xx answer. */
export async function fetchBytes(url: string, headers: Record<string, string> = {}): Promise<FetchedBytes> {
  const response = await fetch(url, { headers });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (response.status < 200 || response.status >= 300) {
    throw new HttpFailure(response.status, fromUtf8(bytes.subarray(0, 2000)).slice(0, 600));
  }
  return { bytes, status: response.status, contentType: response.headers.get('content-type') ?? '?' };
}

async function postJson(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpFailure(response.status, text.slice(0, 600));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Not JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * Talks to YOUR token server, never to Rivium with a secret: the app only
 * ever holds the public key and a short-lived user token.
 */
export async function fetchUserToken(tokenUrl: string, userId: string, expiresIn?: number): Promise<string> {
  if (!tokenUrl) throw new Error('Set the token server URL in Setup (EXPO_PUBLIC_RIVIUM_TOKEN_URL).');
  const body: Record<string, unknown> = { userId };
  if (expiresIn !== undefined) body.expiresIn = expiresIn;
  const answer = await postJson(tokenUrl, body);
  const token = (answer.token ?? answer.userToken) as string | undefined;
  if (!token) throw new Error(`The token server answered without "token": ${JSON.stringify(answer)}`);
  return token;
}

/** The example's state: one SDK client, created the way an app does at start-up. */
export class ExampleModel {
  settings: ExampleSettings = settingsFromBuild();
  storage: RiviumStorage;
  identity: Identity = 'anonymous';
  signedInUserId: string | null = null;
  /** Last token the provider returned (the SDK keeps its own copy private). */
  lastToken: string | null = null;
  providerCalls = 0;
  /** Files uploaded in this session, newest first. */
  recentFiles: StorageFile[] = [];
  private bucketVisibility = new Map<string, string>();
  private listeners = new Set<() => void>();

  constructor() {
    this.storage = this.createClient();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    this.listeners.forEach((l) => l());
  }

  /** new RiviumStorage({ apiKey, tokenProvider }) — the provider returns null while no one is signed in. */
  private createClient(): RiviumStorage {
    const client = new RiviumStorage({
      apiKey: this.settings.apiKey || 'rv_live_missing',
      timeout: 30000,
      tokenProvider: async () => {
        this.providerCalls += 1;
        if (this.identity !== 'userToken' || !this.signedInUserId) {
          this.lastToken = null;
          this.emit();
          return null;
        }
        const token = await fetchUserToken(this.settings.tokenUrl, this.signedInUserId);
        this.lastToken = token;
        this.emit();
        return token;
      },
    });
    // File calls wait while no one is signed in: re-render so the screens show it.
    client.onAwaitingUserToken(() => this.emit());
    return client;
  }

  async updateSettings(settings: ExampleSettings): Promise<void> {
    this.settings = settings;
    this.storage = this.createClient();
    this.bucketVisibility.clear();
    this.emit();
    await saveSettings(settings);
  }

  /** Sign in: the provider now returns this user's token; refreshUserToken() asks for it right away. */
  async signIn(userId: string): Promise<void> {
    this.signedInUserId = userId;
    this.identity = 'userToken';
    this.emit();
    await this.storage.refreshUserToken(); // also lets calls waiting for a token go on
    this.emit();
  }

  /** Sign out: the provider returns null, so file calls wait until the next sign-in. */
  async signOut(): Promise<void> {
    this.signedInUserId = null;
    this.identity = 'anonymous';
    this.emit();
    await this.storage.refreshUserToken();
  }

  /** True while file calls wait for a signed-in user (the SDK's isAwaitingUserToken). */
  get awaitingUserToken(): boolean {
    return this.storage.isAwaitingUserToken;
  }

  /** Signs in as the test user when no one is signed in and a token server is set. */
  async ensureSignedIn(): Promise<void> {
    if (this.identity === 'anonymous' && this.settings.tokenUrl && this.settings.testUserId) {
      await this.signIn(this.settings.testUserId);
    }
  }

  get actingUserId(): string | null {
    if (this.identity === 'userToken') return this.signedInUserId;
    return null;
  }

  /** The folder the userFolders rule lets this user write to. */
  get userFolder(): string {
    return `users/${this.actingUserId ?? this.settings.testUserId}/example/`;
  }

  remember(file: StorageFile): void {
    this.recentFiles = [file, ...this.recentFiles.filter((f) => f.id !== file.id)];
    this.emit();
  }

  forget(ids: string[]): void {
    this.recentFiles = this.recentFiles.filter((f) => !ids.includes(f.id));
    this.emit();
  }

  async isPublic(file: StorageFile): Promise<boolean> {
    let visibility = this.bucketVisibility.get(file.bucketId);
    if (!visibility) {
      visibility = (await this.storage.getBucket(file.bucketId)).visibility;
      this.bucketVisibility.set(file.bucketId, visibility);
    }
    return visibility === 'public';
  }

  /**
   * The identity headers the SDK sends. The API addresses the SDK returns as
   * strings (getUrl, getTransformUrl, getDownloadUrl) need x-api-key, and
   * x-user-token for file routes.
   */
  riviumHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'x-api-key': this.settings.apiKey };
    if (this.identity === 'userToken' && this.lastToken) headers['x-user-token'] = this.lastToken;
    return headers;
  }

  getWithHeaders(url: string): Promise<FetchedBytes> {
    return fetchBytes(url, this.riviumHeaders());
  }

  /** Public bucket: GET getUrl(fileId) with the key → { url }, a link that needs no headers. */
  async publicLink(fileId: string): Promise<string> {
    const response = await fetch(this.storage.getUrl(fileId), { headers: this.riviumHeaders() });
    const text = await response.text();
    if (!response.ok) throw new HttpFailure(response.status, text.slice(0, 600));
    const url = JSON.parse(text)?.url;
    if (typeof url !== 'string') throw new Error(`No "url" in the answer: ${text}`);
    return url;
  }

  /** A time-limited signed link made by YOUR server (it holds the server secret). */
  async signedLink(fileId: string, expiresIn: number): Promise<string> {
    const endpoint = this.settings.signedUrlEndpoint;
    if (!endpoint) {
      throw new Error(
        'Set the signed-link endpoint in Setup (EXPO_PUBLIC_RIVIUM_SIGNED_URL_ENDPOINT). Signed links need the server secret, so only your server can make them.',
      );
    }
    const answer = await postJson(endpoint, { fileId, expiresIn });
    const url = (answer.url ?? answer.signedUrl) as string | undefined;
    if (!url) throw new Error(`The signed-link endpoint answered without "url": ${JSON.stringify(answer)}`);
    return url;
  }

  /** Another endpoint of the example token server, next to the token endpoint (…/token → …/signed-upload). */
  serverEndpoint(name: string): string {
    if (!this.settings.tokenUrl) throw new Error('Set the token server URL in Setup first.');
    return this.settings.tokenUrl.replace(/\/[^/]*$/, `/${name}`);
  }

  /**
   * Upload through a signed upload link: your server makes the link (server
   * secret), the app PUTs the bytes, your server confirms the upload. The app
   * SDK has no method for this, so it is plain fetch. Returns the file, read
   * back through the SDK, and what happened.
   */
  async signedUpload(bytes: Uint8Array, contentType: string, fileName: string): Promise<{ file: StorageFile; log: string }> {
    const log: string[] = [];
    const userId = this.actingUserId ?? this.settings.testUserId;
    // 1. Your server makes the link (it checks who the user is, and type and size, first).
    const link = await postJson(this.serverEndpoint('signed-upload'), {
      bucket: 'private',
      contentType,
      fileName,
      userId,
      expiresIn: 300,
    });
    const url = link.url as string | undefined;
    const path = link.path as string | undefined;
    if (!url || !path) throw new Error(`signed-upload answered without url/path: ${JSON.stringify(link)}`);
    log.push(`1. Server made a 300 s upload link for ${path}`);
    // 2. The app sends the bytes with the same Content-Type and no Rivium headers.
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
    if (!put.ok) throw new HttpFailure(put.status, (await put.text()).slice(0, 600));
    log.push(`2. PUT ${bytes.length} bytes → HTTP ${put.status}`);
    // 3. Your server confirms it, so it is listed right away.
    await postJson(this.serverEndpoint('confirm-upload'), { bucket: 'private', path });
    log.push('3. Server confirmed the upload');
    const file = await this.storage.getFileByPath(this.settings.privateBucket, path);
    log.push('4. getFileByPath finds it through the SDK');
    return { file, log: log.join('\n') };
  }
}

const ModelContext = createContext<ExampleModel | null>(null);

export function ModelProvider({ model, children }: { model: ExampleModel; children: React.ReactNode }) {
  return <ModelContext.Provider value={model}>{children}</ModelContext.Provider>;
}

/** The model; the component re-renders when it changes. */
export function useModel(): ExampleModel {
  const model = useContext(ModelContext);
  if (!model) throw new Error('useModel outside ModelProvider');
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => model.subscribe(rerender), [model]);
  return model;
}
