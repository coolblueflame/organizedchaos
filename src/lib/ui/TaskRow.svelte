<!--
  One task row: checkbox, name, tag dots, deadline + priority glyphs.
  Tapping the body expands the editor; completed rows show restore instead.
-->
<script lang="ts">
  import { slide } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { toast } from './toast.svelte';
  import { isEscalated, effectivePriority } from '../domain/priority';
  import { daysUntilDeadline } from '../domain/time';
  import type { Task } from '../domain/types';
  import { tagColor } from './tagColors';
  import TaskEditor from './TaskEditor.svelte';
  import { burstFromElement, motionOk } from './fx/particles';
  import { haptic } from './fx/haptics';

  let {
    task, expanded = false, ontoggle, onenter, showList = false, completedMode = false,
  }: {
    task: Task;
    expanded?: boolean;
    ontoggle: () => void;
    /** Enter in the name field — the list view chains a new task (rapid entry). */
    onenter?: (currentName: string) => void;
    showList?: boolean;
    completedMode?: boolean;
  } = $props();

  const now = new Date();
  const effective = $derived(effectivePriority(task, app.state.settings, now));
  const escalated = $derived(isEscalated(task, app.state.settings, now));
  const overdue = $derived(
    task.deadline !== undefined &&
    daysUntilDeadline(task.deadline, now, app.state.settings.rolloverHour) < 0,
  );
  const listTitle = $derived(app.state.lists.find((l) => l.id === task.listId)?.title);
  const rowTags = $derived(task.tagIds
    .map((id) => app.state.tags.find((t) => t.id === id))
    .filter((t) => t !== undefined));

  let checkEl: HTMLButtonElement | undefined = $state();
  let completing = $state(false);

  // The row title IS the name field (no duplicate input in the editor below):
  // expanding focuses it with the text selected, ready to retype.
  let nameEl: HTMLInputElement | undefined = $state();
  // svelte-ignore state_referenced_locally
  let nameDraft = $state(task.name);
  let nameTimer: ReturnType<typeof setTimeout> | undefined;

  function queueNameSave() {
    clearTimeout(nameTimer);
    // First real keystroke saves immediately so the task stops being "pristine"
    // before any discard check can run; the rest debounce normally.
    if (task.name === '' && nameDraft.trim() !== '') {
      void flushName();
      return;
    }
    nameTimer = setTimeout(() => void flushName(), 400);
  }

  async function flushName(): Promise<void> {
    clearTimeout(nameTimer);
    if (nameDraft !== task.name) await app.patchTask(task.id, { name: nameDraft });
  }

  /** Always flush BEFORE handing control back, so no save is left in flight. */
  async function collapse() {
    await flushName();
    ontoggle();
  }

  async function onNameKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      await collapse();
      return;
    }
    if (e.key !== 'Enter') return;
    await flushName();
    if (onenter) onenter(nameDraft);
    else ontoggle();
  }

  $effect(() => {
    if (expanded && nameEl) {
      nameEl.focus();
      nameEl.select();
    }
  });

  function complete() {
    if (completing) return;
    completing = true;
    // Juice is garnish — the mutation below runs even if fx throw (spec P5).
    try {
      if (checkEl) burstFromElement(checkEl, { colors: ['#7ee787', '#56d4dd', '#e3b341'] });
      haptic('success');
    } catch { /* never block completion on fx */ }
    setTimeout(() => void app.completeTask(task.id), motionOk() ? 280 : 0);
  }

  function restore() {
    void app.uncompleteTask(task.id);
  }

  function remove() {
    const id = task.id;
    void app.removeTask(id).then(() => toast.show('Task deleted', () => void app.restoreTask(id)));
  }

  const shortDate = (key: string) => {
    const [, m, d] = key.split('-');
    return `${Number(m)}/${Number(d)}`;
  };
</script>

