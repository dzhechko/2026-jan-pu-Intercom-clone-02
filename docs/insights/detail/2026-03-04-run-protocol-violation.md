# /run Protocol Violation — Never Bypass Skill Chain

**Date:** 2026-03-04 | **Area:** process | **Type:** critical-lesson

## What Happened
When executing `/run all` (14 features), I launched raw Agent tools in parallel waves instead of following the prescribed skill chain: `/next` → `/go` → `/plan`|`/feature`.

## Impact
- 0 out of 14 `docs/plans/` files were created during implementation
- Features were batched into wave-commits (5 commits for 14 features) instead of 1 commit per feature
- No push to GitHub until the very end
- No complexity scoring via `/go`
- No validation phase from `/feature` lifecycle

## Root Cause
The `/run` command described the process as recommendations, not hard constraints. The model optimized for speed over process compliance.

## Fix Applied
Added `MANDATORY RULES (NEVER SKIP)` section to `.claude/commands/run.md` with:
- 8 non-negotiable rules using CRITICAL/FORBIDDEN/NEVER language
- Visual flow diagram with explicit blocks
- Duplicate rules in `CLAUDE.md` under "MANDATORY Development Rules"

## Key Takeaway
**Process commands must use blocking language (MUST/FORBIDDEN/NEVER/CRITICAL), not descriptive language.** Soft phrasing like "Run /next to get..." is interpreted as optional. Hard phrasing like "MUST execute /next skill. FORBIDDEN to skip." is treated as a constraint.
