<!--
  Shared grouped-task body for the list and sort views: group headers, rows,
  within-group sub-sorting, and drag-to-regroup (drop a task on a header to
  adopt that group's priority / tag / deadline).

  Uses pointer events rather than HTML5 drag-and-drop, which iOS Safari does
  not support for touch — this way the same code works on phone and desktop.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import type { TaskGroup } from '../domain/views';
  import { regroupPatch } from '../domain/regroup';
  import type { Task } from '../domain/types';
  import TaskRow from './TaskRow.svelte';
  import { haptic } from './fx/haptics';

  let {
    groups,
    mode,
    editingTaskId = $bindable(),
    showList = false,
    onenter,
  }: {
    groups: TaskGroup[];
    /** Which attribute a drop assigns; null disables dragging. */
    mode: 'priority' | 'tag' | 'date' | null;
    editingTaskId: string | null;
    showList?: boolean;
    onenter?: (name: string) => void;
  } = $props();

  const DRAG_THRESHOLD = 8; // px before a press becomes a drag, so taps still work

  let dragging = $state<Task | null>(null);
  let pointerY = $state(0);
  let pointerX = $state(0);
  let hoverKey = $state<string | null>(null);
  let origin: { x: number; y: number } | null = null;
  let candidate: Task | null = null;

  function onPointerDown(e: PointerEvent, task: Task) {
    if (!mode || e.button !== 0) return;
    candidate = task;
    origin = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: PointerEvent) {
    if (!candidate || !origin) return;
    if (!dragging) {
      const far = Math.hypot(e.clientX - origin.x, e.clientY - origin.y);
      if (far < DRAG_THRESHOLD) return;
      dragging = candidate;
      haptic('tick');
    }
    pointerX = e.clientX;
    pointerY = e.clientY;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    hoverKey = el?.closest<HTMLElement>('[data-group-key]')?.dataset.groupKey ?? null;
  }

  async function onPointerUp() {
    const task = dragging;
    const key = hoverKey;
    candidate = null;
    origin = null;
    dragging = null;
    hoverKey = null;
    if (!task || !key || !mode) return;

    const tagName = app.state.tags.find((t) => t.id === key)?.name;
    const change = regroupPatch(task, mode, key, tagName);
    if (!change) return;
    await app.patchTask(task.id, change.patch);
    await app.markReviewed(task.id);
    haptic('success');
  }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={() => void onPointerUp()} />

<section class="groups" class:dragging={dragging !== null}>
  {#each groups as group (group.key)}
    <h2
      class="group-header"
      class:drop-target={dragging !== null}
      class:hovered={hoverKey === group.key}
      data-group-key={group.key}
      data-testid="group-{group.key}">
      {group.label}
      {#if dragging && hoverKey === group.key}<span class="drop-hint">drop to move here</span>{/if}
    </h2>
    {#each group.tasks as task (group.key + task.id)}
      <!-- Presentational drag wrapper; the row inside keeps all the semantics. -->
      <div
        class="draggable"
        role="presentation"
        class:lifted={dragging?.id === task.id}
        onpointerdown={(e) => onPointerDown(e, task)}>
        <TaskRow
          {task}
          {showList}
          {onenter}
          expanded={editingTaskId === task.id}
          ontoggle={() => {
            editingTaskId = editingTaskId === task.id ? null : task.id;
            if (editingTaskId) void app.markReviewed(task.id);
          }} />
      </div>
    {/each}
  {/each}
</section>

{#if dragging}
  <div class="ghost" style="left: {pointerX}px; top: {pointerY}px">
    {dragging.name || 'untitled'}
  </div>
{/if}

<style>
  .groups { display: flex; flex-direction: column; gap: 6px; }
  .groups.dragging { user-select: none; touch-action: none; }
  .group-header {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.1em; margin: 14px 0 2px; font-weight: 600;
    display: flex; align-items: center; gap: 8px; border-radius: 6px; padding: 2px 4px;
  }
  .group-header.drop-target { outline: 1px dashed var(--line); outline-offset: 2px; }
  .group-header.hovered {
    color: var(--acc-green); outline-color: var(--acc-green);
    background: rgba(126, 231, 135, 0.08);
  }
  .drop-hint { font-size: 0.6rem; opacity: 0.8; text-transform: none; letter-spacing: 0; }
  .draggable.lifted { opacity: 0.35; }
  .ghost {
    position: fixed; z-index: 500; pointer-events: none;
    transform: translate(-50%, -140%);
    background: var(--bg2); border: 1px solid var(--acc-green); border-radius: 8px;
    color: var(--text); font-size: 0.8rem; padding: 6px 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55); max-width: 60vw;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
</style>
