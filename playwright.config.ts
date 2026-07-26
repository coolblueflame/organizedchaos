import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build via `vite preview` — closest thing to
 * what GitHub Pages serves, including the /organizedchaos/ base path.
 * Locally we exercise chromium AND an iPhone-sized webkit (the real target);
 * CI runs chromium only (see .github/workflows/deploy.yml).
 */
export default defineConfig({
  testDir: 'e2e',
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/organizedchaos/',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:4173/organizedchaos/',
    // The SW would swallow route-stubbed requests (webkit can't intercept
    // SW-originated fetches). pwa.spec re-enables it explicitly.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 15'] } },
  ],
});
