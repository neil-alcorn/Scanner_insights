# Scanner Insights Web Sync Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Scanner Insights from isolated local reporting to a Netlify-hosted reporting app fed by startup background agents on the installed POS machines.

**Architecture:** Preserve the current installed listener behavior, then split data capture/sync from browser reporting. The cloud side will expose Netlify Functions backed by a hosted SQL database; each POS machine will keep a local durable queue and upload scans with duplicate protection.

**Tech Stack:** Existing Node ESM app, Express for local compatibility, Netlify static hosting/functions, hosted SQL database via `@netlify/neon` or a provider-compatible serverless Postgres client, Windows PowerShell launcher/install scripts, existing C# low-level keyboard hook.

---

## Current Baseline

- Current source root: `C:\Users\nalco\.codex\scanner-insights`
- Current installed-app pattern: `%LOCALAPPDATA%\ScannerInsights\app`
- Current app entry point: `server.mjs`
- Current UI files: `public/index.html`, `public/app.js`, `public/styles.css`
- Current listener helper: `bin/ScannerKeyHook.exe`, source in `tools/ScannerKeyHook.cs`
- Current local store: `data/scanner-insights.json`
- Current CSV export/import columns: `id,barcode,scanned_at,source,note,machine_id`
- POS 2 seed export from Gmail: `FS1-BLM-WK02`, 570 long-export rows
- POS 1 seed export from Gmail: `FS1-BLM-WK04`, 531 long-export rows
- Downloads folder only contains POS 2 duplicates/subsets. Do not treat those four files as four unique datasets.

## File Structure

Create or modify these files:

- Create: `.gitignore`  
  Keeps generated installs, local scan data, dependency folders, and build output out of Git.
- Modify: `package.json`  
  Adds scripts for tests, local web app, Netlify build, seed validation, and agent mode.
- Create: `netlify.toml`  
  Configures static publish directory and Netlify Functions directory.
- Create: `src/shared/scans.mjs`  
  Owns scan validation, normalization, duplicate keys, date range helpers, CSV parsing, CSV serialization, and dashboard summary building.
- Create: `src/shared/local-store.mjs`  
  Owns JSON local queue persistence, legacy store loading, pending/synced state updates, and first-run migration from the current store.
- Create: `src/local/listener.mjs`  
  Owns the keyboard burst buffer and spawning `ScannerKeyHook.exe`.
- Create: `src/local/agent.mjs`  
  Runs as the startup background process, captures scans, writes local queue records, and periodically syncs.
- Create: `src/local/sync-client.mjs`  
  Posts pending local scans to the cloud ingest API and handles retryable failures.
- Create: `src/local/server.mjs`  
  Runs the optional local dashboard/API compatibility server by composing shared modules.
- Create: `src/cloud/db.mjs`  
  Creates database client/query helpers for Netlify Functions.
- Create: `src/cloud/schema.sql`  
  Defines `scans`, `machines`, import audit fields, indexes, and duplicate constraints.
- Create: `netlify/functions/dashboard.mjs`  
  Returns dashboard summaries from the cloud database.
- Create: `netlify/functions/ingest-scans.mjs`  
  Accepts agent batches and CSV import rows, validates them, and inserts with duplicate protection.
- Create: `netlify/functions/import-csv.mjs`  
  Accepts admin CSV import payloads for seed/backfill.
- Create: `public/app.js`  
  Change API URLs from local Express endpoints to Netlify Functions for web deployment while keeping local dev compatibility.
- Modify: `public/index.html`  
  Add machine filter and sync status sections without changing the core dashboard workflow.
- Modify: `public/styles.css`  
  Add compact styles for machine filters and sync status.
- Modify: `server.mjs`  
  Convert to a thin compatibility entry that imports `src/local/server.mjs`, or leave as a wrapper so existing launchers continue to work.
- Modify: `usb-launchers/installer.ps1`  
  Preserve current install flow, add agent startup shortcut or scheduled task, and avoid deleting existing local data before migration.
- Modify: `usb-launchers/launcher-start.ps1`  
  Start the local compatibility server only when requested; the agent should be independent.
- Create: `scripts/validate-seed-csv.mjs`  
  Validates seed CSV files and prints row counts, machine IDs, date ranges, duplicate keys, and subset relationships.
- Create: `scripts/seed-cloud-from-csv.mjs`  
  Imports POS seed CSVs into cloud API/database with dedupe.
- Create: `test/scans.test.mjs`  
  Unit tests for validation, duplicate keys, CSV parsing, and dashboard summaries.
- Create: `test/local-store.test.mjs`  
  Unit tests for queue persistence and migration from current `scanner-insights.json`.
- Create: `test/sync-client.test.mjs`  
  Unit tests for successful sync, retryable failures, duplicate responses, and marking rows synced.
- Create: `test/import-csv.test.mjs`  
  Unit tests for import dedupe between POS exports and subset exports.

---

## Task 1: Repository Hygiene And Baseline Scripts

**Files:**
- Create: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Create `.gitignore`**

Write:

```gitignore
node_modules/
dist/
sandbox-install/
data/*.db
data/*.db-shm
data/*.db-wal
data/scanner-insights.json
run/
*.log
.netlify/
.env
.env.*
!.env.example
```

- [ ] **Step 2: Update `package.json` scripts**

Replace the scripts section with:

```json
"scripts": {
  "dev": "node server.mjs",
  "agent": "node src/local/agent.mjs",
  "web:local": "node src/local/server.mjs",
  "test": "node --test",
  "check": "node --check server.mjs && node --check src/shared/scans.mjs && node --check src/shared/local-store.mjs && node --check src/local/agent.mjs && node --check src/local/server.mjs && node --check netlify/functions/dashboard.mjs && node --check netlify/functions/ingest-scans.mjs && node --check netlify/functions/import-csv.mjs",
  "seed:validate": "node scripts/validate-seed-csv.mjs",
  "seed:cloud": "node scripts/seed-cloud-from-csv.mjs"
}
```

- [ ] **Step 3: Run syntax checks**

Run: `node --check server.mjs`

