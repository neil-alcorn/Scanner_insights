import { getSql } from '../../src/cloud/db.mjs';
import { buildSummary, getRangeParams } from '../../src/shared/scans.mjs';

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

  const allRows = await sql`
    select id, barcode, to_char(scanned_at, 'YYYY-MM-DD HH24:MI:SS') as scanned_at, source, note, machine_id
    from scans
    order by scanned_at asc, id asc
  `;

  const machines = await sql`
    select machine_id, label, to_char(last_seen_at, 'YYYY-MM-DD HH24:MI:SS') as last_seen_at
    from machines
    order by machine_id asc
  `;

  return Response.json({
    range,
    machineId: machine || 'all',
    availableMachines: machines,
    ...buildSummary(machine ? rows : allRows, range)
  });
};
