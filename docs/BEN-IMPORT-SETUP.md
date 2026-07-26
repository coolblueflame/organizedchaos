# Importing your personal Things data — Ben's steps (~15 min, one-time)

Your personal Things database lives on your iPhone; Things Cloud has no export API, so the
route is: iPhone backup on your PC → extract one file → drop it into the app.

1. **Back up your iPhone to your PC** (iTunes or the Apple Devices app → your phone →
   "Back Up Now"). An encrypted backup is fine — the script handles both.
2. **Grab the extractor** — download
   [`tools/extract_things_from_backup.py`](https://github.com/coolblueflame/organizedchaos/blob/main/tools/extract_things_from_backup.py)
   from the repo onto the PC (needs Python 3.8+; encrypted backups additionally need
   `pip install iphone-backup-decrypt`).
3. **Run it** in any folder: `python extract_things_from_backup.py`
   It auto-finds the newest backup, digs Things' `main.sqlite` out of the hashed file maze,
   and writes `things-main.sqlite` next to it. (Encrypted backups: it prompts for the password.)
4. **Import** — open the app (any device) → ⚙ Settings → **import from Things** → pick
   `things-main.sqlite`. You'll get a preview (lists, open tasks, completed history, tags,
   recurring), then a one-tap review pass of the decoded recurring tasks.

Notes:
- Everything parses on-device in the browser; the file is never uploaded anywhere.
- Your completed history imports with real dates — the stats/graphs will reflect your whole
  Things lifetime from day one.
- Re-importing a fresher backup later is safe: items are matched by their Things identity,
  never duplicated, and anything you've edited in Organized Chaos since wins.
