import { readFile } from 'node:fs/promises';
import { parseScanCsv } from '../src/shared/scans.mjs';

const endpoint = process.env.SCANNER_INSIGHTS_IMPORT_ENDPOINT;
const paths = process.argv.slice(2);

if (!endpoint) {
  console.error('SCANNER_INSIGHTS_IMPORT_ENDPOINT is required.');
  process.exit(1);
}

if (!paths.length) {
  console.error('Usage: node scripts/seed-cloud-from-csv.mjs <csv...>');
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
