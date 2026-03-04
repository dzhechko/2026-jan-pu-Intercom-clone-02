---
description: "Generate bilingual (RU/EN) project documentation from codebase and SPARC docs"
---

# /docs — Documentation Generator

## Step 1: Gather Context

Read these sources:
- `docs/PRD.md` — requirements and features
- `docs/C4-diagrams.md` — architecture
- `docs/ADR.md` — decisions
- `docs/bounded-contexts.md` — domain model
- `docs/tactical-design.md` — DB schema
- `docs/pseudocode.md` — algorithms
- `CLAUDE.md` — project overview
- `docs/insights/` — development insights
- Source code in `src/` — actual implementation

## Step 2: Determine Scope

```
/docs           → both languages (RU + EN), create mode
/docs rus       → Russian only
/docs eng       → English only
/docs update    → update existing docs (preserve structure, refresh content)
```

Parse $ARGUMENTS for language and mode.

## Step 3: Generate Documentation

For each language, create these files in `README/` directory:

| # | File | Content |
|---|------|---------|
| 1 | `deployment.md` | Docker Compose setup, VPS deploy, env vars, health checks |
| 2 | `admin-guide.md` | Tenant setup, operator management, PQL rule config |
| 3 | `user-guide.md` | Operator workspace, chat widget, PQL workflow |
| 4 | `infrastructure.md` | PostgreSQL, Redis, Nginx, monitoring, backups |
| 5 | `architecture.md` | C4 diagrams, bounded contexts, event flow, MCP |
| 6 | `ui-guide.md` | Widget customization, workspace layout, keyboard shortcuts |
| 7 | `user-flows.md` | Key user journeys with step-by-step walkthroughs |

Directory structure:
```
README/
├── ru/
│   ├── deployment.md
│   ├── admin-guide.md
│   ├── user-guide.md
│   ├── infrastructure.md
│   ├── architecture.md
│   ├── ui-guide.md
│   └── user-flows.md
├── en/
│   └── ... (same structure)
└── index.md          # Bilingual table of contents
```

## Step 4: Generate Index

Create `README/index.md` with bilingual table of contents linking to all docs.

## Step 5: Commit and Report

```bash
git add README/
git commit -m "docs: generate bilingual documentation (RU/EN)"
```

Report:
```
/docs Complete
==============
Language: {rus/eng/both}
Mode: {create/update}
Files generated: N
Directory: README/
```
