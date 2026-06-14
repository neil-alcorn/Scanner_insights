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

  if (parsed.errors.length) {
    process.exitCode = 1;
  }
}
