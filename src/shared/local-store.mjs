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
