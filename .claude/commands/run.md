---
description: "Autonomous build loop — bootstraps project, then implements features from roadmap one by one"
---

# /run — Autonomous Build Loop

## MANDATORY RULES (NEVER SKIP)

> **CRITICAL: These rules are NON-NEGOTIABLE. Violating any of them is a protocol failure.**

1. **MUST use /next skill** to pick every feature. NEVER pick features manually.
2. **MUST use /go skill** for every feature. NEVER implement features directly.
3. **MUST create `docs/plans/{feature-id}-{name}.md`** for every feature BEFORE writing code.
4. **MUST commit + push after EACH feature** (not after waves/batches).
5. **MUST follow the exact call chain**: `/next` → `/go` → (`/plan` | `/feature`) → commit → push → `/next done`
6. **FORBIDDEN: Launching raw agents that bypass /go pipeline.** All implementation goes through /go → /plan|/feature.
7. **FORBIDDEN: Batching multiple features into one commit.** Each feature = its own commit.
8. **FORBIDDEN: Skipping documentation phase.** Every /plan creates a plan file. Every /feature runs Plan → Validate → Implement → Review.

### Why These Rules Exist
- Plans in `docs/plans/` are the project's **institutional memory**
- Commits per feature make `git log` a **readable changelog**
- Pushing after each feature prevents **data loss**
- Using /go ensures **complexity scoring** and correct pipeline selection

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

  ┌─── 2.1 PICK FEATURE ───────────────────────────────────┐
  │  Execute /next skill to get top priority feature.       │
  │  IF no features with status "next" or "in_progress":    │
  │    IF scope == "mvp": BREAK (MVP complete)              │
  │    IF scope == "all" AND only "planned" remain:         │
  │      promote top "planned" → "next"                     │
  │    IF no features at all: BREAK                         │
  └─────────────────────────────────────────────────────────┘
          ↓
  ┌─── 2.2 EXECUTE VIA /go ────────────────────────────────┐
  │  Execute /go {feature-name}                             │
  │  /go MUST:                                              │
  │    a) Analyze complexity (scoring matrix)               │
  │    b) Select pipeline: /plan OR /feature                │
  │    c) Execute selected pipeline                         │
  │                                                         │
  │  /plan MUST create: docs/plans/{feature-id}-{name}.md   │
  │  /feature MUST run: Plan → Validate → Implement → Review│
  │                                                         │
  │  ⛔ NEVER call Agent tool to implement directly.        │
  │  ⛔ NEVER skip /go and write code manually.             │
  └─────────────────────────────────────────────────────────┘
          ↓
  ┌─── 2.3 VERIFY ─────────────────────────────────────────┐
  │  Run tests: npm test                                    │
  │  IF tests pass: continue                                │
  │  IF tests fail: attempt fix (max 2 retries)             │
  │    After 3 total failures: mark "blocked", skip         │
  └─────────────────────────────────────────────────────────┘
          ↓
  ┌─── 2.4 COMMIT + PUSH (mandatory per feature) ──────────┐
  │  git add {changed files}                                │
  │  git commit -m "feat({bc}): implement {feature-name}"   │
  │  git push origin {branch}                               │
  │                                                         │
  │  ⛔ NEVER batch multiple features in one commit.        │
  │  ⛔ NEVER skip push.                                    │
  └─────────────────────────────────────────────────────────┘
          ↓
  ┌─── 2.5 UPDATE ROADMAP ─────────────────────────────────┐
  │  Execute /next {feature-id} done                        │
  │  This updates roadmap + cascades unblocking.            │
  └─────────────────────────────────────────────────────────┘
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

Push tag: `git push origin {tag}`

## Summary Report

```
/run {scope} Complete
========================
Features implemented: N
Features skipped (blocked): M
Tests: X passing, Y failing
Fitness functions: Z/10 passing
Tag: {tag}

Plans created: docs/plans/*.md
Commits: {list of commit hashes}

Blocked features (if any):
- {feature}: {reason}
```

## Error Recovery Rules

- Each feature gets independent commits (no rollback of previous work)
- Skip feature after 3 consecutive failures
- Always push state before stopping (even on error)
- On fatal error (docker down, DB unreachable): stop loop, report status
- On context window limit approaching: commit + push current state, report what's done and what remains
