import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import {
  appendQueuedScan,
  getPendingScans,
  loadLocalStore,
  markSynced,
  migrateLegacyStore
} from '../shared/local-store.mjs';
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