Expected: PASS, no output.

- [ ] **Step 4: Commit**

Run:

```bash
git add .gitignore package.json
git commit -m "chore: prepare scanner insights repo hygiene"
```

Expected: commit succeeds if the project is already in Git. If this workspace is not yet a Git repo, defer the commit until the clean source is moved to `C:\Users\nalco\GitRepos\Scanner_insights`.

---

## Task 2: Shared Scan Domain Module

**Files:**
- Create: `src/shared/scans.mjs`
- Test: `test/scans.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `test/scans.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDuplicateKey,
  buildSummary,
  normalizeBarcode,
  parseScanCsv,
  validateScanInput
} from '../src/shared/scans.mjs';

test('normalizeBarcode strips whitespace and preserves digits', () => {
  assert.equal(normalizeBarcode(' 850 060573 \n'), '850060573');
});

test('validateScanInput accepts current listener rows', () => {
  const row = validateScanInput({
    barcode: '850060573',
    scanned_at: '2026-05-29 17:15:44',
    source: 'global-listener',
    note: 'Captured from keyboard listener',
    machine_id: 'FS1-BLM-WK04'
  });

  assert.equal(row.barcode, '850060573');
  assert.equal(row.machine_id, 'FS1-BLM-WK04');
});

test('validateScanInput rejects invalid barcode values', () => {
  assert.throws(
    () => validateScanInput({ barcode: 'abc', scanned_at: '2026-05-29 17:15:44', machine_id: 'POS1' }),
    /Barcode must be 4-32 digits/
  );
});

test('buildDuplicateKey uses machine barcode and timestamp', () => {
  assert.equal(
    buildDuplicateKey({ machine_id: 'FS1-BLM-WK04', barcode: '850060573', scanned_at: '2026-05-29 17:15:44' }),
    'FS1-BLM-WK04|850060573|2026-05-29 17:15:44'
  );
});

test('parseScanCsv reads exported Scanner Insights columns', () => {
  const csv = [
    'id,barcode,scanned_at,source,note,machine_id',
    '"1","850060573","2026-05-29 17:15:44","global-listener","Captured from keyboard listener","FS1-BLM-WK04"'
  ].join('\n');

  const result = parseScanCsv(csv);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].barcode, '850060573');
  assert.equal(result.errors.length, 0);
});

test('buildSummary combines machines and keeps day-level unique counts', () => {
  const rows = [
    validateScanInput({ barcode: '1111', scanned_at: '2026-06-10 08:00:00', source: 'global-listener', machine_id: 'FS1-BLM-WK02' }),
    validateScanInput({ barcode: '1111', scanned_at: '2026-06-10 09:00:00', source: 'global-listener', machine_id: 'FS1-BLM-WK02' }),
    validateScanInput({ barcode: '2222', scanned_at: '2026-06-10 10:00:00', source: 'global-listener', machine_id: 'FS1-BLM-WK04' })
  ];

  const summary = buildSummary(rows, { start: '2026-06-10', end: '2026-06-10' }, '2026-06-10');
  assert.equal(summary.summary.total_range, 3);
  assert.equal(summary.summary.unique_range, 2);
  assert.equal(summary.summary.repeats_range, 1);
  assert.deepEqual(summary.machines.map((m) => m.machine_id).sort(), ['FS1-BLM-WK02', 'FS1-BLM-WK04']);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test test/scans.test.mjs`

Expected: FAIL with module not found for `src/shared/scans.mjs`.

- [ ] **Step 3: Implement shared scan module**

Create `src/shared/scans.mjs`:

```js
export function localTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function normalizeBarcode(barcode) {
  return String(barcode || '').trim().replace(/\s+/g, '');
}

export function validateScanInput(input) {
  const barcode = normalizeBarcode(input?.barcode);
  if (!/^\d{4,32}$/.test(barcode)) {
    throw new Error('Barcode must be 4-32 digits.');
  }

  const scannedAt = String(input?.scanned_at || input?.scannedAt || localTimestamp()).trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(scannedAt)) {
    throw new Error('scanned_at must be formatted as YYYY-MM-DD HH:mm:ss.');
  }

  const machineId = String(input?.machine_id || input?.machineId || '').trim();
  if (!machineId) {
    throw new Error('machine_id is required.');
  }

  return {
    id: input?.id == null || input.id === '' ? null : Number(input.id),
    barcode,
    scanned_at: scannedAt,
    source: String(input?.source || 'global-listener').trim(),
    note: input?.note ? String(input.note) : null,
    machine_id: machineId,
    sync_status: input?.sync_status || 'pending',
    synced_at: input?.synced_at || null
  };
}

export function buildDuplicateKey(scan) {
  return `${scan.machine_id}|${scan.barcode}|${scan.scanned_at}`;
}

export function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}

export function parseScanCsv(csv) {
  if (typeof csv !== 'string' || !csv.trim()) {
    return { rows: [], errors: ['CSV content is empty.'] };
  }

  const lines = csv.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCSVLine(lines[0]).map((header) => header.trim());
  const errors = [];
  const rows = [];

  for (const required of ['barcode', 'scanned_at', 'machine_id']) {
    if (!headers.includes(required)) {
      errors.push(`Missing required column: ${required}`);
    }
  }

  if (errors.length) {
    return { rows, errors };
  }

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCSVLine(lines[i]);
    const raw = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    try {
      rows.push(validateScanInput(raw));
    } catch (error) {
      errors.push(`Row ${i + 1}: ${error.message}`);
    }
  }

  return { rows, errors };
}

export function getRangeParams(query = {}, now = new Date()) {
  const daysValue = Number(query.days || 14);
  const days = Number.isFinite(daysValue) ? Math.min(Math.max(daysValue, 1), 90) : 14;
  const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (isDate(query.start) && isDate(query.end) && query.start <= query.end) {
    return { mode: 'custom', start: query.start, end: query.end, days };
  }

  const end = localTimestamp(now).slice(0, 10);
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - (days - 1));
  return { mode: 'quick', start: localTimestamp(startDate).slice(0, 10), end, days };
}

