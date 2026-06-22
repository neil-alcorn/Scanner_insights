# QA & Acceptance: Scanner_insights

## Smoke Checks

| ID | Check | Command / Evidence | Owner |
|---|---|---|---|
| AC-001 | Unit/domain tests pass | `npm test` | engineering |
| AC-002 | Syntax checks pass | `npm run check` | engineering |
| AC-003 | Netlify production serves Scanner Insights | `npm run verify:netlify` | engineering |
| AC-004 | Local install package includes startup agent launchers | `dist\scanner-insights-usb\launchers\Start-Agent.*` after bundle build | engineering |
| AC-005 | POS machine captures scans while ABC remains usable | On-machine UAT | operations |
| AC-006 | Offline scans queue and later sync | On-machine UAT with network interruption | operations |

## Acceptance Notes

- The hosted dashboard should focus on reporting/export. Local listener controls, simulator, manual scan entry, and CSV import are not part of the normal public web experience.
- CSV import is seed/admin tooling only.
- Production deploys should use `npm run deploy:netlify`, not an implicit Netlify deploy from an arbitrary folder.
