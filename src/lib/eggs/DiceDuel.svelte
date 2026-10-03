<!--
  SPOILER ZONE — Dice Duel: push-your-luck dice against ENTROPY at the den's
  table (rules in ./duel). Only ever started by the reader, and walking away
  mid-game costs nothing: an unfinished game is simply not recorded.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { DUEL_TARGET, bankPot, entropyNerve, entropyRollsAgain, newDuel, rollDie, type Duel } from './duel';
  import { DEN_MARKS } from './den';
  import { DUEL_BANTER } from './content/den';
  import { diePips } from './momentMotion';
  import { haptic } from '../ui/fx/haptics';

  let d = $state<Duel | null>(null);
  let banter = $state('');
  let rolling = $state(false);
  /** ENTROPY's appetite for risk this game (see entropyNerve). */
  let nerve = 10;
  /**
   * Bumped by every new game and by leaving the screen, so a turn of
   * ENTROPY's still sleeping between rolls knows it belongs to a game that
   * no longer exists and stops instead of moving in the new one.
   */
  let game = 0;

  const played = $derived(app.eggMarks[DEN_MARKS.duelsPlayed] ?? 0);
  const won = $derived(app.eggMarks[DEN_MARKS.duelsWon] ?? 0);
  const pips = $derived(diePips(d?.face ?? 5));

  const pick = (lines: readonly string[]) => lines[Math.floor(Math.random() * lines.length)]!;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * One face of the die. Under automation the e2e may load the dice with a
   * comma-separated list in OC_DUEL_DICE, consumed one face per roll.
   */
  function face(): number {
    if (typeof navigator !== 'undefined' && navigator.webdriver) {
      const loaded = localStorage.getItem('OC_DUEL_DICE');
      if (loaded) {
        const [next, ...rest] = loaded.split(',');
        localStorage.setItem('OC_DUEL_DICE', rest.join(','));
        const n = Number(next);
        if (n >= 1 && n <= 6) return n;
      }
    }
    return 1 + Math.floor(Math.random() * 6);
  }

  $effect(() => () => { game += 1; });

  function start() {
    game += 1;
    d = newDuel();
    nerve = entropyNerve(Math.random);
    banter = pick(DUEL_BANTER.start);
  }

  /** The die tumbles for a moment before it lands, so a roll reads as a roll. */
  async function tumble(): Promise<void> {
    rolling = true;
    haptic('tick');
    await wait(360);
    rolling = false;
  }

  async function youRoll() {
    if (!d || d.turn !== 'you' || d.winner || rolling) return;
    const mine = game;
    await tumble();
    if (mine !== game || !d) return;
    d = rollDie(d, face());
    if (d.last === 'bust') {
      banter = pick(DUEL_BANTER.youBust);
      void entropyTurn(mine);
    }
  }

  function youBank() {
    if (!d || d.turn !== 'you' || d.winner || rolling || d.pot === 0) return;
    d = bankPot(d);
    if (d.winner) { finish(); return; }
    banter = pick(DUEL_BANTER.youBank);
    void entropyTurn(game);
  }

  /** ENTROPY plays its turn out loud, a roll at a time, until it banks or busts. */
  async function entropyTurn(mine: number) {
    await wait(900);
    while (mine === game && d && d.turn === 'entropy' && !d.winner) {
      if (entropyRollsAgain(d, nerve)) {
        await tumble();
        if (mine !== game || !d) return;
        d = rollDie(d, face());
        if (d.last === 'bust') { banter = pick(DUEL_BANTER.entropyBust); return; }
        await wait(520);
      } else {
        d = bankPot(d);
        if (d.winner) { finish(); return; }
        banter = pick(DUEL_BANTER.entropyBank);
        return;
      }
    }
  }

  function finish() {
    if (!d?.winner) return;
    app.bumpEggTally(DEN_MARKS.duelsPlayed);
    if (d.winner === 'you') {
      banter = pick(DUEL_BANTER.youWin);
      haptic('success');
      const wins = app.bumpEggTally(DEN_MARKS.duelsWon);
      app.grantUnlockAndShow('duelist');
      if (wins >= 10) app.grantUnlockAndShow('high-roller');
    } else {
      banter = pick(DUEL_BANTER.entropyWins);
    }
  }
</script>

