# Connecting sync — the one thing only Ben can do (~3 minutes)

The app syncs through your private repo `coolblueflame/organizedchaos-data` (already created
and seeded). It needs a **fine-grained personal access token** that can touch ONLY that repo.
Tokens can only be minted through GitHub's website while signed in as you:

1. GitHub → your avatar → **Settings** → **Developer settings** (bottom of left sidebar)
   → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Name: `organizedchaos sync` (anything works).
3. Expiration: your call — "No expiration" means never re-pasting; a dated one is safer if
   your GitHub account matters at work (the app will show a clear error when it lapses).
4. **Repository access**: "Only select repositories" → pick `organizedchaos-data` ONLY.
5. **Permissions → Repository permissions → Contents → Read and write.** Nothing else.
6. Generate, **copy the `github_pat_…` string** (shown exactly once).

Then on EACH device (phone + any desktops):

7. Open the app → **⚙ Settings** → paste the token → **connect + sync**.
   Owner/repo are prefilled. The token is stored only on that device, never synced.

That's it — every change now commits to the data repo within ~5 seconds, and a wiped or new
device rebuilds itself entirely from a token paste. The repo's commit history doubles as a
point-in-time backup of your whole todo life.