<div class="row" class:expanded transition:slide={{ duration: 220 }} data-testid="task-row-{task.id}">
  <div class="line">
    {#if completedMode}
      <button class="restore" data-testid="task-restore-{task.id}" onclick={restore} aria-label="restore">↩</button>
    {:else}
      <button class="check" class:completing bind:this={checkEl}
        data-testid="task-check-{task.id}" onclick={complete} aria-label="complete"></button>
    {/if}

    {#if expanded && !completedMode}
      <input
        class="name-input"
        data-testid="task-name-input"
        placeholder="task name"
        bind:this={nameEl}
        bind:value={nameDraft}
        oninput={queueNameSave}
        onblur={() => void flushName()}
        onkeydown={onNameKey} />
    {:else}
    <button class="body" onclick={ontoggle}>
      <span class="name" class:done={completedMode}>{task.name || 'untitled'}</span>
      {#if showList && listTitle}<span class="list-tag">{listTitle}</span>{/if}
      <span class="badges">
        {#each rowTags as t (t.id)}
          <span class="tag-dot" style="background: {tagColor(t.colorIndex)}"></span>
        {/each}
        {#if task.deadline}
          <span class="deadline" class:overdue>{shortDate(task.deadline)}</span>
        {/if}
        {#if escalated}<span class="flame" title="escalated by deadline">▲</span>{/if}
        <span class="prio {effective}"></span>
      </span>
    </button>
    {/if}

    {#if !completedMode && !expanded}
      <button class="delete" data-testid="task-delete-{task.id}" onclick={remove} aria-label="delete">✕</button>
    {/if}
  </div>

  {#if expanded && !completedMode}
    <TaskEditor {task} oncollapse={() => void collapse()} />
  {/if}
</div>

<style>
  .row {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    padding: 0 10px;
  }
  .row.expanded { border-color: var(--acc-blue); }
  .line { display: flex; align-items: center; gap: 10px; min-height: 44px; }
  .check {
    width: 20px; height: 20px; flex: none; border-radius: 6px;
    border: 1.5px solid var(--dim); background: none; cursor: pointer;
  }
  .check:hover { border-color: var(--acc-green); box-shadow: 0 0 6px var(--acc-green); }
  .check.completing {
    border-color: var(--acc-green); background: var(--acc-green);
    box-shadow: 0 0 10px var(--acc-green);
    transition: background 0.15s ease, box-shadow 0.15s ease;
  }
  .check.completing::after {
    content: '✓'; display: block; color: var(--bg0);
    font-size: 0.8rem; font-weight: 900; line-height: 17px; text-align: center;
  }
  .restore {
    width: 24px; height: 24px; flex: none; background: none; border: none;
    color: var(--acc-green); font-size: 1rem; cursor: pointer; padding: 0;
  }
  .body {
    flex: 1; display: flex; align-items: center; gap: 8px; background: none; border: none;
    color: var(--text); font-size: 0.9rem; padding: 10px 0; cursor: pointer;
    text-align: left; min-width: 0;
  }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name.done { text-decoration: line-through; color: var(--dim); }
  /* Reads as the title, behaves as the field — same size, same weight, no chrome. */
  .name-input {
    flex: 1; min-width: 0; background: none; border: none;
    border-bottom: 1px solid var(--acc-blue);
    color: var(--text); font-size: 0.9rem; font-family: inherit;
    padding: 11px 0 9px; outline: none;
  }
  .name-input::placeholder { color: var(--dim); }
  .list-tag { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; flex: none; }
  .badges { margin-left: auto; display: flex; align-items: center; gap: 5px; flex: none; }
  .tag-dot { width: 7px; height: 7px; border-radius: 50%; }
  .deadline { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .deadline.overdue { color: var(--acc-magenta); font-weight: 700; }
  .flame { color: var(--acc-orange); font-size: 0.65rem; }
  .prio { width: 8px; height: 8px; border-radius: 50%; }
  .prio.someday { background: var(--dim); opacity: 0.4; }
  .prio.low { background: var(--acc-blue); }
  .prio.medium { background: var(--acc-green); }
  .prio.high { background: var(--acc-orange); }
  .prio.max { background: var(--acc-magenta); }
  .delete {
    background: none; border: none; color: var(--dim); cursor: pointer;
    font-size: 0.8rem; padding: 4px; flex: none;
  }
  .delete:hover { color: var(--acc-magenta); }
  @media (hover: hover) {
    .delete { opacity: 0; }
    .row:hover .delete { opacity: 1; }
  }
</style>
