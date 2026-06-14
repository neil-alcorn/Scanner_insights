import express from 'express';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = Number(process.env.SCANNER_INSIGHTS_PORT || 4312);
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const STORE_PATH = path.join(DATA_DIR, 'scanner-insights.json');
const MACHINE_ID = process.env.SCANNER_MACHINE_ID || hostname();
const DISABLE_LISTENER = process.env.SCANNER_INSIGHTS_DISABLE_LISTENER === '1';

await mkdir(DATA_DIR, { recursive: true });

let scans = [];
let nextScanId = 1;

async function loadStore() {
  try {
    const parsed = JSON.parse(await readFile(STORE_PATH, 'utf8'));
    scans = Array.isArray(parsed.scans) ? parsed.scans : [];
    nextScanId = Number.isInteger(parsed.nextId)
      ? parsed.nextId
      : scans.reduce((max, scan) => Math.max(max, Number(scan.id) || 0), 0) + 1;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Unable to read ${STORE_PATH}:`, error);
    }
    scans = [];
    nextScanId = 1;
  }
}

function saveStore() {
  const payload = JSON.stringify({ nextId: nextScanId, scans }, null, 2);
  return writeFile(STORE_PATH, payload, 'utf8');
}

await loadStore();

const listenerState = {
  supported: process.platform === 'win32',
  enabled: false,
  active: false,
  status: process.platform === 'win32' ? 'ready' : 'unsupported',
  lastCapturedAt: null,
  lastBarcode: null,
  lastSource: null,
  error: null
};

let globalKeyboardListener = null;
let globalKeyboardStdout = '';
let scanBuffer = '';
let scanStartedAt = 0;
let lastKeyAt = 0;

const BUFFER_RESET_MS = 250;
const MAX_SCAN_WINDOW_MS = 1500;
const MIN_BARCODE_LENGTH = 4;

function localTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function todayString() {
  return localTimestamp().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function dateOnly(date = new Date()) {
  return localTimestamp(date).slice(0, 10);
}

function normalizeBarcode(barcode) {
  return String(barcode || '').trim().replace(/\s+/g, '');
}

async function ingestScan(barcode, source = 'scanner', note = null, when = new Date(), machineId = MACHINE_ID) {
  const normalized = normalizeBarcode(barcode);
  if (!/^\d{4,32}$/.test(normalized)) {
    throw new Error('Barcode must be 4-32 digits.');
  }

  const scannedAt = localTimestamp(when);
  const scan = {
    id: nextScanId++,
    barcode: normalized,
    scanned_at: scannedAt,
    source,
    note,
    machine_id: machineId
  };

  scans.push(scan);
  await saveStore();

  const day = scannedAt.slice(0, 10);
  const barcodeScansToday = scans.filter((row) => row.barcode === normalized && row.scanned_at.slice(0, 10) === day);

  return {
    id: scan.id,
    barcode: normalized,
    scannedAt,
    source,
    machineId,
    isFirstScanOfDay: barcodeScansToday.length === 1
  };
}

function resetKeyboardBuffer() {
  scanBuffer = '';
  scanStartedAt = 0;
  lastKeyAt = 0;
}

function extractDigit(eventName) {
  if (/^\d$/.test(eventName)) {
    return eventName;
  }

  const numpadMatch = /^NUMPAD (\d)$/.exec(eventName);
  return numpadMatch ? numpadMatch[1] : null;
}

function processVirtualKey(vkCode) {
  const now = Date.now();

  if (scanBuffer && now - lastKeyAt > BUFFER_RESET_MS) {
    resetKeyboardBuffer();
  }

  let digit = null;
  if (vkCode >= 48 && vkCode <= 57) {
    digit = String(vkCode - 48);
  } else if (vkCode >= 96 && vkCode <= 105) {
    digit = String(vkCode - 96);
  }

  if (digit) {
    if (!scanBuffer) {
      scanStartedAt = now;
    }

    scanBuffer += digit;
    lastKeyAt = now;
    return;
  }

  if (vkCode === 13) {
    const duration = scanStartedAt ? now - scanStartedAt : Infinity;
    const barcode = scanBuffer;
    resetKeyboardBuffer();

    if (barcode.length < MIN_BARCODE_LENGTH || duration > MAX_SCAN_WINDOW_MS) {
      return;
    }

    ingestScan(barcode, 'global-listener', 'Captured from keyboard listener')
      .then((result) => {
      listenerState.lastCapturedAt = result.scannedAt;
      listenerState.lastBarcode = result.barcode;
      listenerState.lastSource = result.source;
      listenerState.error = null;
      })
      .catch((error) => {
        listenerState.error = error.message;
      });

    return;
  }

  if (vkCode !== 16) {
    resetKeyboardBuffer();
  }
}

function handleHookOutput(chunk) {
  globalKeyboardStdout += chunk.toString('utf8');
  const lines = globalKeyboardStdout.split(/\r?\n/);
  globalKeyboardStdout = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const [state, vkCodeText] = trimmed.split(',');
    if (state !== 'DOWN') continue;

    const vkCode = Number(vkCodeText);
    if (Number.isFinite(vkCode)) {
      processVirtualKey(vkCode);
    }
  }
}

async function setListenerEnabled(enabled) {
  if (!listenerState.supported) {
    listenerState.enabled = false;
    listenerState.active = false;
    listenerState.status = 'unsupported';
    return listenerState;
  }

  if (!enabled) {
    if (globalKeyboardListener) {
      globalKeyboardListener.kill();
    }

    globalKeyboardListener = null;
    globalKeyboardStdout = '';
    resetKeyboardBuffer();
    listenerState.enabled = false;
    listenerState.active = false;
    listenerState.status = 'paused';
    listenerState.error = null;
    return listenerState;
  }

  if (listenerState.active) {
    listenerState.enabled = true;
    listenerState.status = 'listening';
    return listenerState;
  }

  try {
    const helperPath = path.join(__dirname, 'bin', 'ScannerKeyHook.exe');
    globalKeyboardListener = spawn(helperPath, [], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    globalKeyboardListener.stdout.on('data', handleHookOutput);
    globalKeyboardListener.stderr.on('data', (chunk) => {
      listenerState.error = chunk.toString('utf8').trim() || 'Keyboard helper error';
      listenerState.status = 'error';
    });
    globalKeyboardListener.on('error', (error) => {
      listenerState.error = error.message;
      listenerState.status = 'error';
      listenerState.active = false;
      listenerState.enabled = false;
    });
    globalKeyboardListener.on('exit', (code) => {
      if (listenerState.enabled && code !== 0) {
        listenerState.error = `Keyboard helper exited with code ${code}`;
        listenerState.status = 'error';
      }
      listenerState.active = false;
    });

    listenerState.enabled = true;
    listenerState.active = true;
    listenerState.status = 'listening';
    listenerState.error = null;
  } catch (error) {
    globalKeyboardListener = null;
    globalKeyboardStdout = '';
    listenerState.enabled = false;
    listenerState.active = false;
    listenerState.status = 'error';
    listenerState.error = error.message;
  }

  return listenerState;
}

function getDaysParam(value) {
  const parsed = Number(value || 14);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 90) : 14;
}

function isDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getRangeParams(query) {
  const days = getDaysParam(query.days);

  if (isDateString(query.start) && isDateString(query.end) && query.start <= query.end) {
    return {
      mode: 'custom',
      start: query.start,
      end: query.end,
      days
    };
  }

  return {
    mode: 'quick',
    start: dateOnly(addDays(new Date(), -(days - 1))),
    end: todayString(),
    days
  };
}

function buildSummary(range) {
  const selectedScans = scans.filter((scan) => {
    const day = scan.scanned_at.slice(0, 10);
    return day >= range.start && day <= range.end;
  });
  const todayScans = scans.filter((scan) => scan.scanned_at.slice(0, 10) === todayString());

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
  for (const scan of selectedScans) {
    const day = scan.scanned_at.slice(0, 10);
    const bucket = dailyMap.get(day) || { day, total_scans: 0, barcodes: new Set() };
    bucket.total_scans++;
    bucket.barcodes.add(scan.barcode);
    dailyMap.set(day, bucket);
  }
  const daily = Array.from(dailyMap.values())
    .map((bucket) => ({
      day: bucket.day,
      total_scans: bucket.total_scans,
      unique_scans: bucket.barcodes.size,
      repeat_scans: bucket.total_scans - bucket.barcodes.size
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const hourlyMap = new Map();
  for (const scan of selectedScans) {
    const hour = scan.scanned_at.slice(11, 13);
    const bucket = hourlyMap.get(hour) || { hour, total_scans: 0, visits: new Set() };
    bucket.total_scans++;
    bucket.visits.add(`${scan.barcode}:${scan.scanned_at.slice(0, 10)}`);
    hourlyMap.set(hour, bucket);
  }
  const hourly = Array.from(hourlyMap.values())
    .map((bucket) => ({
      hour: bucket.hour,
      total_scans: bucket.total_scans,
      unique_visits: bucket.visits.size
    }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

  const repeatMap = new Map();
  for (const scan of selectedScans) {
    const day = scan.scanned_at.slice(0, 10);
    const key = `${scan.barcode}:${day}`;
    const bucket = repeatMap.get(key) || {
      barcode: scan.barcode,
      day,
      scans_that_day: 0,
      first_seen: scan.scanned_at,
      last_seen: scan.scanned_at
    };
    bucket.scans_that_day++;
    bucket.first_seen = scan.scanned_at < bucket.first_seen ? scan.scanned_at : bucket.first_seen;
    bucket.last_seen = scan.scanned_at > bucket.last_seen ? scan.scanned_at : bucket.last_seen;
    repeatMap.set(key, bucket);
  }
  const repeats = Array.from(repeatMap.values())
    .filter((bucket) => bucket.scans_that_day > 1)
    .sort((a, b) => b.day.localeCompare(a.day) || b.scans_that_day - a.scans_that_day || a.barcode.localeCompare(b.barcode))
    .slice(0, 25);

  const selectedSorted = [...selectedScans].sort((a, b) => b.scanned_at.localeCompare(a.scanned_at) || b.id - a.id);
  const recent = selectedSorted.slice(0, 30).map((scan) => {
    const day = scan.scanned_at.slice(0, 10);
    const scanNumber = scans.filter((row) =>
      row.barcode === scan.barcode &&
      row.scanned_at.slice(0, 10) === day &&
      (row.scanned_at < scan.scanned_at || (row.scanned_at === scan.scanned_at && row.id <= scan.id))
    ).length;
    return {
      id: scan.id,
      barcode: scan.barcode,
      scannedAt: scan.scanned_at,
      source: scan.source,
      machineId: scan.machine_id,
      scan_number_for_day: scanNumber
    };
  });

  return {
    summary,
    daily,
    hourly,
    repeats,
    recent
  };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
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

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, storePath: STORE_PATH, port: PORT, machineId: MACHINE_ID });
});

app.get('/api/dashboard', (req, res) => {
  const range = getRangeParams(req.query);
  res.json({ range, listener: listenerState, machineId: MACHINE_ID, ...buildSummary(range) });
});

app.get('/api/listener', (_req, res) => {
  res.json(listenerState);
});

app.post('/api/listener', async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const state = await setListenerEnabled(enabled);
  res.json(state);
});

app.post('/api/scans', async (req, res) => {
  try {
    const result = await ingestScan(req.body?.barcode, req.body?.source || 'scanner', req.body?.note || null);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/simulate', async (req, res) => {
  const count = Math.min(Math.max(Number(req.body?.count || 25), 1), 500);
  const memberPool = Math.min(Math.max(Number(req.body?.memberPool || 12), 1), 250);
  const repeatBias = Math.min(Math.max(Number(req.body?.repeatBias || 0.35), 0), 0.95);

  const barcodes = Array.from({ length: memberPool }, (_, index) =>
    String(100000 + index).padStart(6, '0')
  );

  const inserted = [];
  let cursor = new Date();
  cursor.setMinutes(cursor.getMinutes() - count);

  for (let i = 0; i < count; i += 1) {
    const shouldRepeat = inserted.length > 0 && Math.random() < repeatBias;
    const barcode = shouldRepeat
      ? inserted[Math.floor(Math.random() * inserted.length)].barcode
      : barcodes[Math.floor(Math.random() * barcodes.length)];

    cursor = new Date(cursor.getTime() + (15 + Math.floor(Math.random() * 120)) * 1000);
    inserted.push(await ingestScan(barcode, 'simulator', 'Generated demo scan', cursor));
  }

  res.status(201).json({
    inserted: inserted.length,
    first: inserted[0],
    last: inserted[inserted.length - 1]
  });
});

app.post('/api/reset', async (_req, res) => {
  scans = [];
  nextScanId = 1;
  await saveStore();
  res.status(204).send();
});

app.get('/api/export.csv', (req, res) => {
  const range = getRangeParams(req.query);
  const rows = scans
    .filter((scan) => {
      const day = scan.scanned_at.slice(0, 10);
      return day >= range.start && day <= range.end;
    })
    .sort((a, b) => a.scanned_at.localeCompare(b.scanned_at) || a.id - b.id);

  const csv = [
    'id,barcode,scanned_at,source,note,machine_id',
    ...rows.map((row) =>
      [row.id, row.barcode, row.scanned_at, row.source, row.note, row.machine_id]
        .map((value) => `"${String(value || '').replace(/"/g, '""')}"`)
        .join(',')
    )
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="scanner-insights-${range.start}-to-${range.end}.csv"`);
  res.send(csv);
});

app.post('/api/import', async (req, res) => {
  const csv = req.body?.csv;
  if (typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'csv field is required' });
  }

  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return res.status(400).json({ error: 'CSV has no data rows' });
  }

  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const barcodeIdx = headers.indexOf('barcode');
  const scannedAtIdx = headers.indexOf('scanned_at');
  const sourceIdx = headers.indexOf('source');
  const noteIdx = headers.indexOf('note');
  const machineIdx = headers.indexOf('machine_id');

  if (barcodeIdx === -1 || scannedAtIdx === -1) {
    return res.status(400).json({ error: 'CSV must have barcode and scanned_at columns' });
  }

  let imported = 0;
  let skipped = 0;
  const errors = [];

  try {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < headers.length) continue;

      const barcode = normalizeBarcode(values[barcodeIdx]);
      const scannedAt = values[scannedAtIdx].trim();
      const source = sourceIdx !== -1 ? (values[sourceIdx] || 'import') : 'import';
      const note = noteIdx !== -1 ? (values[noteIdx] || null) : null;
      const machineId = machineIdx !== -1 ? (values[machineIdx] || 'imported') : 'imported';

      if (!barcode || !scannedAt) continue;

      if (!/^\d{4,32}$/.test(barcode)) {
        errors.push(`Row ${i + 1}: invalid barcode "${barcode}"`);
        continue;
      }

      if (scans.some((scan) => scan.machine_id === machineId && scan.barcode === barcode && scan.scanned_at === scannedAt)) {
        skipped++;
        continue;
      }

      scans.push({
        id: nextScanId++,
        barcode,
        scanned_at: scannedAt,
        source,
        note: note || null,
        machine_id: machineId
      });
      imported++;
    }
    await saveStore();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ imported, skipped, errors: errors.slice(0, 10) });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Scanner Insights running at http://localhost:${PORT} (machine: ${MACHINE_ID})`);
});

await setListenerEnabled(!DISABLE_LISTENER && process.platform === 'win32');
