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
