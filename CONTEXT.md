<!--
# -- CONDUIT MANAGED FILE --------------------------------------------
# file:        CONTEXT.md
# description: Living architecture summary for Scanner_insights.
# owner:       BOTH
# update:      When architecture, deployment, data flow, or operating rules change.
# schema:      none
# last_update: 2026-06-22
# --------------------------------------------------------------------
-->

# CONTEXT: Scanner_insights

## TL;DR

- Scanner Insights captures Four Seasons front-desk barcode scans locally and syncs them to a Netlify-hosted dashboard.
- The browser dashboard is not responsible for capture; Windows POS machines use a local startup agent because ABC owns foreground scanner input.
- Canonical source lives in `C:\Users\nalco\GitRepos\Scanner_insights` and deploys to `https://scanner-insights-fslc.netlify.app`.
- Local seed data, generated scan data, and installer artifacts must not be confused with source.

## System Purpose

Scanner Insights gives Four Seasons Legacy Center leadership visibility into POS barcode scan volume, repeat patterns, hourly load, and machine activity without physically accessing each front-desk machine.

## Architecture

- `server.mjs`: local Express app for installed/local dashboard support.
- `src/local/agent.mjs`: background scanner sync agent intended to run at Windows startup.
- `src/local/listener.mjs`: wrapper around the Windows scanner keyboard hook.
- `src/local/sync-client.mjs`: uploads pending local scans to the cloud ingest endpoint.
- `src/shared/scans.mjs`: shared validation, parsing, duplicate-key, and summary logic.
- `src/shared/local-store.mjs`: durable local queue/store handling.
- `netlify/functions/*.mjs`: hosted dashboard, ingest, import, and export APIs.
- `netlify/database/migrations/*`: Netlify Database schema for machines and scans.
- `public/`: hosted dashboard UI.
- `usb-launchers/` and `scripts/build-usb-bundle.ps1`: Windows install/startup packaging.

## Data Flow

1. Scanner input is received by the local Windows capture path while ABC remains usable.
2. The local agent writes scans to durable local storage before attempting sync.
3. When internet is available, pending rows upload to `/.netlify/functions/ingest-scans`.
4. Cloud storage deduplicates by machine, barcode, and timestamp.
5. Leadership views combined machine data through the Netlify dashboard and CSV exports.

## Deployment

- Production site: `https://scanner-insights-fslc.netlify.app`
- Guarded deploy command: `npm run deploy:netlify`
- Verify-only command: `npm run verify:netlify`
- The deploy script refuses implicit/mismatched Netlify targets and checks the live page title.

## Verification Baseline

- `npm test`
- `npm run check`
- `npm run verify:netlify`

As of 2026-06-22, all three pass from the canonical repo.

## Operating Rules

- Preserve ABC behavior; scanner keystrokes must continue to reach ABC.
- Capture must not depend on the browser dashboard being open.
- Local scans must be written before sync is attempted.
- Do not commit real seed CSVs or generated scan data.
- Do not mix WHH/Four Seasons deployment scripts across repos.

## Current Operational Gap

The web app is live and the updated install package exists, but the updated local startup-agent build still needs to be installed on both Four Seasons POS machines and verified end to end.
