# Scanner Insights

Small local barcode analytics app for short-term front-desk tracking.

## Project context

For direction, resume state, and implementation notes, start with:

- `PROJECT_CONTEXT.md`
- `CHANGELOG.md`
- `docs/superpowers/plans/2026-06-14-scanner-insights-web-sync-agent.md`

## What it does

- Stores scans in SQLite
- Tracks daily unique barcodes
- Shows repeat scans and timing patterns
- Exports scan history to CSV
- Includes a simulator so you can test without a physical scanner
- Includes a keyboard-wedge test pad for fast digit bursts plus `Enter`
- Includes a Windows global keyboard listener to capture scanner-style input while another app is active

## Run it

From the scanner app folder:

```powershell
cd scanner-insights
npm run dev
```

Then open `http://localhost:4312`.

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
4. The installer verifies `node`, copies the app and its prebuilt dependencies locally, creates desktop and Startup shortcuts, and opens in the browser.

## Test without a scanner

You have three ways to test:

- `Single Scan`: send one barcode directly
- `Scanner Simulator`: generate a batch of timestamps and repeat scans
- `Scanner Test Pad`: focus the box, type digits quickly, then press `Enter`

The test pad is useful because many barcode readers act like keyboards and finish each scan with `Enter`.

## Packaging later

Once the workflow is approved, the simplest deployment path is:

1. Package the Node app into a portable Windows bundle or launcher.
2. Store the SQLite file in the app's local `data` folder.
3. Add a Windows keyboard listener so scans can be captured while ABC remains the active desktop app.
4. Place the bundle on the front-desk PC or on a USB drive with a start script.

## Expected scanner behavior later

This version is built to validate the storage and analytics flow first.

For the front-desk deployment, the target scanner behavior is:

- scanner acts as a keyboard wedge
- barcode digits are typed quickly
- scanner sends `Enter` after each scan
- ABC still receives the keystrokes normally

The next deployment step will be adding or packaging a Windows-side keyboard listener so the app can capture the same scan stream while ABC continues to operate.
