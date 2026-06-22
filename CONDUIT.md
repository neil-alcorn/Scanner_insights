<!--
# ── CONDUIT MANAGED FILE ────────────────────────────────────────────
# file:        CONDUIT.md
# description: Highway document for Scanner_insights. Repo signals and agent rules.
# owner:       BOTH
# update:      When repo signals or operating rules change.
# schema:      highways/repo-signals.schema.yaml
# last_update: 2026-06-22
# ─────────────────────────────────────────────────────────────────────
-->

# Scanner_insights

target repo for one or more conduit convoys

## Repo Signals

```yaml
operational_status: ACTIVE
system_class: MODERN
escalation_contacts:
  owner: "Neil Alcorn"
  architect: "Neil Alcorn"
  security: "Neil Alcorn"
  compliance: ""
  specialist: ""
highway_init_date: "2026-06-22"
last_context_update: "2026-06-22"
```

## What This Repo Is

Scanner Insights is the Four Seasons Legacy Center scanner analytics system. It combines a local Windows capture agent for POS machines with a Netlify-hosted dashboard/API for leadership reporting.

- **Type:** active-app
- **Tech Stack:** Node.js/Express local app, Windows startup launchers, Netlify Functions, Netlify Database, static dashboard frontend



## What Agents May Do Here

- Read all source files for context and analysis
- Implement changes within active convoy workstreams
- Run tests and build commands
- Create branches for convoy work
- Generate CONTEXT.md updates (subject to owner approval)

## What Agents Must Not Do Here

- Push to main without convoy approval
- Modify Netlify/database/deployment infrastructure without owner review

### Files/Directories Agents Must Not Touch

- .env files
- Migration files that have already run in production
- Local seed data and generated scan data under data/



## Data Relationships

Receives POS scanner data from installed Four Seasons front-desk machines and publishes aggregate reporting through the Scanner Insights Netlify app.
