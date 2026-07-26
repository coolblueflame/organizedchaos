import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { app as store } from './lib/state/app.svelte';

// Kick off hydration before mounting; App shows a boot splash until store.ready.
void store.init();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
