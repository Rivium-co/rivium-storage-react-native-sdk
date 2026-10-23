import type { UploadProgress } from './models';

/// Turns XMLHttpRequest upload events into throttled `onProgress` calls: at
/// most one every `minIntervalMs` unless at least 1% more was sent, never
/// going backwards (a re-send after a token refresh starts again from 0 on
/// the wire), never above the total, and always ending with
/// `bytesSent === totalBytes` exactly once.
export class UploadProgressReporter {
  private total = 0;
  private lastSent = -1;
  private lastTime = 0;
  private finished = false;
  /** Bytes sent while the size is unknown, so `finish()` can close. */
  private lastSentUnknown = 0;

  constructor(
    private readonly onProgress: (progress: UploadProgress) => void,
    private readonly minIntervalMs = 50,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /// From `xhr.upload.onprogress`.
  report(loaded: number, total: number): void {
    if (total > 0 && this.lastSent < 0) this.total = total;
    if (this.total <= 0) {
      if (loaded > this.lastSentUnknown) this.lastSentUnknown = loaded;
      return;
    }
    this.emit(loaded);
  }

  /// The upload succeeded: make sure the final event (sent === total) went out.
  finish(): void {
    if (this.total <= 0) this.total = this.lastSentUnknown;
    this.emit(this.total);
  }

  private emit(rawSent: number): void {
    if (this.finished || this.total <= 0) return;
    const sent = Math.min(Math.max(rawSent, 0), this.total);
    if (sent <= this.lastSent) return;
    const isFinal = sent === this.total;
    const time = this.now();
    if (!isFinal && this.lastSent >= 0) {
      const onePercent = Math.max(1, Math.floor(this.total / 100));
      if (time - this.lastTime < this.minIntervalMs && sent - this.lastSent < onePercent) return;
    }
    this.lastSent = sent;
    this.lastTime = time;
    if (isFinal) this.finished = true;
    try {
      this.onProgress({ bytesSent: sent, totalBytes: this.total });
    } catch (e) {
      // A throwing callback must not break the upload.
      console.error('[RiviumStorage] onProgress threw:', e);
    }
  }
}