export function buildSummary(scans, range, today = localTimestamp().slice(0, 10)) {
  const selectedScans = scans.filter((scan) => {
    const day = scan.scanned_at.slice(0, 10);
    return day >= range.start && day <= range.end;
  });
  const todayScans = scans.filter((scan) => scan.scanned_at.slice(0, 10) === today);
  const countUnique = (rows, keyFn) => new Set(rows.map(keyFn)).size;

  const summary = {
    total_today: todayScans.length,
    unique_today: countUnique(todayScans, (scan) => scan.barcode),
    repeats_today: todayScans.length - countUnique(todayScans, (scan) => scan.barcode),
    total_range: selectedScans.length,
    unique_range: countUnique(selectedScans, (scan) => scan.barcode),
    repeats_range: selectedScans.length - countUnique(selectedScans, (scan) => scan.barcode),
    total_all_time: scans.length
  };

  const dailyMap = new Map();
  const hourlyMap = new Map();
  const repeatMap = new Map();
  const machineMap = new Map();

  for (const scan of selectedScans) {
    const day = scan.scanned_at.slice(0, 10);
    const hour = scan.scanned_at.slice(11, 13);

    const daily = dailyMap.get(day) || { day, total_scans: 0, barcodes: new Set() };
    daily.total_scans += 1;
    daily.barcodes.add(scan.barcode);
    dailyMap.set(day, daily);

    const hourly = hourlyMap.get(hour) || { hour, total_scans: 0, visits: new Set() };
    hourly.total_scans += 1;
    hourly.visits.add(`${scan.barcode}:${day}`);
    hourlyMap.set(hour, hourly);

    const repeatKey = `${scan.barcode}:${day}`;
    const repeat = repeatMap.get(repeatKey) || {
      barcode: scan.barcode,
      day,
      scans_that_day: 0,
      first_seen: scan.scanned_at,
      last_seen: scan.scanned_at
    };
    repeat.scans_that_day += 1;
    repeat.first_seen = scan.scanned_at < repeat.first_seen ? scan.scanned_at : repeat.first_seen;
    repeat.last_seen = scan.scanned_at > repeat.last_seen ? scan.scanned_at : repeat.last_seen;
    repeatMap.set(repeatKey, repeat);

    const machine = machineMap.get(scan.machine_id) || { machine_id: scan.machine_id, total_scans: 0, barcodes: new Set() };
    machine.total_scans += 1;
    machine.barcodes.add(scan.barcode);
    machineMap.set(scan.machine_id, machine);
  }

  const daily = Array.from(dailyMap.values()).map((row) => ({
    day: row.day,
    total_scans: row.total_scans,
    unique_scans: row.barcodes.size,
    repeat_scans: row.total_scans - row.barcodes.size
  })).sort((a, b) => a.day.localeCompare(b.day));

  const hourly = Array.from(hourlyMap.values()).map((row) => ({
    hour: row.hour,
    total_scans: row.total_scans,
    unique_visits: row.visits.size
  })).sort((a, b) => a.hour.localeCompare(b.hour));

  const repeats = Array.from(repeatMap.values())
    .filter((row) => row.scans_that_day > 1)
    .sort((a, b) => b.day.localeCompare(a.day) || b.scans_that_day - a.scans_that_day || a.barcode.localeCompare(b.barcode))
    .slice(0, 25);

  const recent = [...selectedScans]
    .sort((a, b) => b.scanned_at.localeCompare(a.scanned_at))
    .slice(0, 30)
    .map((scan) => ({
      id: scan.id,
      barcode: scan.barcode,
      scannedAt: scan.scanned_at,
      source: scan.source,
      machineId: scan.machine_id,
      scan_number_for_day: selectedScans.filter((row) =>
        row.barcode === scan.barcode &&
        row.scanned_at.slice(0, 10) === scan.scanned_at.slice(0, 10) &&
        row.scanned_at <= scan.scanned_at
      ).length
    }));

  const machines = Array.from(machineMap.values()).map((row) => ({
    machine_id: row.machine_id,
    total_scans: row.total_scans,
    unique_scans: row.barcodes.size
  }));

  return { summary, daily, hourly, repeats, recent, machines };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/scans.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/shared/scans.mjs test/scans.test.mjs
git commit -m "feat: add shared scan domain logic"
```

---

## Task 3: Local Queue Store And Legacy Migration

**Files:**
- Create: `src/shared/local-store.mjs`
- Test: `test/local-store.test.mjs`

- [ ] **Step 1: Write failing local-store tests**

Create `test/local-store.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  appendQueuedScan,
  createEmptyStore,
  loadLocalStore,
  markSynced,
  migrateLegacyStore
} from '../src/shared/local-store.mjs';

test('createEmptyStore has expected shape', () => {
  assert.deepEqual(createEmptyStore(), { nextId: 1, scans: [] });
});

