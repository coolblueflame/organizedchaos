import './app.css';
import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './App.svelte';
import { app as store } from './lib/state/app.svelte';

// Offline-first service worker; autoUpdate swaps in new builds silently.
registerSW({ immediate: true });

// Kick off hydration before mounting; App shows a boot splash until store.ready.
void store.init();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
