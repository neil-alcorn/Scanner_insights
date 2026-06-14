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
