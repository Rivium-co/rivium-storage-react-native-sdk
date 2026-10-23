/**
 * "Bucket setup": compares the two test buckets with what the checks expect (what `npm run setup-buckets` creates)
 * and says, for every difference, the exact Console setting to change. Every check that depends on a setting asks
 * this result first and SKIPs with the matching hint instead of failing because of the bucket's configuration.
 *
 * The same rules (and texts) are in every example (Node: sdk/nodejs/Example/src/bucket-setup.ts, Android, iOS, Flutter,
 * React Native, Web): keep them in step.
 *
 * Expected:
 *   public bucket   visibility public; allows image/png, application/pdf, text/plain, application/json, text/csv,
 *                   text/markdown (no allowed types = any type, which is what setup creates); executables blocked
 *   private bucket  visibility private; images only (JPEG / PNG / GIF / WebP: no PDF, no text, no HTML);
 *                   max file size 1 MB; executables blocked
 *   both            rules "users' own folders" (not readable with the app key, so not compared here)
 *
 * A field the API does not send (blockExecutables before the 10-22 Storage API) is "unknown", never "wrong".
 */

export const MB = 1024 * 1024;
/** What setup gives the private bucket (PRIVATE_BUCKET_MAX_SIZE default). */
export const EXPECTED_PRIVATE_MAX = MB;
/** The "too big" check uploads max + 1 bytes: it runs only when the limit is known and at most this. */
export const TOO_BIG_CHECK_LIMIT = 10 * MB;

/** Every type the checks put in the public bucket. */
export const PUBLIC_TYPES: Array<{ mime: string; label: string }> = [
  { mime: 'image/png', label: 'PNG' },
  { mime: 'application/pdf', label: 'PDF' },
  { mime: 'text/plain', label: 'TXT' },
  { mime: 'application/json', label: 'JSON' },
  { mime: 'text/csv', label: 'CSV' },
  { mime: 'text/markdown', label: 'Markdown' },
];
/** Types the private bucket must refuse (the "not allowed" / "content mismatch" checks send them). */
export const PRIVATE_REFUSES = ['application/pdf', 'text/plain', 'text/html'];

export const SETUP_ONE_LINER = 'Or run `npm run setup-buckets` in sdk/nodejs/Example.';

export interface BucketFacts {
  name: string;
  /** False when the bucket does not exist. */
  found: boolean;
  visibility?: string;
  allowedMimeTypes?: string[] | null;
  maxFileSize?: number | null;
  /** null = the API did not say (older Storage API). */
  blockExecutables?: boolean | null;
}

/** Same matching as the Storage API: no list = any type; type/* wildcards; '*' and '*\/*' match all. */
export function allowsType(types: string[] | null | undefined, mime: string): boolean {
  if (!types || types.length === 0) return true;
  const m = mime.toLowerCase();
  return types.some((raw) => {
    const p = (raw || '').trim().toLowerCase();
    if (p === '*' || p === '*/*') return true;
    if (p.endsWith('/*')) return m.startsWith(p.slice(0, -1));
    return p === m;
  });
}

function mb(bytes: number): string {
  return bytes % MB === 0 ? `${bytes / MB} MB` : `${bytes} bytes`;
}

export class BucketSetup {
  constructor(public readonly pub: BucketFacts, public readonly priv: BucketFacts) {}

  private console(b: BucketFacts): string {
    return `Console › Storage › Buckets › ${b.name} › Settings`;
  }

  /** Differences from the expected setup, each with the Console fix. Empty = all good. */
  differences(): string[] {
    const out: string[] = [];
    const { pub, priv } = this;
    for (const [b, which] of [[pub, 'Public'], [priv, 'Private']] as const) {
      if (!b.found) out.push(`${which} bucket ${b.name} doesn't exist → create it: Console › Storage › Buckets › New bucket (${which.toLowerCase()}), with the settings below.`);
    }
    if (pub.found) {
      if (pub.visibility !== 'public') out.push(`Public bucket ${pub.name} is ${pub.visibility} → ${this.console(pub)} › Visibility: Public`);
      const missing = PUBLIC_TYPES.filter((t) => !allowsType(pub.allowedMimeTypes, t.mime));
      if (missing.length) {
        out.push(
          `Public bucket ${pub.name} doesn't allow ${missing.map((t) => t.mime).join(', ')} → ${this.console(pub)} › Allowed file types: ` +
            `none selected (= any type), or tick ${missing.map((t) => t.label).join(', ')} (Images · Documents · Text · Data)`,
        );
      }
      if (pub.blockExecutables === false) out.push(`Public bucket ${pub.name} doesn't block executables → ${this.console(pub)} › Block executable files: on`);
    }
    if (priv.found) {
      if (priv.visibility !== 'private') out.push(`Private bucket ${priv.name} is ${priv.visibility} → ${this.console(priv)} › Visibility: Private`);
      if (!allowsType(priv.allowedMimeTypes, 'image/png')) {
        out.push(`Private bucket ${priv.name} doesn't allow image/png → ${this.console(priv)} › Allowed file types › Images: tick JPEG, PNG, GIF, WebP`);
      }
      const extra = PRIVATE_REFUSES.filter((m) => allowsType(priv.allowedMimeTypes, m));
      if (extra.length) {
        const what = !priv.allowedMimeTypes || priv.allowedMimeTypes.length === 0 ? 'any file type' : extra.join(', ');
        out.push(`Private bucket ${priv.name} allows ${what} → ${this.console(priv)} › Allowed file types: images only (JPEG, PNG, GIF, WebP; nothing else)`);
      }
      if (priv.maxFileSize != null && priv.maxFileSize !== EXPECTED_PRIVATE_MAX) {
        out.push(`Private bucket ${priv.name} max file size is ${mb(priv.maxFileSize)}, the checks expect ${mb(EXPECTED_PRIVATE_MAX)} → ${this.console(priv)} › Upload limits › Max file size: 1 MB`);
      }
      if (priv.blockExecutables === false) out.push(`Private bucket ${priv.name} doesn't block executables → ${this.console(priv)} › Block executable files: on`);
    }
    return out;
  }

