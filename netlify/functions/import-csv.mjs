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