test('appendQueuedScan assigns local id and pending status', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scanner-store-'));
  const storePath = path.join(dir, 'queue.json');
  try {
    const scan = await appendQueuedScan(storePath, {
      barcode: '850060573',
      scanned_at: '2026-05-29 17:15:44',
      machine_id: 'FS1-BLM-WK04',
      source: 'global-listener'
    });

    assert.equal(scan.local_id, 1);
    assert.equal(scan.sync_status, 'pending');
    const loaded = await loadLocalStore(storePath);
    assert.equal(loaded.scans.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('markSynced marks matching local ids as synced', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scanner-store-'));
  const storePath = path.join(dir, 'queue.json');
  try {
    await appendQueuedScan(storePath, {
      barcode: '850060573',
      scanned_at: '2026-05-29 17:15:44',
      machine_id: 'FS1-BLM-WK04',
      source: 'global-listener'
    });

    await markSynced(storePath, [1], '2026-06-14 10:00:00');
    const loaded = await loadLocalStore(storePath);
    assert.equal(loaded.scans[0].sync_status, 'synced');
    assert.equal(loaded.scans[0].synced_at, '2026-06-14 10:00:00');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('migrateLegacyStore imports current scanner-insights.json once', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scanner-store-'));
  const legacyPath = path.join(dir, 'scanner-insights.json');
  const queuePath = path.join(dir, 'queue.json');
  try {
    await writeFile(legacyPath, JSON.stringify({
      nextId: 2,
      scans: [{
        id: 1,
        barcode: '850060573',
        scanned_at: '2026-05-29 17:15:44',
        source: 'global-listener',
        note: 'Captured from keyboard listener',
        machine_id: 'FS1-BLM-WK04'
      }]
    }));

    const result = await migrateLegacyStore({ legacyPath, queuePath });
    assert.equal(result.imported, 1);

    const second = await migrateLegacyStore({ legacyPath, queuePath });
    assert.equal(second.imported, 0);
    const queue = JSON.parse(await readFile(queuePath, 'utf8'));
    assert.equal(queue.scans.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test test/local-store.test.mjs`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement local queue store**

Create `src/shared/local-store.mjs`:

```js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDuplicateKey, localTimestamp, validateScanInput } from './scans.mjs';

export function createEmptyStore() {
  return { nextId: 1, scans: [] };
}

export async function loadLocalStore(storePath) {
  try {
    const parsed = JSON.parse(await readFile(storePath, 'utf8'));
    return {
      nextId: Number.isInteger(parsed.nextId) ? parsed.nextId : 1,
      scans: Array.isArray(parsed.scans) ? parsed.scans : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return createEmptyStore();
  }
}

export async function saveLocalStore(storePath, store) {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf8');
}

export async function appendQueuedScan(storePath, input) {
  const store = await loadLocalStore(storePath);
  const scan = {
    ...validateScanInput(input),
    local_id: store.nextId,
    sync_status: 'pending',
    synced_at: null
  };

  store.nextId += 1;
  store.scans.push(scan);
  await saveLocalStore(storePath, store);
  return scan;
}

export async function markSynced(storePath, localIds, syncedAt = localTimestamp()) {
  const ids = new Set(localIds.map(Number));
  const store = await loadLocalStore(storePath);
  for (const scan of store.scans) {
    if (ids.has(Number(scan.local_id))) {
      scan.sync_status = 'synced';
      scan.synced_at = syncedAt;
    }
  }
  await saveLocalStore(storePath, store);
  return store;
}

export function getPendingScans(store, limit = 100) {
  return store.scans.filter((scan) => scan.sync_status !== 'synced').slice(0, limit);
}

export async function migrateLegacyStore({ legacyPath, queuePath }) {
  let legacy;
  try {
    legacy = JSON.parse(await readFile(legacyPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { imported: 0, skipped: 0 };
    throw error;
  }

  const queue = await loadLocalStore(queuePath);
  const existing = new Set(queue.scans.map(buildDuplicateKey));
  let imported = 0;
  let skipped = 0;

  for (const raw of Array.isArray(legacy.scans) ? legacy.scans : []) {
    const scan = {
      ...validateScanInput(raw),
      local_id: queue.nextId,
      sync_status: 'pending',
      synced_at: null
    };
    const key = buildDuplicateKey(scan);
    if (existing.has(key)) {
      skipped += 1;
      continue;
    }
    existing.add(key);
    queue.nextId += 1;
    queue.scans.push(scan);
    imported += 1;
  }

  await saveLocalStore(queuePath, queue);
  return { imported, skipped };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/local-store.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/shared/local-store.mjs test/local-store.test.mjs
git commit -m "feat: add local scan queue store"
```

---

## Task 4: Cloud Database Schema And Function Contracts

**Files:**
- Create: `src/cloud/schema.sql`
- Create: `src/cloud/db.mjs`
- Create: `netlify/functions/ingest-scans.mjs`
- Create: `netlify/functions/dashboard.mjs`
- Create: `netlify/functions/import-csv.mjs`
- Test: `test/import-csv.test.mjs`

- [ ] **Step 1: Create SQL schema**

Create `src/cloud/schema.sql`:

```sql
create table if not exists machines (
  machine_id text primary key,
  label text,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now()
);

create table if not exists scans (
  id bigserial primary key,
  barcode text not null,
  scanned_at timestamp not null,
  source text not null default 'global-listener',
  note text,
  machine_id text not null references machines(machine_id),
  imported_from text,
  created_at timestamptz not null default now(),
  unique(machine_id, barcode, scanned_at)
);

create index if not exists scans_scanned_at_idx on scans(scanned_at);
create index if not exists scans_machine_scanned_idx on scans(machine_id, scanned_at);
create index if not exists scans_barcode_day_idx on scans(barcode, scanned_at);
```

- [ ] **Step 2: Write CSV import tests for shared parsing/dedupe helper**

Create `test/import-csv.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDuplicateKey, parseScanCsv } from '../src/shared/scans.mjs';

test('long exports from different machines are not duplicates', () => {
  const pos1 = parseScanCsv([
    'id,barcode,scanned_at,source,note,machine_id',
    '1,850060573,2026-05-29 17:15:44,global-listener,Captured from keyboard listener,FS1-BLM-WK04'
  ].join('\n'));
  const pos2 = parseScanCsv([
    'id,barcode,scanned_at,source,note,machine_id',
    '1,850060573,2026-05-29 17:15:56,global-listener,Captured from keyboard listener,FS1-BLM-WK02'
  ].join('\n'));

  assert.notEqual(buildDuplicateKey(pos1.rows[0]), buildDuplicateKey(pos2.rows[0]));
});

test('subset export duplicates are skipped by machine barcode timestamp key', () => {
  const longExport = parseScanCsv([
    'id,barcode,scanned_at,source,note,machine_id',
    '1,850060573,2026-05-29 17:15:44,global-listener,Captured from keyboard listener,FS1-BLM-WK04'
  ].join('\n'));
  const subsetExport = parseScanCsv([
    'id,barcode,scanned_at,source,note,machine_id',
    '1,850060573,2026-05-29 17:15:44,global-listener,Captured from keyboard listener,FS1-BLM-WK04'
  ].join('\n'));

  const keys = new Set(longExport.rows.map(buildDuplicateKey));
  const newRows = subsetExport.rows.filter((row) => !keys.has(buildDuplicateKey(row)));
  assert.equal(newRows.length, 0);
});
```

- [ ] **Step 3: Run import tests**

Run: `node --test test/import-csv.test.mjs`

Expected: PASS once Task 2 exists.

- [ ] **Step 4: Create cloud DB helper**

Create `src/cloud/db.mjs`:

```js
import { neon } from '@netlify/neon';

let client;

export function getSql() {
  if (!client) {
    client = neon();
  }
  return client;
}

export async function insertScans(sql, scans, importedFrom = null) {
  const inserted = [];
  const skipped = [];

  for (const scan of scans) {
    await sql`
      insert into machines (machine_id, last_seen_at)
      values (${scan.machine_id}, now())
      on conflict (machine_id)
      do update set last_seen_at = now()
    `;

    const result = await sql`
      insert into scans (barcode, scanned_at, source, note, machine_id, imported_from)
      values (${scan.barcode}, ${scan.scanned_at}, ${scan.source}, ${scan.note}, ${scan.machine_id}, ${importedFrom})
      on conflict (machine_id, barcode, scanned_at) do nothing
      returning id
    `;

    if (result.length) {
      inserted.push({ ...scan, cloud_id: result[0].id });
    } else {
      skipped.push(scan);
    }
  }

  return { inserted, skipped };
}
```

- [ ] **Step 5: Create ingest function**

Create `netlify/functions/ingest-scans.mjs`:

```js
import { getSql, insertScans } from '../../src/cloud/db.mjs';
import { validateScanInput } from '../../src/shared/scans.mjs';

export default async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  const rawScans = Array.isArray(body?.scans) ? body.scans : [];
  const localIds = [];
  const scans = [];
  const errors = [];

  rawScans.forEach((raw, index) => {
    try {
      scans.push(validateScanInput(raw));
      localIds.push(raw.local_id ?? raw.localId ?? null);
    } catch (error) {
      errors.push(`Row ${index + 1}: ${error.message}`);
    }
  });

  if (errors.length) {
    return Response.json({ inserted: 0, skipped: 0, errors }, { status: 400 });
  }

  const result = await insertScans(getSql(), scans, body?.importedFrom || 'agent');
  return Response.json({
    inserted: result.inserted.length,
    skipped: result.skipped.length,
    syncedLocalIds: localIds.filter((id) => id != null),
    errors: []
  });
};
```

- [ ] **Step 6: Create import function**

Create `netlify/functions/import-csv.mjs`:

```js
import { getSql, insertScans } from '../../src/cloud/db.mjs';
import { parseScanCsv } from '../../src/shared/scans.mjs';

export default async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  const csv = body?.csv;
  const importedFrom = body?.filename || 'csv-import';
  const parsed = parseScanCsv(csv);

  if (parsed.errors.length) {
    return Response.json({ inserted: 0, skipped: 0, errors: parsed.errors.slice(0, 25) }, { status: 400 });
  }

  const result = await insertScans(getSql(), parsed.rows, importedFrom);
  return Response.json({
    inserted: result.inserted.length,
    skipped: result.skipped.length,
    errors: []
  });
};
```

- [ ] **Step 7: Create dashboard function**

Create `netlify/functions/dashboard.mjs`:

```js
import { getSql } from '../../src/cloud/db.mjs';
import { buildSummary, getRangeParams } from '../../src/shared/scans.mjs';

export default async (request) => {
  const url = new URL(request.url);
  const range = getRangeParams(Object.fromEntries(url.searchParams.entries()));
  const machine = url.searchParams.get('machine');
  const sql = getSql();

  const rows = machine
    ? await sql`
        select id, barcode, to_char(scanned_at, 'YYYY-MM-DD HH24:MI:SS') as scanned_at, source, note, machine_id
        from scans
        where scanned_at::date between ${range.start}::date and ${range.end}::date
          and machine_id = ${machine}
        order by scanned_at asc, id asc
      `
    : await sql`
        select id, barcode, to_char(scanned_at, 'YYYY-MM-DD HH24:MI:SS') as scanned_at, source, note, machine_id
        from scans
        where scanned_at::date between ${range.start}::date and ${range.end}::date
        order by scanned_at asc, id asc
      `;

  const allRows = await sql`
    select id, barcode, to_char(scanned_at, 'YYYY-MM-DD HH24:MI:SS') as scanned_at, source, note, machine_id
    from scans
    order by scanned_at asc, id asc
  `;

  const machines = await sql`
    select machine_id, label, to_char(last_seen_at, 'YYYY-MM-DD HH24:MI:SS') as last_seen_at
    from machines
    order by machine_id asc
  `;

  return Response.json({
    range,
    machineId: machine || 'all',
    availableMachines: machines,
    ...buildSummary(machine ? rows : allRows, range)
  });
};
```

- [ ] **Step 8: Run checks**

Run: `node --check netlify/functions/ingest-scans.mjs`

Expected: PASS.

Run: `node --check netlify/functions/import-csv.mjs`

Expected: PASS.

Run: `node --check netlify/functions/dashboard.mjs`

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/cloud netlify/functions test/import-csv.test.mjs
git commit -m "feat: add cloud scan API contracts"
```

---

## Task 5: Netlify Static App Wiring

**Files:**
- Create: `netlify.toml`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`

- [ ] **Step 1: Create Netlify config**

Create `netlify.toml`:

```toml
[build]
  publish = "public"
  functions = "netlify/functions"

[[redirects]]
  from = "/api/dashboard"
  to = "/.netlify/functions/dashboard"
  status = 200

[[redirects]]
  from = "/api/import"
  to = "/.netlify/functions/import-csv"
  status = 200
```

- [ ] **Step 2: Add machine filter markup**

In `public/index.html`, add this control inside the existing `.controls` section after the reporting window select:

```html
<label>
  Machine
  <select id="machine-select">
    <option value="">All machines</option>
  </select>
</label>
```

Add this panel before Recent Activity:

```html
<article class="panel">
  <div class="panel-head">
    <h2>Machines</h2>
    <p>Capture status by POS station.</p>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Machine</th>
          <th>Range scans</th>
          <th>Unique</th>
          <th>Last sync</th>
        </tr>
      </thead>
      <tbody id="machines-table"></tbody>
    </table>
  </div>
</article>
```

- [ ] **Step 3: Update frontend fetch logic**

In `public/app.js`, add:

```js
const machineSelect = document.getElementById('machine-select');
const machinesTable = document.getElementById('machines-table');
```

In `fetchDashboard()`, add:

```js
if (machineSelect?.value) {
  params.set('machine', machineSelect.value);
}
```

After payload is loaded, add:

```js
if (machineSelect && Array.isArray(payload.availableMachines)) {
  const current = machineSelect.value;
  machineSelect.innerHTML = '<option value="">All machines</option>' + payload.availableMachines
    .map((machine) => `<option value="${machine.machine_id}">${machine.label || machine.machine_id}</option>`)
    .join('');
  machineSelect.value = current;
}

if (machinesTable) {
  const lastSeen = new Map((payload.availableMachines || []).map((machine) => [machine.machine_id, machine.last_seen_at || '']));
  renderTable(
    machinesTable,
    payload.machines || [],
    [
      (row) => row.machine_id,
      (row) => formatNumber(row.total_scans),
      (row) => formatNumber(row.unique_scans),
      (row) => lastSeen.get(row.machine_id) || ''
    ],
    'No machine data in this range.'
  );
}
```

Add event handler:

```js
machineSelect?.addEventListener('change', fetchDashboard);
```

- [ ] **Step 4: Add compact machine styles**

In `public/styles.css`, add:

```css
.machine-sync-ok {
  color: var(--success);
  font-weight: 700;
}

.machine-sync-warn {
  color: var(--warning);
  font-weight: 700;
}
```

- [ ] **Step 5: Verify local static app still loads**

Run: `npm run dev`

Expected: server starts at `http://localhost:4312`.

Open the dashboard and confirm existing local mode still renders. If cloud env vars are not configured, dashboard may show local data through the compatibility server from Task 6.

- [ ] **Step 6: Commit**

Run:

```bash
git add netlify.toml public/index.html public/app.js public/styles.css
git commit -m "feat: wire web dashboard for cloud functions"
```

---

## Task 6: Local Compatibility Server Refactor

**Files:**
- Create: `src/local/server.mjs`
- Modify: `server.mjs`

- [ ] **Step 1: Extract local server without changing behavior**

Create `src/local/server.mjs` by moving the Express app logic from `server.mjs`, then replace duplicated helper functions with imports from `src/shared/scans.mjs` and `src/shared/local-store.mjs`.

Keep these local routes working:

```text
GET /api/health
GET /api/dashboard
GET /api/listener
POST /api/listener
POST /api/scans
POST /api/simulate
POST /api/reset
GET /api/export.csv
POST /api/import
```

- [ ] **Step 2: Preserve current entry point**

Replace `server.mjs` with:

```js
import './src/local/server.mjs';
```

- [ ] **Step 3: Verify existing app still starts**

Run: `npm run dev`

Expected:

```text
Scanner Insights running at http://localhost:4312
```

- [ ] **Step 4: Verify syntax and tests**

Run: `npm test`

Expected: PASS.

Run: `node --check server.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add server.mjs src/local/server.mjs
git commit -m "refactor: keep local server as compatibility wrapper"
```

---

## Task 7: Background Agent And Sync Client

**Files:**
- Create: `src/local/listener.mjs`
- Create: `src/local/sync-client.mjs`
- Create: `src/local/agent.mjs`
- Test: `test/sync-client.test.mjs`

- [ ] **Step 1: Write sync-client tests**

Create `test/sync-client.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPendingScans } from '../src/local/sync-client.mjs';

test('syncPendingScans posts pending rows and returns synced local ids', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({ inserted: 1, skipped: 0, syncedLocalIds: [1], errors: [] })
    };
  };

  const result = await syncPendingScans({
    endpoint: 'https://example.netlify.app/.netlify/functions/ingest-scans',
    scans: [{ local_id: 1, barcode: '850060573', scanned_at: '2026-05-29 17:15:44', source: 'global-listener', machine_id: 'FS1-BLM-WK04' }],
    fetchImpl
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(result.syncedLocalIds, [1]);
});

test('syncPendingScans treats network failures as retryable', async () => {
  await assert.rejects(
    () => syncPendingScans({
      endpoint: 'https://example.netlify.app/.netlify/functions/ingest-scans',
      scans: [{ local_id: 1, barcode: '850060573', scanned_at: '2026-05-29 17:15:44', source: 'global-listener', machine_id: 'FS1-BLM-WK04' }],
      fetchImpl: async () => { throw new Error('offline'); }
    }),
    /offline/
  );
});
```

- [ ] **Step 2: Implement sync client**

Create `src/local/sync-client.mjs`:

```js
export async function syncPendingScans({ endpoint, scans, fetchImpl = fetch }) {
  if (!endpoint) {
    throw new Error('SCANNER_INSIGHTS_CLOUD_ENDPOINT is required for sync.');
  }
  if (!scans.length) {
    return { syncedLocalIds: [], inserted: 0, skipped: 0, errors: [] };
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scans, importedFrom: 'agent' })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || (payload.errors || []).join('; ') || `Sync failed with HTTP ${response.status}`);
  }

  return {
    syncedLocalIds: payload.syncedLocalIds || [],
    inserted: payload.inserted || 0,
    skipped: payload.skipped || 0,
    errors: payload.errors || []
  };
}
```

- [ ] **Step 3: Implement listener module**

Create `src/local/listener.mjs` by extracting listener spawn and burst-buffer logic from current `server.mjs`. Export:

```js
export function createScannerListener({ helperPath, onScan, onStateChange, now = () => Date.now() }) {
  // returns { start, stop, getState }
}
```

Keep constants:

```js
const BUFFER_RESET_MS = 250;
const MAX_SCAN_WINDOW_MS = 1500;
const MIN_BARCODE_LENGTH = 4;
```

On valid Enter-delimited burst, call:

```js
await onScan(barcode, {
  source: 'global-listener',
  note: 'Captured from keyboard listener'
});
```

- [ ] **Step 4: Implement agent**

Create `src/local/agent.mjs`:

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import { appendQueuedScan, getPendingScans, loadLocalStore, markSynced, migrateLegacyStore } from '../shared/local-store.mjs';
import { localTimestamp } from '../shared/scans.mjs';
import { createScannerListener } from './listener.mjs';
import { syncPendingScans } from './sync-client.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..', '..');

const MACHINE_ID = process.env.SCANNER_MACHINE_ID || hostname();
const DATA_DIR = process.env.SCANNER_INSIGHTS_DATA_DIR || path.join(appRoot, 'data');
const QUEUE_PATH = path.join(DATA_DIR, 'scanner-insights-queue.json');
const LEGACY_PATH = path.join(DATA_DIR, 'scanner-insights.json');
const CLOUD_ENDPOINT = process.env.SCANNER_INSIGHTS_CLOUD_ENDPOINT || '';
const SYNC_INTERVAL_MS = Number(process.env.SCANNER_INSIGHTS_SYNC_INTERVAL_MS || 15000);

await migrateLegacyStore({ legacyPath: LEGACY_PATH, queuePath: QUEUE_PATH });

async function syncOnce() {
  if (!CLOUD_ENDPOINT) return;
  const store = await loadLocalStore(QUEUE_PATH);
  const pending = getPendingScans(store, 100);
  if (!pending.length) return;
  const result = await syncPendingScans({ endpoint: CLOUD_ENDPOINT, scans: pending });
  await markSynced(QUEUE_PATH, result.syncedLocalIds, localTimestamp());
}

const listener = createScannerListener({
  helperPath: path.join(appRoot, 'bin', 'ScannerKeyHook.exe'),
  onScan: async (barcode, details) => {
    await appendQueuedScan(QUEUE_PATH, {
      barcode,
      scanned_at: localTimestamp(),
      machine_id: MACHINE_ID,
      source: details.source,
      note: details.note
    });
    await syncOnce().catch((error) => console.error('Sync failed:', error.message));
  },
  onStateChange: (state) => console.log(JSON.stringify({ type: 'listener-state', state }))
});

await listener.start();
setInterval(() => {
  syncOnce().catch((error) => console.error('Sync failed:', error.message));
}, SYNC_INTERVAL_MS);
```

- [ ] **Step 5: Run tests and checks**

Run: `node --test test/sync-client.test.mjs`

Expected: PASS.

Run: `node --check src/local/agent.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/local/listener.mjs src/local/sync-client.mjs src/local/agent.mjs test/sync-client.test.mjs
git commit -m "feat: add startup capture agent and sync client"
```

---

## Task 8: Seed Import From POS CSVs

**Files:**
- Create: `scripts/validate-seed-csv.mjs`
- Create: `scripts/seed-cloud-from-csv.mjs`
- Create: `data/seed/.gitkeep`

- [ ] **Step 1: Create seed directory marker**

Create `data/seed/.gitkeep`:

```text

```

Keep actual POS CSVs out of Git. Save them locally as:

```text
data/seed/pos1-FS1-BLM-WK04-2026-05-29-to-2026-06-11.csv
data/seed/pos2-FS1-BLM-WK02-2026-05-29-to-2026-06-11.csv
```

- [ ] **Step 2: Implement seed validator**

Create `scripts/validate-seed-csv.mjs`:

```js
import { readFile } from 'node:fs/promises';
import { buildDuplicateKey, parseScanCsv } from '../src/shared/scans.mjs';

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('Usage: node scripts/validate-seed-csv.mjs <csv...>');
  process.exit(1);
}

const allKeys = new Set();
for (const filePath of paths) {
  const csv = await readFile(filePath, 'utf8');
  const parsed = parseScanCsv(csv);
  const machines = new Map();
  let duplicates = 0;

  for (const row of parsed.rows) {
    machines.set(row.machine_id, (machines.get(row.machine_id) || 0) + 1);
    const key = buildDuplicateKey(row);
    if (allKeys.has(key)) duplicates += 1;
    allKeys.add(key);
  }

  const sorted = [...parsed.rows].sort((a, b) => a.scanned_at.localeCompare(b.scanned_at));
  console.log(JSON.stringify({
    file: filePath,
    rows: parsed.rows.length,
    errors: parsed.errors.length,
    first: sorted[0]?.scanned_at || null,
    last: sorted.at(-1)?.scanned_at || null,
    machines: Object.fromEntries(machines),
    duplicatesAcrossInputs: duplicates
  }, null, 2));
}
```

- [ ] **Step 3: Implement cloud seed script**

Create `scripts/seed-cloud-from-csv.mjs`:

```js
import { readFile } from 'node:fs/promises';
import { parseScanCsv } from '../src/shared/scans.mjs';

const endpoint = process.env.SCANNER_INSIGHTS_IMPORT_ENDPOINT;
const paths = process.argv.slice(2);

if (!endpoint) {
  console.error('SCANNER_INSIGHTS_IMPORT_ENDPOINT is required.');
  process.exit(1);
}

for (const filePath of paths) {
  const csv = await readFile(filePath, 'utf8');
  const parsed = parseScanCsv(csv);
  if (parsed.errors.length) {
    console.error(`${filePath}: ${parsed.errors.slice(0, 10).join('; ')}`);
    process.exit(1);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: filePath, csv })
  });
  const payload = await response.json();
  console.log(JSON.stringify({ file: filePath, status: response.status, payload }, null, 2));
  if (!response.ok) process.exit(1);
}
```

- [ ] **Step 4: Validate seed files**

Run:

```bash
node scripts/validate-seed-csv.mjs data/seed/pos1-FS1-BLM-WK04-2026-05-29-to-2026-06-11.csv data/seed/pos2-FS1-BLM-WK02-2026-05-29-to-2026-06-11.csv
```

Expected:

```text
POS1: 531 rows, machine FS1-BLM-WK04
POS2: 570 rows, machine FS1-BLM-WK02
0 parse errors
```

- [ ] **Step 5: Commit scripts**

Run:

```bash
git add scripts/validate-seed-csv.mjs scripts/seed-cloud-from-csv.mjs data/seed/.gitkeep
git commit -m "feat: add POS seed import tooling"
```

---

## Task 9: Installer Update For Startup Agent

**Files:**
- Modify: `usb-launchers/installer.ps1`
- Modify: `usb-launchers/launcher-start.ps1`
- Modify: `usb-launchers/launcher-stop.ps1`
- Modify: `scripts/build-usb-bundle.ps1`
- Modify: `README.md`

- [ ] **Step 1: Preserve existing data during install**

In `usb-launchers/installer.ps1`, change `Remove-ExistingInstall` so it backs up existing data before removing app files:

```powershell
$dataBackup = Join-Path $runRoot "data-backup"
if (Test-Path (Join-Path $appTarget "data")) {
  New-Item -ItemType Directory -Force -Path $dataBackup | Out-Null
  Copy-Item (Join-Path $appTarget "data\*") -Destination $dataBackup -Recurse -Force -ErrorAction SilentlyContinue
}
```

After `Copy-AppFiles`, restore backup:

```powershell
if (Test-Path $dataBackup) {
  New-Item -ItemType Directory -Force -Path (Join-Path $appTarget "data") | Out-Null
  Copy-Item (Join-Path $dataBackup "*") -Destination (Join-Path $appTarget "data") -Recurse -Force -ErrorAction SilentlyContinue
}
```

- [ ] **Step 2: Add startup agent launcher**

Create a startup shortcut target that runs:

```powershell
node.exe "$InstallRoot\app\src\local\agent.mjs"
```

Set environment variables before launch:

```powershell
$env:SCANNER_MACHINE_ID = $env:COMPUTERNAME
$env:SCANNER_INSIGHTS_CLOUD_ENDPOINT = "<NETLIFY_INGEST_URL_FROM_INSTALL_CONFIG>"
```

For the first install version, read cloud endpoint from:

```text
%LOCALAPPDATA%\ScannerInsights\config\agent.env
```

- [ ] **Step 3: Keep dashboard launcher optional**

Change `launcher-start.ps1` so normal startup launches the agent. Keep `Start-Scanner-Insights.bat` for opening the local dashboard manually.

- [ ] **Step 4: Update bundle script**

In `scripts/build-usb-bundle.ps1`, include new directories:

```powershell
Copy-Item (Join-Path $RepoRoot "src") -Destination $appTarget -Recurse -Force
Copy-Item (Join-Path $RepoRoot "netlify") -Destination $appTarget -Recurse -Force
```

- [ ] **Step 5: Update README deployment notes**

Add:

```markdown
## Web sync deployment

The installed POS agent starts with Windows, captures scanner-style keyboard bursts, writes each scan to a local queue, and syncs to the Netlify ingest API when online. The browser dashboard does not need to be open for capture.
```

- [ ] **Step 6: Verify bundle build**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-usb-bundle.ps1
```

Expected: `dist\scanner-insights-usb\app\src\local\agent.mjs` exists.

- [ ] **Step 7: Commit**

Run:

```bash
git add usb-launchers scripts README.md
git commit -m "feat: install scanner sync agent at startup"
```

---

## Task 10: End-To-End Verification

**Files:**
- Modify only files required by failures found during verification.

- [ ] **Step 1: Run unit tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run syntax checks**

Run: `npm run check`

Expected: all checked files pass.

- [ ] **Step 3: Validate POS seed CSVs**

Run:

```bash
node scripts/validate-seed-csv.mjs data/seed/pos1-FS1-BLM-WK04-2026-05-29-to-2026-06-11.csv data/seed/pos2-FS1-BLM-WK02-2026-05-29-to-2026-06-11.csv
```

Expected:

```text
FS1-BLM-WK04=531
FS1-BLM-WK02=570
```

- [ ] **Step 4: Start local server**

Run: `npm run dev`

Expected: dashboard reachable at `http://localhost:4312`.

- [ ] **Step 5: Test local queue migration**

Place a copy of current `data/scanner-insights.json` in the install data directory, run:

```bash
npm run agent
```

Expected: `data/scanner-insights-queue.json` contains migrated pending rows.

- [ ] **Step 6: Test cloud ingest duplicate protection**

Run the seed import twice against a staging Netlify site:

```bash
node scripts/seed-cloud-from-csv.mjs data/seed/pos1-FS1-BLM-WK04-2026-05-29-to-2026-06-11.csv data/seed/pos2-FS1-BLM-WK02-2026-05-29-to-2026-06-11.csv
```

Expected first run: inserts 1101 total rows.

Expected second run: inserts 0 rows and skips 1101 rows.

- [ ] **Step 7: Verify web dashboard**

Open the Netlify site and confirm:

```text
All machines total rows: 1101
Machine filter includes FS1-BLM-WK02 and FS1-BLM-WK04
Daily, hourly, repeats, recent activity render from cloud data
```

- [ ] **Step 8: Commit verification fixes**

Run:

```bash
git add .
git commit -m "fix: complete scanner web sync verification"
```

Only commit if verification required code changes.

---

## Self-Review

- Spec coverage: The plan covers cloud reporting, CSV seed import from both POS machines, preserving current installed listener behavior, a startup background agent, local durable queue, cloud sync, duplicate protection, installer updates, and verification.
- Placeholder scan: No implementation task relies on an unresolved placeholder for behavior. The only value intentionally supplied at install/deployment time is the Netlify ingest URL, stored in `agent.env`.
- Type consistency: Shared scan fields use `barcode`, `scanned_at`, `source`, `note`, `machine_id`, `local_id`, `sync_status`, and `synced_at` consistently across tests, local store, sync client, and cloud functions.
- Scope check: This is a multi-part migration but remains one product path. Tasks are sequenced so each phase is testable and preserves the current installation until the startup agent replaces browser-tied capture.
