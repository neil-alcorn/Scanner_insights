# Scanner Insights

Hybrid barcode analytics app for Four Seasons Legacy Center. Windows POS machines capture scanner input locally, queue scans safely, and sync to a Netlify-hosted dashboard for combined reporting.

## Project context

For direction, resume state, and implementation notes, start with:

- `PROJECT_CONTEXT.md`
- `CHANGELOG.md`
- `docs/superpowers/plans/2026-06-14-scanner-insights-web-sync-agent.md`

## What it does

- Captures scanner-style digit bursts plus `Enter` with a Windows keyboard hook.
- Keeps scanner keystrokes passing through to ABC.
- Writes scans to a local durable queue before any network sync.
- Syncs queued scans to the Netlify ingest API about every 15 seconds while online.
- Shows combined POS reporting in the hosted dashboard.
- Exports cloud reporting data to CSV.

## Run it

From the scanner app folder:

```powershell
cd scanner-insights
npm run dev
```

Then open `http://localhost:4312`.

Run the background agent locally:

```powershell
$env:SCANNER_INSIGHTS_CLOUD_ENDPOINT="https://scanner-insights-fslc.netlify.app/.netlify/functions/ingest-scans"
npm run agent
```

## USB test bundle

Build the portable bundle:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-usb-bundle.ps1
```

Build the single-file installer executable:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-installer-exe.ps1
```

That creates:

- `dist\scanner-insights-usb\launchers\Install-Local.bat`
- `dist\ScannerInsights-Installer.exe`

Recommended test flow on another machine:

1. Copy `dist\scanner-insights-usb` to the USB drive.
2. On the target PC, open the USB folder.
3. Double-click `launchers\Install-Local.bat`.
4. The installer verifies `node`, preserves existing local scan data, copies the app and its prebuilt dependencies locally, starts the background sync agent, creates a Startup shortcut for the agent, and creates a desktop shortcut for the optional local dashboard.

The installed agent syncs to:

```text
https://scanner-insights-fslc.netlify.app/.netlify/functions/ingest-scans
```

The hosted dashboard is:

```text
https://scanner-insights-fslc.netlify.app
```

## Expected scanner behavior

For the front-desk deployment:

- scanner acts as a keyboard wedge
- barcode digits are typed quickly
- scanner sends `Enter` after each scan
- ABC still receives the keystrokes normally
