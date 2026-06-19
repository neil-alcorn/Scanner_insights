# Changelog

## 2026-06-19

### Added

- Updated the Windows install path so the background scanner agent can run at Windows Startup independently of the browser dashboard.
- Added hidden agent launchers, preserved local data during reinstall, and wrote installed agent config for the live Netlify ingest endpoint.
- Updated the USB bundle builder to include `src`, Netlify function contracts, and the new agent launchers.

### Verified

- `npm test` passes with 14 tests.
- `npm run check` passes.
- PowerShell parser checks pass for the installer, launchers, and USB bundle script.
- Rebuilt the updated package locally at `dist\scanner-insights-usb`.

### Blocked

- Could not write the rebuilt package to `D:\scanner-insights-usb` because Windows reports the USB media is write protected.

## 2026-06-14

### Added

- Created GitHub repo clone at `C:\Users\nalco\GitRepos\Scanner_insights`.
- Imported the clean local Scanner Insights baseline into Git.
- Created feature branch/worktree `feature/web-sync-agent`.
- Added shared scan logic for validation, CSV parsing, duplicate keys, date range handling, and dashboard summaries.
- Added local durable queue storage and migration from the current local `scanner-insights.json`.
- Added Netlify Function contracts for scan ingest, CSV import, and dashboard reporting.
- Added cloud schema for `machines` and `scans` with duplicate protection.
- Added web dashboard machine filter and machine status table.
- Changed the hosted web direction to dashboard/export only and removed local utility panels from the public web UI.
- Polished the hosted UI into an operational analytics dashboard with KPI cards, insight tiles, denser chart panels, and clearer export/filter controls.
- Added cloud CSV export function and Netlify redirect for `/api/export.csv`.
- Added startup background agent skeleton, listener wrapper, and sync client.
- Added POS seed validation and cloud seed import scripts.
- Added tests for scan parsing, local queue migration, CSV dedupe, and sync client behavior.

### Verified

- `npm test` passes with 14 tests.
- `npm run check` passes.
- Verified the worktree dashboard on port `4313` no longer serves Single Scan, Import CSV, or Live Listener panels while retaining Daily Trend, Machines, and Export CSV.
- Confirmed Gmail has two distinct Melissa Alcorn POS export emails:
  - POS 1: `FS1-BLM-WK04`, 531 long-export rows.
  - POS 2: `FS1-BLM-WK02`, 570 long-export rows.
- Confirmed Downloads folder exports are POS 2 duplicates/subsets only.

### Pending

- Save Gmail seed CSVs locally under `data/seed/`.
- Configure Netlify and hosted database.
- Apply database schema.
- Import POS seed data.
- Update Windows installer/startup scripts for the independent background agent.
- End-to-end test capture, offline queueing, sync, and web reporting.

## 2026-06-15

### Fixed

- Created and deployed the dedicated Netlify site `scanner-insights-fslc`.
- Fixed live dashboard loading by replacing legacy `@netlify/neon` usage with current `@netlify/database`.
- Added a Netlify Database migration for the Scanner Insights `machines` and `scans` schema.
- Added `build:netlify` so Netlify has an explicit build command.

### Verified

- Live site returns `200`: `https://scanner-insights-fslc.netlify.app`.
- Live dashboard API returns `200` for `/api/dashboard?days=14`.
- Imported POS seed history into the live Scanner database:
  - `FS1-BLM-WK04`: 531 rows.
  - `FS1-BLM-WK02`: 570 rows.
  - Combined total: 1,101 rows.
- Re-importing both seed files returns clean JSON with `inserted: 0` and all rows skipped as duplicates.

### Guardrail

- Added `npm run deploy:netlify` to deploy with the explicit Scanner Insights Netlify site ID and verify the production page title after deployment.
