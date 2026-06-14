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
