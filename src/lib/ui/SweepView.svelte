<!--
  The triage sweep (#/sweep): one imported task at a time, a verdict in seconds.

  Built for volume. The drip-triage card in the randomizer is maintenance; this
  is how a 2,000-task imported backlog actually gets reviewed — list by list,
  oldest first, with a progress count that visibly moves. Every verdict routes
  through the same store paths the rest of the app uses, so nothing here is a
  special case: delete has its usual undo toast, done is an ordinary completion.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { SNOOZE_PRESETS, sweepQueue } from '../domain/sweep';
  import type { Task } from '../domain/types';
  import { PRIORITIES, type Priority } from '../domain/types';
  import Glyph from './Glyph.svelte';
  import TagPicker from './TagPicker.svelte';

  const queue = $derived(sweepQueue(app.state.tasks, app.state.lists));
  const current = $derived(queue[0]);

  /** Session tally — the number that makes a sweep feel like winning. */
  let decided = $state(0);
  let laterOpen = $state(false);

  /** The last plain-patch verdict, so a mis-tap is one "put it back" away. */
  let lastPatch = $state<{ id: string; name: string; before: Partial<Task> } | null>(null);

  /*
    Re-filing support (2026-07-28 request): a reorganisation sweep moves card
    after card out of a catch-all into new purpose-built lists, so the last
    destination becomes a one-tap repeat button — pick "Wind-down" once, then
    it's a single tap per card. "+ new list…" exists because the moment you
    realise the right list doesn't exist yet is mid-sweep, and leaving to make
    it would break exactly the flow this screen is for.
  */
  let lastDest = $state<{ id: string; title: string } | null>(null);
  let moveSelect = $state('');
  let creatingList = $state(false);
  let newListTitle = $state('');

  const destinations = $derived(
    app.state.lists.filter((l) => l.archived !== true && l.id !== current?.listId),
  );

  async function moveTo(listId: string) {
    if (!current) return;
    const dest = app.state.lists.find((l) => l.id === listId);
    if (!dest) return;
    laterOpen = false;
    const snapshot = { id: current.id, name: current.name };
    const r = await app.applySweepVerdict(current.id, 'keep', { listId });
    if (r) lastPatch = { ...snapshot, before: r.before };
    lastDest = { id: dest.id, title: dest.title };
    moveSelect = '';
    decided += 1;
  }

  async function onMovePick(value: string) {
    if (value === '__new__') {
      creatingList = true;
      moveSelect = '';
      return;
    }
    if (value) await moveTo(value);
  }

  async function createAndMove() {
    const title = newListTitle.trim();
    creatingList = false;
    newListTitle = '';
    if (!title) return;
    const list = await app.addList(title);
    await moveTo(list.id);
  }

  const listTitle = (id: string) => app.state.lists.find((l) => l.id === id)?.title ?? '';
  const age = (t: Task) => {
    const days = Math.floor((Date.now() - t.createdAt) / 86_400_000);
    if (days < 30) return days <= 1 ? 'new' : `${days} days old`;
    if (days < 365) return `${Math.round(days / 30)} months old`;
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? '' : 's'} old`;
  };

  async function verdict(v: 'keep' | 'someday' | 'done' | 'delete', priority?: Priority) {
    if (!current) return;
    laterOpen = false;
    const snapshot = { id: current.id, name: current.name };
    const r = await app.applySweepVerdict(current.id, v, { priority });
    // done/delete announce themselves via the undo toast; patches get our row.
    lastPatch = (v === 'keep' || v === 'someday') && r
      ? { ...snapshot, before: r.before }
      : null;
    decided += 1;
  }

  async function later(days: number) {
    if (!current) return;
    laterOpen = false;
    const snapshot = { id: current.id, name: current.name };
    const r = await app.applySweepVerdict(current.id, 'later', { snoozeDays: days });
    if (r) lastPatch = { ...snapshot, before: r.before };
    decided += 1;
  }

  /** Same rule the editor uses: toggling a tag adds or removes it. */
  function toggleTag(tagId: string) {
    if (!current) return;
    const tagIds = current.tagIds.includes(tagId)
      ? current.tagIds.filter((id) => id !== tagId)
      : [...current.tagIds, tagId];
    void app.patchTask(current.id, { tagIds });
  }

  async function putBack() {
    if (!lastPatch) return;
    await app.revertSweepVerdict(lastPatch.id, lastPatch.before);
    lastPatch = null;
    decided = Math.max(0, decided - 1);
  }
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>Sweep</h1>
    <span class="tally" data-testid="sweep-tally">
      {#if decided > 0}{decided} decided · {/if}{queue.length} left
    </span>
  </header>

  {#if current}
    {#key current.id}
      <section class="card" data-testid="sweep-card">
        <p class="meta">
          <span class="list">{listTitle(current.listId)}</span>
          <span class="age">· {age(current)}</span>
        </p>
        <h2 class="name">{current.name || 'untitled'}</h2>

        <!-- The card is an editor, not just a verdict form (2026-07-29 ask):
             describing, estimating and tagging ARE triage, and edits persist
             whatever verdict follows. -->
        <label class="field"><span>description</span>
          <textarea data-testid="sweep-notes" rows="2"
            placeholder="what does this actually involve?"
            value={current.notes}
            oninput={(e) => void app.patchTask(current!.id, { notes: e.currentTarget.value })}></textarea>
        </label>
        <label class="field est"><span>estimate (h)</span>
          <input type="number" min="0.5" step="0.5" placeholder="none" data-testid="sweep-estimate"
            value={current.estimateHours ?? ''}
            oninput={(e) => void app.patchTask(current!.id, {
              estimateHours: parseFloat(e.currentTarget.value) > 0 ? parseFloat(e.currentTarget.value) : undefined,
            })} />
        </label>
        <TagPicker selected={current.tagIds} ontoggle={toggleTag} />

        <!-- Keep-with-priority: one tap reviews AND files it where it belongs. -->
        <div class="priorities">
          {#each PRIORITIES as p (p)}
            <button
              class="tier {p}"
              class:current={current.priority === p}
              data-testid="sweep-priority-{p}"
              onclick={() => void verdict('keep', p)}>{p === 'medium' ? 'med' : p === 'someday' ? 'some day' : p}</button>
          {/each}
        </div>
      </section>

      <div class="verdicts">
        <button class="keep" data-testid="sweep-keep" onclick={() => void verdict('keep')}>
          keep as-is →
        </button>
        <div class="row">
          <button data-testid="sweep-later" class:armed={laterOpen}
            onclick={() => (laterOpen = !laterOpen)}>
            <Glyph name="moon" size={12} /> later…
          </button>
          <button data-testid="sweep-done" onclick={() => void verdict('done')}>
            <Glyph name="box-checked" size={12} /> already done
          </button>
          <button class="danger" data-testid="sweep-delete" onclick={() => void verdict('delete')}>
            ✕ delete
          </button>
        </div>
        <div class="row move-row">
          {#if lastDest}
            <button class="again" data-testid="sweep-move-again" onclick={() => void moveTo(lastDest!.id)}>
              ↷ move to {lastDest.title}
            </button>
          {/if}
          <select class="move" data-testid="sweep-move" bind:value={moveSelect}
            onchange={(e) => void onMovePick(e.currentTarget.value)}>
            <option value="">move to…</option>
            {#each destinations as l (l.id)}
              <option value={l.id}>{l.title}</option>
            {/each}
            <option value="__new__">+ new list…</option>
          </select>
        </div>
        {#if creatingList}
          <div class="row">
            <!-- svelte-ignore a11y_autofocus -->
            <input class="new-list" data-testid="sweep-new-list" autofocus
              placeholder="new list name…" bind:value={newListTitle}
              onkeydown={(e) => {
                if (e.key === 'Enter') void createAndMove();
                if (e.key === 'Escape') { creatingList = false; newListTitle = ''; }
              }} />
            <button class="create" data-testid="sweep-new-list-go" onclick={() => void createAndMove()}>
              create + move
            </button>
          </div>
        {/if}
        {#if laterOpen}
          <div class="row snooze" data-testid="sweep-snooze-row">
            {#each SNOOZE_PRESETS as preset (preset.days)}
              <button data-testid="sweep-snooze-{preset.days}" onclick={() => void later(preset.days)}>
                {preset.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/key}

  {:else}
    <section class="clear" data-testid="sweep-clear">
      <p class="big">// nothing left to review</p>
      <p class="small">
        {#if decided > 0}
          {decided} decisions this session. The backlog is officially curated.
        {:else}
          Every task has been looked at. The yellow dots will call you back if that changes.
        {/if}
      </p>
      <button class="reset" onclick={() => navigate({ name: 'home' })}>go home</button>
    </section>
  {/if}

  <!-- Outside the queue branch on purpose: the decision most worth taking back
       is often the one that just emptied the queue. -->
  {#if lastPatch}
    <button class="putback" data-testid="sweep-putback" onclick={() => void putBack()}>
      ↩ put “{lastPatch.name || 'untitled'}” back
    </button>
  {/if}
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  .tally { margin-left: auto; color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem; }

  .card {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 12px;
    padding: 16px; display: flex; flex-direction: column; gap: 10px;
  }
  .meta { margin: 0; font-family: var(--font-mono); font-size: 0.7rem; color: var(--dim); }
  .meta .list { color: var(--acc-cyan); }
  .name { margin: 0; font-size: 1.25rem; line-height: 1.35; overflow-wrap: anywhere; }
  .notes {
    margin: 0; color: var(--dim); font-size: 0.85rem; line-height: 1.5;
    display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field span { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .field textarea, .field input {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 7px 8px; font-size: 0.85rem; outline: none;
    width: 100%; min-width: 0;
  }
  .field textarea { font-family: inherit; resize: vertical; line-height: 1.45; }
  .field textarea:focus, .field input:focus { border-color: var(--acc-blue); }
  .field.est input { max-width: 130px; }
  .priorities { display: flex; gap: 6px; margin-top: 4px; }
  .tier {
    flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; padding: 8px 0; cursor: pointer;
  }
  .tier.current { border-color: var(--dim); color: var(--text); }
  @media (hover: hover) { .tier.someday:hover { color: var(--acc-purple); border-color: var(--acc-purple); } }
  @media (hover: hover) { .tier.low:hover { color: var(--acc-blue); border-color: var(--acc-blue); } }
  @media (hover: hover) { .tier.medium:hover { color: var(--acc-green); border-color: var(--acc-green); } }
  @media (hover: hover) { .tier.high:hover { color: var(--acc-orange); border-color: var(--acc-orange); } }
  @media (hover: hover) { .tier.max:hover { color: var(--acc-magenta); border-color: var(--acc-magenta); } }

  .verdicts { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
  .keep {
    background: var(--bg2); border: 1px solid var(--acc-green); border-radius: 10px;
    color: var(--acc-green); font-family: var(--font-mono); font-size: 1rem; font-weight: 700;
    padding: 14px; cursor: pointer;
  }
  @media (hover: hover) { .keep:hover { background: var(--acc-green); color: var(--bg0); } }
  .row { display: flex; gap: 8px; }
  .row button {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem;
    padding: 11px 6px; cursor: pointer;
  }
  @media (hover: hover) { .row button:hover { color: var(--text); } }
  .row button.armed { color: var(--acc-cyan); border-color: var(--acc-cyan); }
  @media (hover: hover) { .row .danger:hover { color: var(--acc-magenta); border-color: var(--acc-magenta); } }
  .snooze button { color: var(--acc-cyan); }
  .move-row .again {
    flex: 2; color: var(--acc-cyan); border-color: var(--acc-cyan);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
  }
  @media (hover: hover) { .move-row .again:hover { background: var(--acc-cyan); color: var(--bg0); } }
  .move {
    flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem;
    padding: 11px 6px; cursor: pointer; min-width: 0;
  }
  .new-list {
    flex: 2; background: var(--bg2); border: 1px solid var(--acc-blue); border-radius: 8px;
    color: var(--text); padding: 10px; font-size: 0.85rem; outline: none; min-width: 0;
  }
  .create { color: var(--acc-green) !important; }

  .putback {
    margin-top: 12px; width: 100%; background: none; border: 1px dashed var(--line);
    border-radius: 8px; color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem;
    padding: 9px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  @media (hover: hover) { .putback:hover { color: var(--acc-blue); border-color: var(--acc-blue); } }

  .clear { text-align: center; margin-top: 40px; display: flex; flex-direction: column; gap: 10px; align-items: center; }
  .big { color: var(--acc-green); font-family: var(--font-mono); margin: 0; }
  .small { color: var(--dim); font-size: 0.85rem; margin: 0; max-width: 40ch; line-height: 1.6; }
  .reset {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    color: var(--text); font-family: var(--font-mono); padding: 10px 18px; cursor: pointer; margin-top: 8px;
  }
</style>
