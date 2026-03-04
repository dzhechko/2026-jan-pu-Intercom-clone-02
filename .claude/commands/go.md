---
description: "Smart pipeline selector — analyzes feature complexity and routes to /plan, /feature, or /feature-ent"
---

# /go — Smart Feature Pipeline

## Step 1: Determine Target Feature

IF $ARGUMENTS provided:
  target = $ARGUMENTS
ELSE:
  Read `.claude/feature-roadmap.json`
  Pick first feature with status "next" or "in_progress"
  IF none found: report "No features in roadmap. Use /next to add."

## Step 2: Analyze Complexity

Score the target feature using this matrix:

| Signal                              | Score  |
|--------------------------------------|--------|
| Touches <= 3 files                   | -2     |
| Touches 4-10 files                   | 0      |
| Touches > 10 files                   | +3     |
| External API / MCP integration       | +2     |
| New database entities                | +2     |
| Cross-bounded-context dependencies   | +3     |
| Hotfix or minor improvement          | -3     |
| DDD docs in project                  | +1     |
| Gherkin scenarios for feature        | +1     |
| Implementation < 30 min estimate     | -2     |
| Implementation > 2 hours estimate    | +3     |

Analysis approach:
1. Read PRD.md for feature scope
2. Read docs/bounded-contexts.md for BC dependencies
3. Grep codebase for related files
4. Check docs/test-scenarios.feature for existing Gherkin
5. Sum applicable signals

## Step 3: Select Pipeline

| Score   | Pipeline     | Condition                              |
|---------|-------------|----------------------------------------|
| <= -2   | `/plan`      | Simple task, just plan and implement   |
| -1 to 4 | `/feature`   | Standard 4-phase lifecycle             |
| >= +5   | `/feature`   | Complex feature (full lifecycle)       |

## Step 4: Execute

Display decision:
```
Feature: {target}
Complexity Score: {score} ({low/medium/high})
Selected Pipeline: {pipeline}
Reason: {1-line explanation}
```

Execute the selected pipeline with the feature name.

## Step 5: Post-Implementation

After pipeline completes:
1. Update `.claude/feature-roadmap.json` — set feature status to "done"
2. Cascade: unblock any features with `depends_on` pointing to this one
3. Commit changes
4. Report summary: files changed, tests passing, next suggested feature
