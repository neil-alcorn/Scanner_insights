# Agent Notes

Start by reading `PROJECT_CONTEXT.md`, then `CHANGELOG.md`, then the implementation plan at:

`docs/superpowers/plans/2026-06-14-scanner-insights-web-sync-agent.md`

The active implementation branch is `feature/web-sync-agent` in:

`C:\Users\nalco\GitRepos\Scanner_insights\.worktrees\web-sync-agent`

Preserve these rules:

- Do not commit local scan data or POS seed CSV files.
- Do not break the current installed listener behavior while migrating.
- Keep scanner keystrokes passing through to ABC.
- Keep capture independent from the browser dashboard.
- Run `npm test` and `npm run check` before claiming implementation work is complete.
