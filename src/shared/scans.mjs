export function localTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function normalizeBarcode(barcode) {
  return String(barcode || '').trim().replace(/\s+/g, '');
}

export function validateScanInput(input) {
  const barcode = normalizeBarcode(input?.barcode);
  if (!/^\d{4,32}$/.test(barcode)) {
    throw new Error('Barcode must be 4-32 digits.');
  }

  const scannedAt = String(input?.scanned_at || input?.scannedAt || localTimestamp()).trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(scannedAt)) {
    throw new Error('scanned_at must be formatted as YYYY-MM-DD HH:mm:ss.');
  }

  const machineId = String(input?.machine_id || input?.machineId || '').trim();
  if (!machineId) {
    throw new Error('machine_id is required.');
  }

  return {
    id: input?.id == null || input.id === '' ? null : Number(input.id),
    barcode,
    scanned_at: scannedAt,
    source: String(input?.source || 'global-listener').trim(),
    note: input?.note ? String(input.note) : null,
    machine_id: machineId,
    sync_status: input?.sync_status || 'pending',
    synced_at: input?.synced_at || null
  };
}

export function buildDuplicateKey(scan) {
  return `${scan.machine_id}|${scan.barcode}|${scan.scanned_at}`;
}

export function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}

export function parseScanCsv(csv) {
  if (typeof csv !== 'string' || !csv.trim()) {
    return { rows: [], errors: ['CSV content is empty.'] };
  }

  const lines = csv.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCSVLine(lines[0]).map((header) => header.trim());
  const errors = [];
  const rows = [];

  for (const required of ['barcode', 'scanned_at', 'machine_id']) {
    if (!headers.includes(required)) {
      errors.push(`Missing required column: ${required}`);
    }
  }

  if (errors.length) {
    return { rows, errors };
  }

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCSVLine(lines[i]);
    const raw = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    try {
      rows.push(validateScanInput(raw));
    } catch (error) {
      errors.push(`Row ${i + 1}: ${error.message}`);
    }
  }

  return { rows, errors };
}

export function getRangeParams(query = {}, now = new Date()) {
  const daysValue = Number(query.days || 14);
  const days = Number.isFinite(daysValue) ? Math.min(Math.max(daysValue, 1), 90) : 14;
  const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (isDate(query.start) && isDate(query.end) && query.start <= query.end) {
    return { mode: 'custom', start: query.start, end: query.end, days };
  }

  const end = localTimestamp(now).slice(0, 10);
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - (days - 1));
  return { mode: 'quick', start: localTimestamp(startDate).slice(0, 10), end, days };
}

export function buildSummary(scans, range, today = localTimestamp().slice(0, 10)) {
  const selectedScans = scans.filter((scan) => {
    const day = scan.scanned_at.slice(0, 10);
    return day >= range.start && day <= range.end;
  });
  const todayScans = scans.filter((scan) => scan.scanned_at.slice(0, 10) === today);
  const countUnique = (rows, keyFn) => new Set(rows.map(keyFn)).size;

  const summary = {
    total_today: todayScans.length,
    unique_today: countUnique(todayScans, (scan) => scan.barcode),
    repeats_today: todayScans.length - countUnique(todayScans, (scan) => scan.barcode),
    total_range: selectedScans.length,
    unique_range: countUnique(selectedScans, (scan) => scan.barcode),
    repeats_range: selectedScans.length - countUnique(selectedScans, (scan) => scan.barcode),
    total_all_time: scans.length
  };

  const dailyMap = new Map();
  const hourlyMap = new Map();
  const repeatMap = new Map();
  const machineMap = new Map();

  for (const scan of selectedScans) {
    const day = scan.scanned_at.slice(0, 10);
    const hour = scan.scanned_at.slice(11, 13);

    const daily = dailyMap.get(day) || { day, total_scans: 0, barcodes: new Set() };
    daily.total_scans += 1;
    daily.barcodes.add(scan.barcode);
    dailyMap.set(day, daily);

    const hourly = hourlyMap.get(hour) || { hour, total_scans: 0, visits: new Set() };
    hourly.total_scans += 1;
    hourly.visits.add(`${scan.barcode}:${day}`);
    hourlyMap.set(hour, hourly);

    const repeatKey = `${scan.barcode}:${day}`;
    const repeat = repeatMap.get(repeatKey) || {
      barcode: scan.barcode,
      day,
      scans_that_day: 0,
      first_seen: scan.scanned_at,
      last_seen: scan.scanned_at
    };
    repeat.scans_that_day += 1;
    repeat.first_seen = scan.scanned_at < repeat.first_seen ? scan.scanned_at : repeat.first_seen;
    repeat.last_seen = scan.scanned_at > repeat.last_seen ? scan.scanned_at : repeat.last_seen;
    repeatMap.set(repeatKey, repeat);

    const machine = machineMap.get(scan.machine_id) || { machine_id: scan.machine_id, total_scans: 0, barcodes: new Set() };
    machine.total_scans += 1;
    machine.barcodes.add(scan.barcode);
    machineMap.set(scan.machine_id, machine);
  }

  const daily = Array.from(dailyMap.values()).map((row) => ({
    day: row.day,
    total_scans: row.total_scans,
    unique_scans: row.barcodes.size,
    repeat_scans: row.total_scans - row.barcodes.size
  })).sort((a, b) => a.day.localeCompare(b.day));

  const hourly = Array.from(hourlyMap.values()).map((row) => ({
    hour: row.hour,
    total_scans: row.total_scans,
    unique_visits: row.visits.size
  })).sort((a, b) => a.hour.localeCompare(b.hour));

  const repeats = Array.from(repeatMap.values())
    .filter((row) => row.scans_that_day > 1)
    .sort((a, b) => b.day.localeCompare(a.day) || b.scans_that_day - a.scans_that_day || a.barcode.localeCompare(b.barcode))
    .slice(0, 25);

  const recent = [...selectedScans]
    .sort((a, b) => b.scanned_at.localeCompare(a.scanned_at))
    .slice(0, 30)
    .map((scan) => ({
      id: scan.id,
      barcode: scan.barcode,
      scannedAt: scan.scanned_at,
      source: scan.source,
      machineId: scan.machine_id,
      scan_number_for_day: selectedScans.filter((row) =>
        row.barcode === scan.barcode &&
        row.scanned_at.slice(0, 10) === scan.scanned_at.slice(0, 10) &&
        row.scanned_at <= scan.scanned_at
      ).length
    }));

  const machines = Array.from(machineMap.values()).map((row) => ({
    machine_id: row.machine_id,
    total_scans: row.total_scans,
    unique_scans: row.barcodes.size
  }));

  return { summary, daily, hourly, repeats, recent, machines };
}
