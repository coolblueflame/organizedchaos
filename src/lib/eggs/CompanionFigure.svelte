<!--
  The companion as one figure: the creature (the last glyph of its form),
  whatever the form adds (the crown is worn on its head; the sparkles sit
  beside it — see den.WORN_ADORNMENTS), and whatever it is wearing, placed
  ON the creature at the spot that kind of thing belongs (see den.WornSlot).
  Something worn in the same spot as the form's own adornment stacks on top
  of it: a top hat on a crowned dragon sits on the crown. Sized by the
  surrounding font-size, so the same figure serves Home's corner and the
  den's floor.

  Spots are percentages of the creature's own box, tuned against the
  dragon-face glyph most readers see: a head sits between the horns, eyes
  across the brow, a held thing at the lower right where a paw would be.
-->
<script lang="ts">
  import { WORN_ADORNMENTS, splitForm, type Dressing } from './den';

  let { form, dressed = null, wornTestId }: {
    form: string;
    dressed?: Dressing | null;
    /** Test id for the worn item, so each screen's tests can find their own. */
    wornTestId?: string;
  } = $props();

  const parts = $derived(splitForm(form));
  /** Where the form wears its adornment, or null when it sits beside the creature. */
  const adornSlot = $derived(WORN_ADORNMENTS[parts.adornment] ?? null);
  const stacked = $derived(adornSlot !== null && dressed?.slot === adornSlot);
</script>

<span class="figure" class:tall={stacked && dressed?.slot === 'head'}>
  {#if parts.adornment && !adornSlot}<span class="adornment">{parts.adornment}</span>{/if}
  <span class="creature">{parts.creature}{#if adornSlot}<span
      class="worn own slot-{adornSlot}" data-testid="companion-adornment">{parts.adornment}</span>{/if}{#if dressed}<span
      class="worn slot-{dressed.slot}" class:stacked data-testid={wornTestId}>{dressed.emoji}</span>{/if}</span>
</span>

<style>
  .figure { display: inline-flex; align-items: flex-end; white-space: nowrap; }
  /* A fixed one-em line box, so the percentages below mean the same thing
     wherever the figure is drawn. */
  .creature { position: relative; display: inline-block; line-height: 1; }
  .worn { position: absolute; line-height: 1; pointer-events: none; }
  .slot-head { left: 50%; top: -30%; font-size: 0.5em; transform: translateX(-50%) rotate(-8deg); }
  .slot-eyes { left: 50%; top: 15%; font-size: 0.64em; transform: translateX(-50%); }
  /* Wider than the face, so the cups sit at its sides rather than over its eyes. */
  .slot-ears { left: 50%; top: -42%; font-size: 1.5em; transform: translateX(-50%); }
  /* Turned on its side, a scarf wraps under the chin instead of hanging over the snout. */
  .slot-neck { left: 50%; bottom: -20%; font-size: 0.6em; transform: translateX(-50%) rotate(-78deg); }
  .slot-held { right: -26%; bottom: -6%; font-size: 0.5em; transform: rotate(10deg); }
  .slot-float { right: -24%; top: -34%; font-size: 0.46em; }
  /* The form's own adornment sits level, and in front of anything that
     passes behind it (a headphone band). */
  .own { z-index: 1; }
  .own.slot-head { top: -34%; font-size: 0.56em; transform: translateX(-50%); }
  /* Worn on top of the form's own adornment, one layer further up. */
  .stacked { z-index: 2; }
  .stacked.slot-head { top: -68%; }
  /* A stack on the head reaches well above the creature; the figure claims
     that height so the screen around it makes room instead of clipping it. */
  .figure.tall { padding-top: 0.6em; }
</style>
