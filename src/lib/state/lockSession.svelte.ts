/**
 * Session lock state for locked lists. Lives in state/ (not ui/) because the
 * STORE's draw path must honour it too — unlocking lasts until reload or an
 * explicit relock; deliberately never persisted.
 */
class LockSession {
  unlocked = $state(false);

  relock(): void {
    this.unlocked = false;
  }
}

export const lockSession = new LockSession();
