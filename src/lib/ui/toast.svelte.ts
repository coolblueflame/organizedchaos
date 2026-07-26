/**
 * Singleton undo-toast state. Deletions everywhere route through this:
 * show a 5s toast whose Undo callback flips the tombstone back.
 */
class ToastStore {
  current: { label: string; onUndo: () => void } | null = $state(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(label: string, onUndo: () => void, ms = 5000): void {
    clearTimeout(this.timer);
    this.current = { label, onUndo };
    this.timer = setTimeout(() => (this.current = null), ms);
  }

  undo(): void {
    this.current?.onUndo();
    this.dismiss();
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.current = null;
  }
}

export const toast = new ToastStore();
