import { getDatabase } from '@netlify/database';

let database;

function getDb() {
  if (!database) {
    database = getDatabase();
  }
  return database;
}

export function getSql() {
  return getDb().sql;
}

function buildDuplicateKey(scan) {
  return `${scan.machine_id}|${scan.barcode}|${scan.scanned_at}`;
}

function placeholders(rowCount, columnCount, startIndex = 1) {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const values = Array.from(
      { length: columnCount },
      (_, columnIndex) => `$${startIndex + rowIndex * columnCount + columnIndex}`
    );
    return `(${values.join(', ')})`;
  }).join(', ');
}

export async function insertScans(sql, scans, importedFrom = null) {
  if (!scans.length) {
    return { inserted: [], skipped: [] };
  }

  const pool = getDb().pool;
  const inserted = [];
  const insertedKeys = new Set();
  const machineIds = [...new Set(scans.map((scan) => scan.machine_id))];

  await pool.query(
    `
      insert into machines (machine_id, last_seen_at)
      values ${machineIds.map((_, index) => `($${index + 1}, now())`).join(', ')}
      on conflict (machine_id) do update set last_seen_at = now()
    `,
    machineIds
  );

  const batchSize = 200;
  for (let offset = 0; offset < scans.length; offset += batchSize) {
    const batch = scans.slice(offset, offset + batchSize);
    const params = [];
    for (const scan of batch) {
      params.push(scan.barcode, scan.scanned_at, scan.source, scan.note, scan.machine_id, importedFrom);
    }

    const result = await pool.query(
      `
      insert into scans (barcode, scanned_at, source, note, machine_id, imported_from)
      values ${placeholders(batch.length, 6)}
      on conflict (machine_id, barcode, scanned_at) do nothing
      returning id, barcode, to_char(scanned_at, 'YYYY-MM-DD HH24:MI:SS') as scanned_at, machine_id
      `,
      params
    );

    for (const row of result.rows || []) {
      const key = buildDuplicateKey(row);
      insertedKeys.add(key);
      const original = batch.find((scan) => buildDuplicateKey(scan) === key);
      if (original) {
        inserted.push({ ...original, cloud_id: row.id });
      }
    }
  }

  const skipped = scans.filter((scan) => !insertedKeys.has(buildDuplicateKey(scan)));

  return { inserted, skipped };
}
