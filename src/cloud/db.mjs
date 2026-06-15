import { getDatabase } from '@netlify/database';

let client;

export function getSql() {
  if (!client) {
    client = getDatabase().sql;
  }
  return client;
}

export async function insertScans(sql, scans, importedFrom = null) {
  const inserted = [];
  const skipped = [];

  for (const scan of scans) {
    await sql`
      insert into machines (machine_id, last_seen_at)
      values (${scan.machine_id}, now())
      on conflict (machine_id)
      do update set last_seen_at = now()
    `;

    const result = await sql`
      insert into scans (barcode, scanned_at, source, note, machine_id, imported_from)
      values (${scan.barcode}, ${scan.scanned_at}, ${scan.source}, ${scan.note}, ${scan.machine_id}, ${importedFrom})
      on conflict (machine_id, barcode, scanned_at) do nothing
      returning id
    `;

    if (result.length) {
      inserted.push({ ...scan, cloud_id: result[0].id });
    } else {
      skipped.push(scan);
    }
  }

  return { inserted, skipped };
}
