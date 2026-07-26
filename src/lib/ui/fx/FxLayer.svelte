<!--
  Full-screen effects overlay: the particle canvas + the hidden iOS haptic
  switch. Mounted once, last in App.svelte so it sits above everything;
  pointer-events none so it can never eat a tap.
-->
<script lang="ts">
  import { bindCanvas } from './particles';
  import { bindIosSwitch } from './haptics';

  let canvasEl: HTMLCanvasElement;
  let switchEl: HTMLInputElement;

  $effect(() => {
    // `switch` is a nonstandard iOS-Safari attribute the type defs don't know;
    // setting it imperatively keeps svelte-check clean.
    switchEl.setAttribute('switch', '');
    const unbind = bindCanvas(canvasEl);
    bindIosSwitch(switchEl);
    return unbind;
  });
</script>

<canvas bind:this={canvasEl} class="fx" aria-hidden="true"></canvas>
<!-- iOS 17.4+ fires a system haptic when a switch control toggles; haptics.ts
     clicks this invisible one inside user gestures. Harmless no-op elsewhere. -->
<input bind:this={switchEl} type="checkbox" class="ios-haptic" tabindex="-1" aria-hidden="true" />

<style>
  .fx {
    position: fixed; inset: 0; width: 100vw; height: 100vh;
    pointer-events: none; z-index: 9999;
  }
  .ios-haptic {
    position: fixed; width: 1px; height: 1px; opacity: 0;
    pointer-events: none; left: -100px; top: -100px;
  }
</style>