  /** Fields the API did not send. */
  unknowns(): string[] {
    return [this.pub, this.priv]
      .filter((b) => b.found && (b.blockExecutables === null || b.blockExecutables === undefined))
      .map((b) => `${b.name}: "Block executable files" unknown (older Storage API sends no blockExecutables)`);
  }

  // ---- Preconditions: null = the check can run; otherwise the SKIP text. ----

  /** The private bucket refuses `mime` ("Error: type not allowed", "content mismatch"). */
  privateRefuses(mime: string): string | null {
    if (!this.priv.found) return `${this.priv.name} doesn't exist. ${SETUP_ONE_LINER}`;
    if (!allowsType(this.priv.allowedMimeTypes, mime)) return null;
    return `${this.priv.name} allows ${mime}, so nothing is refused. Set ${this.console(this.priv)} › Allowed file types: images only to run this check. ${SETUP_ONE_LINER}`;
  }

  /** The private bucket has a small, known max size ("too big"). */
  privateHasMaxSize(): string | null {
    const max = this.priv.maxFileSize;
    if (this.priv.found && max != null && max > 0 && max <= TOO_BIG_CHECK_LIMIT) return null;
    return `${this.priv.name} has no max file size of ${mb(TOO_BIG_CHECK_LIMIT)} or less${max ? ` (it is ${mb(max)})` : ''}. Set ${this.console(this.priv)} › Upload limits › Max file size: 1 MB to run this check. ${SETUP_ONE_LINER}`;
  }

  /** The bucket blocks executables ("executable_blocked"). Unknown = run it. */
  blocksExecutables(which: 'public' | 'private'): string | null {
    const b = which === 'public' ? this.pub : this.priv;
    if (b.found && b.blockExecutables !== false) return null;
    if (!b.found) return `${b.name} doesn't exist. ${SETUP_ONE_LINER}`;
    return `${b.name} doesn't block executable files. Set ${this.console(b)} › Block executable files: on to run this check. ${SETUP_ONE_LINER}`;
  }

  /** The public bucket allows every one of `mimes` ("Upload progress", "file types", the PDF / text uploads). */
  publicAllows(...mimes: string[]): string | null {
    if (!this.pub.found) return `${this.pub.name} doesn't exist. ${SETUP_ONE_LINER}`;
    const missing = mimes.filter((m) => !allowsType(this.pub.allowedMimeTypes, m));
    if (!missing.length) return null;
    const labels = missing.map((m) => PUBLIC_TYPES.find((t) => t.mime === m)?.label ?? m);
    return `${this.pub.name} doesn't allow ${missing.join(', ')}. Set ${this.console(this.pub)} › Allowed file types: tick ${labels.join(', ')} (or none selected = any type) to run this check. ${SETUP_ONE_LINER}`;
  }

  /** The private bucket allows image/png (the private uploads). */
  privateAllowsPng(): string | null {
    if (!this.priv.found) return `${this.priv.name} doesn't exist. ${SETUP_ONE_LINER}`;
    if (allowsType(this.priv.allowedMimeTypes, 'image/png')) return null;
    return `${this.priv.name} doesn't allow image/png. Set ${this.console(this.priv)} › Allowed file types › Images: tick PNG to run this check. ${SETUP_ONE_LINER}`;
  }
}

/**
 * An OLDER Storage API (before the error codes) refuses correctly but sends no `code`. Where a check expects one of
 * these codes, a 400 without a code whose message is the known text also counts, with a note.
 */
export const LEGACY_MESSAGES: Record<string, RegExp> = {
  type_not_allowed: /is not allowed in this bucket/i,
  file_too_large: /exceeds maximum/i,
  executable_blocked: /Executable files are blocked in this bucket/i,
};
export const LEGACY_NOTE = 'server sent no code (older Storage API)';

/** True when `code` is missing but status 400 and the message is the known text for `expected`. */
export function legacyMatch(expected: string, status: number | undefined | null, code: string | undefined | null, message: string): boolean {
  const re = LEGACY_MESSAGES[expected];
  return !!re && !code && status === 400 && re.test(message || '');
}
