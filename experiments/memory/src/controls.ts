/** Ordinary application control state around async graph nodes, not a replacement scheduler. */
export class Controls {
  held = false;
  closing = false;
  private released: (() => void)[] = [];
  hold() { this.held = true; }
  resume() { this.held = false; for (const release of this.released.splice(0)) release(); }
  async boundary(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason ?? new Error('Canceled');
    if (this.held) await new Promise<void>((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { this.released = this.released.filter(x => x !== done); reject(signal?.reason ?? new Error('Canceled')); };
      this.released.push(done); signal?.addEventListener('abort', abort, { once: true });
    });
    if (signal?.aborted) throw signal.reason ?? new Error('Canceled');
  }
}
