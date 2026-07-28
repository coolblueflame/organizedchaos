#!/usr/bin/env node
/**
 * One-time repair for libraries imported before the epoch-detection fix.
 *
 * WHAT WENT WRONG
 * Things stores its date columns as seconds, but which epoch depends on the
 * version that wrote the library: older ones count from 2001-01-01, newer ones
 * from 1970. The importer assumed 2001 and added the offset to values that were
 * already unix time, so every imported date landed exactly 31 years in the
 * future — a task completed in 2019 claimed 2050. The importer now detects the
 * epoch instead of assuming it, but rows already written keep their bad dates,
 * and re-importing does not help: those rows claim to be NEWER than the
 * corrected ones, so they win the merge.
 *
 * WHAT THIS DOES
 * Rewrites the synced repo in place: subtracts the doubled offset from every
 * timestamp that is implausibly far in the future, re-buckets completed tasks
 * into logbook files named for the year they were really completed, and removes
 * the logbook files named for years that never happened.
 *
 * WHY `updatedAt` IS NOT REPAIRED THE SAME WAY
 * It is not a date anyone reads — it is the tiebreaker sync uses to decide
 * which copy of a row wins. Both devices still hold the uncorrected rows in
 * local storage, so a repaired row has to OUT-RANK them or it would simply be
 * overwritten again on the next sync. Each repaired row therefore gets
 * `updatedAt + 1`: high enough to win, and invisible either way.
 *
 * SAFETY
 * The data repo is a git repo, so every write here is a commit and the previous
 * state stays in its history — `git revert` is the whole rollback story. Run
 * with --dry-run first (the default) to see the counts before anything moves.
 *
 * USAGE
 *   node tools/repair_import_timestamps.mjs                # dry run, prints a plan
 *   node tools/repair_import_timestamps.mjs --apply        # actually writes
 *   GITHUB_TOKEN=$(gh auth token) node tools/... --apply   # explicit token
 */

const OWNER = process.env.OC_DATA_OWNER ?? 'coolblueflame';
const REPO = process.env.OC_DATA_REPO ?? 'organizedchaos-data';
const TOKEN = process.env.GITHUB_TOKEN;
const APPLY = process.argv.includes('--apply');

/** Seconds between the unix and Cocoa epochs — the offset applied one time too many. */
const SHIFT_MS = 978_307_200 * 1000;

/**
 * A timestamp counts as corrupt when it is more than a year ahead. Creation and
 * completion times are by definition in the past, so there is nothing genuine
 * up there to catch by accident, and a year of slack absorbs any clock skew.
 */
const FUTURE_CUTOFF = Date.now() + 365 * 86_400_000;
const isShifted = (v) => typeof v === 'number' && Number.isFinite(v) && v > FUTURE_CUTOFF;

/** Fields that hold a real moment in time and are shown to the user. */
const DATE_FIELDS = ['createdAt', 'completedAt', 'startedAt', 'nextSpawnAt'];

if (!TOKEN) {
  console.error('Set GITHUB_TOKEN (e.g. GITHUB_TOKEN=$(gh auth token) node tools/...)');
  process.exit(1);
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: init.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return init.raw ? res.text() : res.json();
};

/** Contents API inlines only up to 1MB; past that the blob endpoint serves it raw. */
async function readJson(path, sha) {
  return JSON.parse(await api(`/git/blobs/${sha}`, { raw: true }));
}

const stats = { rows: 0, repaired: 0, fields: 0 };

/** Repair one row in place; returns whether anything moved. */
function repairRow(row) {
  stats.rows += 1;
  let touched = false;
  for (const field of DATE_FIELDS) {
    if (isShifted(row[field])) {
      row[field] -= SHIFT_MS;
      stats.fields += 1;
      touched = true;
    }
  }
  // updatedAt is a merge token rather than a date — see the note at the top.
  if (isShifted(row.updatedAt)) {
    row.updatedAt += 1;
    touched = true;
  }
  if (touched) stats.repaired += 1;
  return touched;
}

const listing = await api('/contents/');
const jsonFiles = listing.filter((f) => f.name.endsWith('.json'));
console.log(`Reading ${jsonFiles.length} files from ${OWNER}/${REPO}…`);

const files = new Map(); // path → { sha, json }
for (const f of jsonFiles) files.set(f.name, { sha: f.sha, json: await readJson(f.name, f.sha) });

// ── repair every row, wherever it lives ─────────────────────────────────────
const active = files.get('active.json')?.json;
if (!active) throw new Error('no active.json — is this the right repo?');
for (const key of ['lists', 'tasks', 'tags', 'templates']) {
  for (const row of active[key] ?? []) repairRow(row);
}

/** Completed tasks from every logbook, repaired and re-bucketed by real year. */
const byYear = new Map();
for (const [path, { json }] of files) {
  if (!path.startsWith('logbook-')) continue;
  for (const task of json.tasks ?? []) {
    repairRow(task);
    const year = new Date(task.completedAt).getFullYear();
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(task);
  }
}

const wantedLogbooks = new Set([...byYear.keys()].map((y) => `logbook-${y}.json`));
const staleLogbooks = [...files.keys()].filter((p) => p.startsWith('logbook-') && !wantedLogbooks.has(p));

console.log(`\n  rows seen:      ${stats.rows}`);
console.log(`  rows repaired:  ${stats.repaired}`);
console.log(`  dates shifted:  ${stats.fields}`);
console.log(`\n  logbooks after repair:`);
for (const year of [...byYear.keys()].sort()) console.log(`    logbook-${year}.json — ${byYear.get(year).length} tasks`);
console.log(`  removing (years that never happened): ${staleLogbooks.join(', ') || 'none'}`);

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to commit these changes.');
  process.exit(0);
}

// ── write it back ───────────────────────────────────────────────────────────
const put = async (path, json, sha, message) => {
  const content = Buffer.from(JSON.stringify(json), 'utf8').toString('base64');
  await api(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content, ...(sha ? { sha } : {}) }),
  });
  console.log(`  wrote ${path}`);
};

console.log('\nWriting…');
await put('active.json', active, files.get('active.json').sha, 'repair: undo the doubled epoch offset on imported dates');

for (const year of [...byYear.keys()].sort()) {
  const path = `logbook-${year}.json`;
  await put(path, { schema: 1, tasks: byYear.get(year) }, files.get(path)?.sha,
    `repair: completions actually made in ${year}`);
}

for (const path of staleLogbooks) {
  await api(`/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message: `repair: ${path} was a year that never happened`, sha: files.get(path).sha }),
  });
  console.log(`  removed ${path}`);
}

console.log('\nDone. Both devices will pick this up on their next sync.');
