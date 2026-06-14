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
