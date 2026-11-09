<!--
  The companion as one figure: the creature (the last glyph of its form),
  whatever the form adds beside it (the sparkles), and its outfit, one
  thing per spot, placed ON the creature where that kind of thing belongs
  (see den.WornSlot). A form's crown is drawn from the outfit rather than
  the form, so another hat can replace it (den.WEARABLE_ADORNMENTS). Sized
  by the surrounding font-size, so the same figure serves Home's corner and
  the den's floor.

  Spots are percentages of the creature's own box, tuned against the
  dragon-face glyph most readers see: a head sits between the horns, eyes
  across the brow, ears at the frills either side, a held thing at the
  lower right where a paw would be.
-->
<script lang="ts">
  import { WEARABLE_ADORNMENTS, splitForm, type Outfit, type WornSlot } from './den';

  let { form, outfit = {}, testIdPrefix }: {
    form: string;
    outfit?: Outfit;
    /** Each worn thing gets `<prefix>-<spot>` as its test id, so each screen's tests can find their own. */
    testIdPrefix?: string;
  } = $props();

  const parts = $derived(splitForm(form));
  const showAdornment = $derived(parts.adornment !== '' && !WEARABLE_ADORNMENTS.has(parts.adornment));
  /** Back to front: a hat sits over anything at the ears, a held thing over the chin. */
  const ORDER: readonly WornSlot[] = ['neck', 'eyes', 'ears', 'head', 'held', 'float'];
  const worn = $derived(ORDER.flatMap((slot) => (outfit[slot] ? [outfit[slot]!] : [])));
  const tid = (slot: WornSlot) => (testIdPrefix ? `${testIdPrefix}-${slot}` : undefined);
</script>

<span class="figure">
  {#if showAdornment}<span class="adornment">{parts.adornment}</span>{/if}
  <span class="creature">{parts.creature}{#each worn as d (d.slot)}{#if d.slot === 'ears'}<!--
      An over-ear pair is drawn as its two cups, one on each ear: the whole
      glyph, band and all, is wider than the head and covered the face.
    --><span class="worn ear left" data-testid={tid('ears')}>{d.emoji}</span><span
        class="worn ear right" aria-hidden="true">{d.emoji}</span>{:else}<span
        class="worn slot-{d.slot} item-{d.id}" data-testid={tid(d.slot)}>{d.emoji}</span>{/if}{/each}</span>
</span>

<style>
  .figure { display: inline-flex; align-items: flex-end; white-space: nowrap; }
  /* A fixed one-em line box, so the percentages below mean the same thing
     wherever the figure is drawn. */
  .creature { position: relative; display: inline-block; line-height: 1; }
  .worn { position: absolute; line-height: 1; pointer-events: none; }
  .slot-head { left: 50%; top: -34%; font-size: 0.56em; transform: translateX(-50%); }
  /* Flatter than a hat, so they sit lower to rest on the head rather than hover over it. */
  .slot-head.item-bow, .slot-head.item-flower { top: -20%; }
  .slot-head.item-cap { top: -26%; }
  .slot-eyes { left: 50%; top: 15%; font-size: 0.64em; transform: translateX(-50%); }
  /* Turned on its side, a scarf wraps under the chin instead of hanging over the snout. */
  .slot-neck { left: 50%; bottom: -20%; font-size: 0.6em; transform: translateX(-50%) rotate(-78deg); }
  .slot-held { right: -26%; bottom: -6%; font-size: 0.5em; transform: rotate(10deg); }
  .slot-float { right: -24%; top: -34%; font-size: 0.46em; }
  /* Each cup is the glyph cropped to one of its lower corners. */
  .ear { top: 4%; font-size: 0.62em; }
  .ear.left { left: -12%; clip-path: inset(46% 52% 0 0); }
  .ear.right { right: -12%; clip-path: inset(46% 0 0 52%); }
</style>
