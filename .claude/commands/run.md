---
description: "Autonomous build loop — bootstraps project, then implements features from roadmap one by one"
---

# /run — Autonomous Build Loop

## Step 0: Parse Scope

```
/run         → scope = "mvp" (default)
/run mvp     → scope = "mvp" — only "next" and "in_progress" features
/run all     → scope = "all" — ALL features until every one is "done"
```

Scope from $ARGUMENTS. Default: "mvp".

## Step 1: Bootstrap (if needed)

Check if project is bootstrapped:
- `package.json` exists with dependencies
- `node_modules/` exists
- `docker-compose.yml` exists

IF NOT bootstrapped:
  Execute `/start` to bootstrap the project.

IF bootstrapped:
  Skip to Step 2.

## Step 2: Feature Loop

```
WHILE features remain in scope:
  1. Run /next to get the top priority feature
  2. IF no features with status "next" or "in_progress":
     - IF scope == "mvp": BREAK (MVP complete)
     - IF scope == "all" AND only "planned" remain: promote top "planned" → "next"
     - IF no features at all: BREAK
  3. Run /go {feature-name}
  4. Verify: run tests (npm test)
     - IF tests pass: continue to next feature
     - IF tests fail: attempt fix (max 2 retries)
       - After 3 total failures on same feature: mark as "blocked", skip, continue
  5. Commit independently: feat({bc}): implement {feature-name}
```

## Step 3: Finalize

After loop completes:

1. Run full test suite: `npm test`
2. Run fitness functions: `npm run fitness` (if available)
3. Run type check: `npx tsc --noEmit`

IF scope == "mvp":
  Tag: `git tag v0.1.0-mvp`
IF scope == "all":
  Tag: `git tag v1.0.0`

## Summary Report

```
/run {scope} Complete
========================
Features implemented: N
Features skipped (blocked): M
Tests: X passing, Y failing
Fitness functions: Z/10 passing
Tag: {tag}

Blocked features (if any):
- {feature}: {reason}
```

## Error Recovery Rules

- Each feature gets independent commits (no rollback of previous work)
- Skip feature after 3 consecutive failures
- Always push state before stopping (even on error)
- On fatal error (docker down, DB unreachable): stop loop, report status
