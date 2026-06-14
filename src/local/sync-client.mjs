export async function syncPendingScans({ endpoint, scans, fetchImpl = fetch }) {
  if (!endpoint) {
    throw new Error('SCANNER_INSIGHTS_CLOUD_ENDPOINT is required for sync.');
  }
  if (!scans.length) {
    return { syncedLocalIds: [], inserted: 0, skipped: 0, errors: [] };
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scans, importedFrom: 'agent' })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || (payload.errors || []).join('; ') || `Sync failed with HTTP ${response.status}`);
  }

  return {
    syncedLocalIds: payload.syncedLocalIds || [],
    inserted: payload.inserted || 0,
    skipped: payload.skipped || 0,
    errors: payload.errors || []
  };
}