<section class="duel" data-testid="duel">
  <h2>dice duel <span class="vs">vs ENTROPY</span></h2>
  {#if !d}
    <p class="rules">first to {DUEL_TARGET}. roll as long as you dare; a 1 takes the pot.</p>
    <button class="primary" data-testid="duel-start" onclick={start}>sit down at the table</button>
    {#if played > 0}
      <p class="record" data-testid="duel-record">won {won} of {played}</p>
    {/if}
  {:else}
    <div class="scores">
      <div class="side" class:active={d.turn === 'you' && !d.winner}>
        <span class="who">you</span>
        <span class="bar"><span class="fill you" style="width: {Math.min(100, (d.you / DUEL_TARGET) * 100)}%"></span></span>
        <b data-testid="duel-you">{d.you}</b>
      </div>
      <div class="side" class:active={d.turn === 'entropy' && !d.winner}>
        <span class="who">▚ ENTROPY</span>
        <span class="bar"><span class="fill them" style="width: {Math.min(100, (d.entropy / DUEL_TARGET) * 100)}%"></span></span>
        <b data-testid="duel-entropy">{d.entropy}</b>
      </div>
    </div>

    <div class="table">
      <div class="die" class:rolling class:bust={d.last === 'bust'} class:blank={d.face === null}
        data-testid="duel-die" data-face={d.face ?? ''} aria-label={d.face === null ? 'the die' : `rolled a ${d.face}`}>
        {#each pips as [x, y], i (i)}
          <span class="pip" style="left: {x * 100}%; top: {y * 100}%"></span>
        {/each}
      </div>
      <p class="pot">pot <b data-testid="duel-pot">{d.pot}</b></p>
    </div>

    <p class="banter" data-testid="duel-banter"><span aria-hidden="true">▚</span> {banter}</p>

    {#if d.winner}
      <p class="result" class:win={d.winner === 'you'} data-testid="duel-result">
        {d.winner === 'you' ? 'you win!' : 'ENTROPY wins.'}
      </p>
      <div class="moves">
        <button class="primary" data-testid="duel-again" onclick={start}>again</button>
        <button data-testid="duel-leave" onclick={() => { game += 1; d = null; }}>leave the table</button>
      </div>
    {:else}
      <div class="moves">
        <button class="primary" data-testid="duel-roll" disabled={d.turn !== 'you' || rolling} onclick={youRoll}>roll</button>
        <button data-testid="duel-bank" disabled={d.turn !== 'you' || rolling || d.pot === 0} onclick={youBank}>
          bank {d.pot}
        </button>
      </div>
      {#if d.turn === 'entropy'}<p class="thinking">ENTROPY is rolling…</p>{/if}
    {/if}
  {/if}
</section>

<style>
  .duel {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 12px;
    padding: 14px; display: flex; flex-direction: column; gap: 10px;
  }
  h2 {
    margin: 0; font-family: var(--font-mono); font-size: 0.75rem; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--acc-yellow);
  }
  .vs { color: var(--acc-green); }
  .rules, .record, .thinking { margin: 0; color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; }
  button {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px; color: var(--text);
    font-family: var(--font-mono); font-size: 0.85rem; padding: 8px 14px; cursor: pointer;
  }
  button.primary { border-color: var(--acc-yellow); color: var(--acc-yellow); }
  button:disabled { opacity: 0.4; cursor: default; }
  .moves { display: flex; gap: 8px; flex-wrap: wrap; }

  .scores { display: flex; flex-direction: column; gap: 6px; }
  .side { display: grid; grid-template-columns: 6.5em 1fr 2em; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 0.8rem; color: var(--dim); }
  .side.active { color: var(--text); }
  .side b { text-align: right; color: var(--text); }
  .bar { height: 8px; background: var(--bg2); border-radius: 4px; overflow: hidden; }
  .fill { display: block; height: 100%; border-radius: 4px; transition: width 0.3s ease-out; }
  .fill.you { background: var(--acc-yellow); }
  .fill.them { background: var(--acc-green); }

  .table { display: flex; align-items: center; gap: 16px; padding: 6px 0; }
  .die {
    position: relative; width: 56px; height: 56px; flex: none;
    background: #f6f2e6; border-radius: 12px; box-shadow: 0 3px 0 #b9b2a0;
  }
  .die.blank { opacity: 0.5; }
  .die.bust { background: #ffd6d6; box-shadow: 0 3px 0 #c88; }
  .pip {
    position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px;
    background: #141414; border-radius: 50%;
  }
  .die.rolling { animation: tumble 0.36s ease-in-out; }
  .die.rolling .pip { opacity: 0.25; }
  @keyframes tumble {
    25% { transform: rotate(-18deg) translateY(-6px); }
    50% { transform: rotate(14deg) translateY(-10px); }
    75% { transform: rotate(-8deg) translateY(-3px); }
  }
  .pot { margin: 0; font-family: var(--font-mono); font-size: 0.85rem; color: var(--dim); }
  .pot b { color: var(--acc-yellow); font-size: 1.2rem; }

  .banter { margin: 0; color: var(--acc-green); font-size: 0.85rem; line-height: 1.45; min-height: 2.9em; }
  .result { margin: 0; font-family: var(--font-mono); font-size: 1rem; color: var(--acc-green); }
  .result.win { color: var(--acc-yellow); }
  @media (prefers-reduced-motion: reduce) {
    .die.rolling { animation: none; }
    .fill { transition: none; }
  }
</style>
