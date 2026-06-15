const statsRoot = document.getElementById('stats');
const listenerMeta = document.getElementById('listener-meta');
const listenerToggle = document.getElementById('listener-toggle');
const listenerStatus = document.getElementById('listener-status');
const dailyChart = document.getElementById('daily-chart');
const hourlyChart = document.getElementById('hourly-chart');
const repeatsTable = document.getElementById('repeats-table');
const recentTable = document.getElementById('recent-table');
const daysSelect = document.getElementById('days-select');
const machineSelect = document.getElementById('machine-select');
const machinesTable = document.getElementById('machines-table');
const startDateInput = document.getElementById('start-date');
const endDateInput = document.getElementById('end-date');
const applyCustomRangeButton = document.getElementById('apply-custom-range');
const clearCustomRangeButton = document.getElementById('clear-custom-range');
const exportLink = document.getElementById('export-link');
const scanForm = document.getElementById('scan-form');
const barcodeInput = document.getElementById('barcode-input');
const scanStatus = document.getElementById('scan-status');
const wedgeInput = document.getElementById('wedge-input');
const wedgeStatus = document.getElementById('wedge-status');
const simulateForm = document.getElementById('simulate-form');
const simulateStatus = document.getElementById('simulate-status');
const refreshButton = document.getElementById('refresh-button');
const resetButton = document.getElementById('reset-button');
const importFile = document.getElementById('import-file');
const importButton = document.getElementById('import-button');
const importStatus = document.getElementById('import-status');
const machineBadge = document.getElementById('machine-badge');
const AUTO_REFRESH_MS = 2000;
let wedgeBuffer = '';
let wedgeTimes = [];
let refreshInFlight = false;
let activeRange = {
  mode: 'quick',
  days: daysSelect.value,
  start: '',
  end: ''
};

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function setStatus(element, text, isError = false) {
  if (!element) return;
  element.textContent = text;
  element.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function renderStats(summary) {
  const cards = [
    ['Unique In Range', summary.unique_range],
    ['Total In Range', summary.total_range],
    ['Repeats In Range', summary.repeats_range],
    ['Unique Today', summary.unique_today],
    ['Total Today', summary.total_today],
    ['All-Time Scans', summary.total_all_time]
  ];

  statsRoot.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="stat-card">
          <span class="label">${label}</span>
          <strong class="value">${formatNumber(value)}</strong>
        </article>
      `
    )
    .join('');
}

function renderListener(listener) {
  if (!listenerMeta || !listenerToggle) return;
  const status = listener?.status || 'unknown';
  const lastSeen = listener?.lastCapturedAt || 'No live captures yet';
  const lastBarcode = listener?.lastBarcode || 'None yet';
  const detail = listener?.error || `Last barcode: ${lastBarcode}`;

  listenerMeta.innerHTML = `
    <div class="listener-pill">Status: ${status}</div>
    <div>Last capture: ${lastSeen}</div>
    <div>${detail}</div>
  `;

  if (!listener?.supported) {
    listenerToggle.disabled = true;
    listenerToggle.textContent = 'Listener Unavailable';
    setStatus(listenerStatus, 'Global listening is only enabled on Windows.');
    return;
  }

  listenerToggle.disabled = false;
  listenerToggle.textContent = listener?.active ? 'Pause Listener' : 'Resume Listener';
  setStatus(
    listenerStatus,
    listener?.active
      ? 'Global keyboard listener is active. Scanner-style bursts ending in Enter will be logged.'
      : 'Global listener is paused. Use Resume when you want to test piggyback capture.'
  );
}

function renderDualBars(root, rows, valueKeys, labelFormatter) {
  if (!rows.length) {
    root.innerHTML = '<p class="empty">No scan data yet.</p>';
    return;
  }

  const max = Math.max(...rows.flatMap((row) => valueKeys.map((key) => row[key] || 0)), 1);
  root.innerHTML = rows
    .map((row) => {
      const bars = valueKeys
        .map((key) => {
          const height = Math.max(((row[key] || 0) / max) * 100, row[key] ? 8 : 0);
          const cssClass = key === 'unique_scans' || key === 'unique_visits' ? 'bar-unique' : 'bar-total';
          return `<div class="bar ${cssClass}" style="height:${height}%"></div>`;
        })
        .join('');

      return `
        <div class="bar-group">
          <div class="bar-stack">${bars}</div>
          <div class="bar-label">${labelFormatter(row)}</div>
        </div>
      `;
    })
    .join('');
}

function renderTable(root, rows, columns, emptyText) {
  if (!rows.length) {
    root.innerHTML = `<tr><td colspan="${columns.length}" class="empty">${emptyText}</td></tr>`;
    return;
  }

  root.innerHTML = rows
    .map(
      (row) => `
        <tr>
          ${columns.map((column) => `<td>${column(row)}</td>`).join('')}
        </tr>
      `
    )
    .join('');
}

async function fetchDashboard() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const params = new URLSearchParams();
  try {
    if (activeRange.mode === 'custom' && activeRange.start && activeRange.end) {
      params.set('start', activeRange.start);
      params.set('end', activeRange.end);
    } else {
      params.set('days', activeRange.days || daysSelect.value);
    }
    if (machineSelect?.value) {
      params.set('machine', machineSelect.value);
    }

    exportLink.href = `/api/export.csv?${params.toString()}`;

    const response = await fetch(`/api/dashboard?${params.toString()}`, { cache: 'no-store' });
    const payload = await response.json();
    activeRange = {
      mode: payload.range.mode,
      days: String(payload.range.days),
      start: payload.range.start,
      end: payload.range.end
    };
    daysSelect.value = activeRange.days;
    startDateInput.value = activeRange.mode === 'custom' ? activeRange.start : '';
    endDateInput.value = activeRange.mode === 'custom' ? activeRange.end : '';

    if (payload.machineId && machineBadge) {
      machineBadge.textContent = `Machine: ${payload.machineId} | Updated ${new Date().toLocaleTimeString()}`;
    }

    if (machineSelect && Array.isArray(payload.availableMachines)) {
      const current = machineSelect.value;
      machineSelect.innerHTML = '<option value="">All machines</option>' + payload.availableMachines
        .map((machine) => `<option value="${machine.machine_id}">${machine.label || machine.machine_id}</option>`)
        .join('');
      machineSelect.value = current;
    }

    renderStats(payload.summary);
    renderListener(payload.listener);
    renderDualBars(dailyChart, payload.daily, ['total_scans', 'unique_scans'], (row) => row.day.slice(5));
    renderDualBars(hourlyChart, payload.hourly, ['total_scans'], (row) => `${row.hour}:00`);
    if (machinesTable) {
      const lastSeen = new Map((payload.availableMachines || []).map((machine) => [machine.machine_id, machine.last_seen_at || '']));
      renderTable(
        machinesTable,
        payload.machines || [],
        [
          (row) => row.machine_id,
          (row) => formatNumber(row.total_scans),
          (row) => formatNumber(row.unique_scans),
          (row) => lastSeen.get(row.machine_id) || ''
        ],
        'No machine data in this range.'
      );
    }
    renderTable(
      repeatsTable,
      payload.repeats,
      [
        (row) => row.day,
        (row) => row.barcode,
        (row) => formatNumber(row.scans_that_day),
        (row) => row.first_seen.slice(11),
        (row) => row.last_seen.slice(11)
      ],
      'No repeat scans in this range.'
    );
    renderTable(
      recentTable,
      payload.recent,
      [
        (row) => row.scannedAt,
        (row) => row.barcode,
        (row) => row.source,
        (row) => row.machineId || '',
        (row) => formatNumber(row.scan_number_for_day)
      ],
      'No recent scans yet.'
    );
  } finally {
    refreshInFlight = false;
  }
}

scanForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(scanStatus, 'Logging scan...');

  const barcode = barcodeInput.value.trim();
  const response = await fetch('/api/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode, source: 'manual-test' })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    setStatus(scanStatus, payload.error || 'Unable to log scan.', true);
    return;
  }

  barcodeInput.value = '';
  setStatus(scanStatus, `Logged ${payload.barcode} at ${payload.scannedAt}.`);
  await fetchDashboard();
});

async function submitWedgeScan(barcode, source = 'wedge-test') {
  const response = await fetch('/api/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode, source })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Unable to log scanner burst.');
  }

  return payload;
}

wedgeInput?.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    const barcode = wedgeBuffer.trim() || wedgeInput.value.trim();
    const isBurst = wedgeTimes.length > 1 && wedgeTimes.every((gap) => gap <= 120);

    wedgeBuffer = '';
    wedgeTimes = [];
    wedgeInput.value = '';

    if (!barcode) {
      setStatus(wedgeStatus, 'No digits captured from the test pad.', true);
      return;
    }

    try {
      const payload = await submitWedgeScan(barcode, isBurst ? 'wedge-test' : 'keyboard-test');
      setStatus(
        wedgeStatus,
        `${payload.barcode} logged at ${payload.scannedAt} from ${isBurst ? 'scanner-like burst' : 'manual typing'}.`
      );
      await fetchDashboard();
    } catch (error) {
      setStatus(wedgeStatus, error.message, true);
    }

    return;
  }

  if (/^\d$/.test(event.key)) {
    if (wedgeBuffer.length > 0) {
      wedgeTimes.push(performance.now() - Number(wedgeInput.dataset.lastKeyTime || 0));
    }
    wedgeInput.dataset.lastKeyTime = String(performance.now());
    wedgeBuffer += event.key;
    return;
  }

  if (event.key === 'Backspace') {
    wedgeBuffer = wedgeBuffer.slice(0, -1);
    return;
  }

  if (event.key.length === 1) {
    wedgeBuffer = '';
    wedgeTimes = [];
  }
});

simulateForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(simulateStatus, 'Generating demo traffic...');

  const response = await fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      count: document.getElementById('simulate-count').value,
      memberPool: document.getElementById('simulate-members').value,
      repeatBias: document.getElementById('simulate-repeat').value
    })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    setStatus(simulateStatus, payload.error || 'Unable to create demo traffic.', true);
    return;
  }

  setStatus(simulateStatus, `Inserted ${payload.inserted} simulated scans.`);
  await fetchDashboard();
});

refreshButton.addEventListener('click', fetchDashboard);
machineSelect?.addEventListener('change', fetchDashboard);
daysSelect.addEventListener('change', () => {
  activeRange = {
    mode: 'quick',
    days: daysSelect.value,
    start: '',
    end: ''
  };
  fetchDashboard();
});
applyCustomRangeButton.addEventListener('click', () => {
  const start = startDateInput.value;
  const end = endDateInput.value;

  if (!start || !end || start > end) {
    setStatus(listenerStatus, 'Choose a valid start and end date.', true);
    return;
  }

  activeRange = {
    mode: 'custom',
    days: daysSelect.value,
    start,
    end
  };
  fetchDashboard();
});
clearCustomRangeButton.addEventListener('click', () => {
  startDateInput.value = '';
  endDateInput.value = '';
  activeRange = {
    mode: 'quick',
    days: daysSelect.value,
    start: '',
    end: ''
  };
  fetchDashboard();
});
listenerToggle?.addEventListener('click', async () => {
  const shouldEnable = listenerToggle.textContent !== 'Pause Listener';
  const response = await fetch('/api/listener', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: shouldEnable })
  });
  const payload = await response.json();
  renderListener(payload);
});

resetButton?.addEventListener('click', async () => {
  const confirmed = window.confirm('Delete all captured scan data?');
  if (!confirmed) return;

  await fetch('/api/reset', { method: 'POST' });
  setStatus(simulateStatus, 'All scan data cleared.');
  await fetchDashboard();
});

importButton?.addEventListener('click', async () => {
  const file = importFile.files[0];
  if (!file) {
    setStatus(importStatus, 'Select a CSV file first.', true);
    return;
  }

  setStatus(importStatus, 'Importing...');
  const csv = await file.text();
  const response = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    setStatus(importStatus, payload.error || 'Import failed.', true);
    return;
  }

  importFile.value = '';
  const msg = `Imported ${payload.imported} scan${payload.imported !== 1 ? 's' : ''}${payload.skipped ? `, ${payload.skipped} already present` : ''}.`;
  setStatus(importStatus, msg);
  await fetchDashboard();
});

fetchDashboard().catch((error) => {
  console.error(error);
  setStatus(simulateStatus, 'Unable to load dashboard.', true);
});

setInterval(() => {
  fetchDashboard().catch((error) => {
    console.error(error);
  });
}, AUTO_REFRESH_MS);
