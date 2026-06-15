import { getSql } from '../../src/cloud/db.mjs';
import { getRangeParams } from '../../src/shared/scans.mjs';

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export default async (request) => {
  const url = new URL(request.url);
  const range = getRangeParams(Object.fromEntries(url.searchParams.entries()));
  const machine = url.searchParams.get('machine');
  const sql = getSql();

  const rows = machine
    ? await sql`
        select id, barcode, to_char(scanned_at, 'YYYY-MM-DD HH24:MI:SS') as scanned_at, source, note, machine_id
        from scans
        where scanned_at::date between ${range.start}::date and ${range.end}::date
          and machine_id = ${machine}
        order by scanned_at asc, id asc
      `
    : await sql`
        select id, barcode, to_char(scanned_at, 'YYYY-MM-DD HH24:MI:SS') as scanned_at, source, note, machine_id
        from scans
        where scanned_at::date between ${range.start}::date and ${range.end}::date
        order by scanned_at asc, id asc
      `;

  const csv = [
    'id,barcode,scanned_at,source,note,machine_id',
    ...rows.map((row) =>
      [row.id, row.barcode, row.scanned_at, row.source, row.note, row.machine_id]
        .map(csvEscape)
        .join(',')
    )
  ].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="scanner-insights-${range.start}-to-${range.end}.csv"`
    }
  });
};
