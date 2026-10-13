/** Keeps the screen on during a session where the Screen Wake Lock API is available. */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private readonly onVisibility = () => {
    if (this.wanted && document.visibilityState === 'visible') void this.acquire();
  };

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  async enable(): Promise<boolean> {
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    return this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    try {
      await this.sentinel?.release();
    } catch {
      /* already released */
    }
    this.sentinel = null;
  }

  private async acquire(): Promise<boolean> {
    if (!ScreenWakeLock.supported) return false;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      return true;
    } catch {
      return false;
    }
  }
}
