---
name: feature-navigator
description: >
  Navigate and manage the feature roadmap. Shows sprint progress, suggests next features,
  updates statuses, and cascades dependency unblocking. Reads from .claude/feature-roadmap.json.
  Triggers: "next feature", "what to work on", "sprint progress", "roadmap status".
version: "1.0"
maturity: production
---

# Feature Navigator

Navigate the feature roadmap and suggest what to work on next.

## Input

- `.claude/feature-roadmap.json` — feature statuses, priorities, dependencies
- `git log` — recent commits to detect implemented features
- `src/` — codebase scan for TODO/FIXME markers

## Process

### 1. Load Roadmap

Read `.claude/feature-roadmap.json`. Parse features by status.

### 2. Calculate Sprint Progress

Count features by status: done, in_progress, next, planned, blocked.
Show progress bar and percentages.

### 3. Detect Unblocked Features

For each "planned" feature:
- Check if ALL `depends_on` features are "done"
- If yes: auto-promote to "next"
- Save updated roadmap

### 4. Suggest Top 3 Actions

Priority rules (in order):
1. Finish `in_progress` features first
2. Pick `next` features (highest priority: must > should > could)
3. Within same priority: respect milestone order (M1 > M2 > M3)
4. Never suggest features with unresolved `depends_on`

For each suggestion:
```
[{id}] {name} ({bc}) — /go {name}
```

### 5. Update Roadmap on Completion

When marking a feature "done":
1. Set status to "done"
2. Find all features where `depends_on` includes this feature
3. For each: if ALL other dependencies are also "done", promote to "next"
4. Save roadmap
5. Report cascaded changes

## Output

Sprint progress summary + top 3 actionable suggestions.

## Quality Gate

- Feature statuses are valid: done, in_progress, next, planned, blocked
- No circular dependencies in `depends_on`
- At least 1 suggestion always provided (unless all done)
- Roadmap JSON is valid after every update
