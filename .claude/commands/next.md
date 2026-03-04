---
description: "Show sprint progress and suggest next features from the roadmap"
---

# /next — Feature Navigator

## Default: Sprint Progress + Next Tasks

Read `.claude/feature-roadmap.json`.

### Display Sprint Progress

```
Sprint Progress
===============
Done:        N features
In Progress: M features
Next:        K features
Blocked:     B features
Planned:     P features
```

### Show In-Progress Features
List all features with status "in_progress" with their BC and dependencies.

### Suggest Top 3 Next Actions

Priority rules:
1. `in_progress` features first (finish what's started)
2. `next` features second (pick new work)
3. `planned` features with all `depends_on` resolved → auto-promote to "next"
4. Respect `depends_on` — never suggest blocked features

For each suggestion, show:
- Feature ID and name
- Bounded context(s)
- Suggested command: `/go {feature-name}`

## Subcommands

### /next update
Scan codebase (git log, src/, tests/) to detect implemented features.
Suggest status updates for features that appear done but aren't marked.

### /next {feature-id}
Mark feature as "done".
Cascade: unblock features that depend on this one.
Auto-promote newly unblocked features from "planned" to "next".
Save updated roadmap to `.claude/feature-roadmap.json`.
Show next suggested feature.
