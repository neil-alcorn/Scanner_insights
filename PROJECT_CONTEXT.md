# Scanner Insights Project Context

Last updated: 2026-06-14

## Purpose

Scanner Insights tracks front-desk barcode scans at Four Seasons Legacy Center so staff can report traffic, repeat scans, hourly load, and machine activity without manually collecting files from each POS machine.

The original installed app is a local Node/Express dashboard with a Windows keyboard hook. It captures scanner-style digit bursts ending in `Enter` while ABC remains the active desktop app, then stores scans locally.

## Current Direction

Move from isolated local reporting to a hybrid web system:

1. Keep local Windows capture on each POS machine.
2. Run capture as a startup background agent so the browser/local dashboard does not need to stay open.
3. Store each scan immediately in a local durable queue.
4. Sync queued scans to a Netlify-hosted API when internet is available.
5. Store cloud scans in a shared database with duplicate protection.
6. Analyze combined data in a Netlify-hosted browser dashboard.

This is intentionally not browser-only because a normal browser cannot globally capture scanner input while ABC has focus.

The hosted web app should be dashboard and export focused. It should not present local utility controls such as manual scan entry, scanner simulation, listener toggles, reset buttons, or CSV import in the normal web experience. CSV import remains seed/admin tooling, not the primary workflow.

## Known POS Seed Data

Melissa Alcorn sent two Gmail messages with same-named CSV attachments. The filenames overlap, but the machine data differs.

- POS 1: `FS1-BLM-WK04`, long export has 531 rows.
- POS 2: `FS1-BLM-WK02`, long export has 570 rows.
- Files in `C:\Users\nalco\Downloads` were POS 2 duplicates/subsets only.
- Use the long `2026-05-29-to-2026-06-11` export from each POS as seed history.
- Do not commit actual seed CSVs. Local seed CSVs belong in `data/seed/` and are ignored by Git.

## Repository Locations

- Main repo clone: `C:\Users\nalco\GitRepos\Scanner_insights`
- Active feature worktree: `C:\Users\nalco\GitRepos\Scanner_insights\.worktrees\web-sync-agent`
- Current implementation branch: `feature/web-sync-agent`
- Original Codex source copy: `C:\Users\nalco\.codex\scanner-insights`
- Implementation plan: `docs/superpowers/plans/2026-06-14-scanner-insights-web-sync-agent.md`

## Current Implementation Status

Completed on `feature/web-sync-agent`:

- Clean baseline imported into Git.
- Shared scan domain module: validation, CSV parsing, duplicate keys, summaries.
- Local durable queue and migration from existing `data/scanner-insights.json`.
- Netlify Function contracts for dashboard, CSV import, and agent ingest.
- Cloud SQL schema for `machines` and `scans`.
- Web dashboard machine filter and machine table.
- Dashboard-only hosted UI: local listener/manual scan/simulator/import panels removed from the Netlify-facing page.
- Polished dashboard UX with KPI cards, insight tiles, chart panels, machine status, and export controls.
- Cloud CSV export endpoint for date and machine filtered reporting.
- Startup background agent skeleton.
- Keyboard listener wrapper for `ScannerKeyHook.exe`.
- Sync client with retryable failure behavior.
- Seed validation and seed import scripts.

Verification passed:

- `npm test`: 14 tests passing.
- `npm run check`: passing.

## Next Work

Highest priority next steps:

1. Save POS 1 and POS 2 long CSV exports into `data/seed/` locally.
2. Run `node scripts/validate-seed-csv.mjs <pos1.csv> <pos2.csv>`.
3. Configure the Netlify site and database.
4. Apply `src/cloud/schema.sql` to the hosted database.
5. Import seed CSVs through the cloud import endpoint.
6. Update installer/startup scripts so the agent runs independently at Windows startup.
7. Verify the installed agent captures scans, queues while offline, and syncs when online.
8. Expand analysis/export features once cloud data is flowing, such as repeat patterns, machine comparison, day/hour exports, and date-filtered CSV downloads.

## Invariants

- Preserve ABC behavior: scanner keystrokes must still pass through to ABC.
- Capture must not depend on the browser dashboard being open.
- Local scans must be written before sync is attempted.
- Cloud ingest must dedupe by `machine_id + barcode + scanned_at`.
- Current installed data must be migrated or imported; do not discard it.
- Generated folders and local data stay out of Git.

## Useful Commands

```powershell
cd C:\Users\nalco\GitRepos\Scanner_insights\.worktrees\web-sync-agent
npm test
npm run check
node scripts/validate-seed-csv.mjs data\seed\pos1-FS1-BLM-WK04-2026-05-29-to-2026-06-11.csv data\seed\pos2-FS1-BLM-WK02-2026-05-29-to-2026-06-11.csv
```

## Open Decisions

- Confirm final hosted database provider. Current implementation expects `@netlify/neon`.
- Confirm Netlify site name and deployment flow.
- Decide whether the Windows startup agent should use a Startup shortcut or scheduled task.
- Decide how machine labels should display in the dashboard, for example `POS 1` and `POS 2` instead of raw machine IDs.
