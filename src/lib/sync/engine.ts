/**
 * Sync orchestration (spec §8): pull → merge → persist locally → push changed
 * files with their shas; on a sha conflict, re-pull and retry (bounded). Local
 * usability is sacred — every failure path leaves local data untouched and
 * just parks the engine in 'offline'/'error' until the next trigger.
 */
import { AuthError, ConflictError, type RemoteFileEntry, type RemoteFile } from './githubClient';
import { fromFiles, toFiles, type RemoteSnapshot, type SyncFilePayloads } from './files';
import { mergeSnapshots } from './merge';

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'error' | 'offline';

/** Structural subset of GithubClient so tests inject an in-memory fake. */
export interface ClientLike {
  listFiles(): Promise<RemoteFileEntry[]>;
  getFile(path: string): Promise<RemoteFile | null>;
  putFile(path: string, json: unknown, sha?: string): Promise<string>;
}

export interface EngineDeps {
  client: ClientLike;
  loadLocal: () => Promise<RemoteSnapshot>;
  saveLocal: (snap: RemoteSnapshot) => Promise<void>;
  debounceMs?: number;
  now?: () => Date;
  /** Test seam for the retry backoff. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Backoff between conflict retries. GitHub's Contents API is eventually
 * consistent — verified live 2026-07-26: a GET issued immediately after a
 * successful PUT can still return the PREVIOUS content and sha. Retrying
 * instantly just re-reads the same stale view and burns an attempt, so each
 * retry waits a beat first. (A stale read can never lose data — the merge is
 * union + newest-wins — it only costs us a conflict.)
 */
const RETRY_BACKOFF_MS = [250, 750, 1750];
const MAX_CONFLICT_RETRIES = RETRY_BACKOFF_MS.length + 1;

export class SyncEngine {
  status: SyncStatus = 'idle';
  statusDetail = '';
  lastSyncAt: number | null = null;
  /** UI subscribes for reactive status display. */
  onStatus?: (status: SyncStatus, detail: string) => void;

  private debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private pending = false;
  private sleep: (ms: number) => Promise<void>;

  constructor(private deps: EngineDeps) {
    this.debounceMs = deps.debounceMs ?? 4000;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private setStatus(status: SyncStatus, detail = ''): void {
    this.status = status;
    this.statusDetail = detail;
    this.onStatus?.(status, detail);
  }

  /** Debounced trigger — call after every mutation. */
  requestSync(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), this.debounceMs);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  /** One full cycle; if one is mid-flight, queues a trailing run instead. */
  async syncNow(): Promise<void> {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    clearTimeout(this.timer);
    this.setStatus('syncing');
    try {
      for (let attempt = 1; ; attempt++) {
        const conflicted = await this.cycleOnce();
        if (!conflicted) break;
        if (attempt >= MAX_CONFLICT_RETRIES) {
          throw new ConflictError('unresolved after retries');
        }
        await this.sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 1750);
      }
      this.lastSyncAt = Date.now();
      this.setStatus('idle');
    } catch (e) {
      if (e instanceof AuthError) this.setStatus('error', e.message);
      else if (e instanceof ConflictError) this.setStatus('error', 'sync conflict would not settle');
      else if (e instanceof TypeError) this.setStatus('offline', 'network unreachable');
      else this.setStatus('error', e instanceof Error ? e.message : String(e));
    } finally {
      this.running = false;
      if (this.pending) {
        this.pending = false;
        void this.syncNow();
      }
    }
  }

  /** Returns true if a sha conflict happened (caller retries with fresh remote). */
  private async cycleOnce(): Promise<boolean> {
    const entries = await this.deps.client.listFiles();
    const remoteFiles = new Map<string, RemoteFile>();
    for (const entry of entries.filter((f) => f.path.endsWith('.json'))) {
      const file = await this.deps.client.getFile(entry.path);
      if (file) remoteFiles.set(entry.path, file);
    }
    const payloads: SyncFilePayloads = {};
    for (const [path, file] of remoteFiles) payloads[path] = file.json;

    const remoteSnap = fromFiles(payloads);
    const local = await this.deps.loadLocal();
    const { merged, localChanged, remoteChanged } = mergeSnapshots(local, remoteSnap);

    if (localChanged) await this.deps.saveLocal(merged);
    if (!remoteChanged) return false;

    const desired = toFiles(merged, (this.deps.now ?? (() => new Date()))());
    try {
      for (const [path, payload] of Object.entries(desired)) {
        const existing = remoteFiles.get(path);
        if (existing && JSON.stringify(existing.json) === JSON.stringify(payload)) continue;
        await this.deps.client.putFile(path, payload, existing?.sha);
      }
    } catch (e) {
      if (e instanceof ConflictError) return true;
      throw e;
    }
    return false;
  }
}
