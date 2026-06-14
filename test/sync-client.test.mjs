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
