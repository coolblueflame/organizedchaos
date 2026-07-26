# organized chaos

**A todo list with a gambling problem.**

Organized Chaos is a minimalist, dark-IDE-themed todo app whose signature feature is the
randomizer: one big button that looks at everything you could be doing, escalates priorities
based on deadlines and time estimates, draws one task from the top tier, and asks you to commit —
**Accept**, **Not Now** (re-roll), or **Not Today** (snooze until 4am). Accepted tasks become
your persistent current task. Completing things earns you particles.

**Live app:** https://coolblueflame.github.io/organizedchaos/

Installed as a home-screen web app (Safari → Share → Add to Home Screen on iOS), it works
offline with local-first storage and syncs through a private GitHub repo — no server, no
subscription.

Built almost entirely by [Claude Code](https://claude.com/claude-code), design docs included.

## Development

```
npm install        # dependencies
npm run dev        # dev server
npm test           # unit tests (domain logic + storage)
npm run e2e        # Playwright end-to-end tests
npm run check      # svelte-check / TypeScript
npm run build      # production build
```

Design spec and implementation plans live in `docs/superpowers/`; the research that shaped the
architecture is in `docs/research/`.
