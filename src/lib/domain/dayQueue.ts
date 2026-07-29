/**
 * The day queue (2026-07-29 request): a hand-ordered plan for days where a
 * specific order makes sense. The user queues tasks in the morning, drags them
 * into order, and the randomizer serves the queue top first whenever it can.
 *
 * Stored as an ordered list of task ids in a synced kv singleton (newest-wins
 * by stamp, like settings). Ids whose tasks complete or disappear simply stop
 * resolving — the same inert-dangling-reference rule tags use — so finishing
 * work IS how the queue drains.
 */
import type { Task } from './types';

/** The queue as the user sees it: ids that still point at live, open tasks. */
export function liveQueueIds(ids: string[], tasks: Task[]): string[] {
  const open = new Set<string>();
  for (const t of tasks) {
    if (!t.deleted && t.completedAt === undefined) open.add(t.id);
  }
  return ids.filter((id) => open.has(id));
}
