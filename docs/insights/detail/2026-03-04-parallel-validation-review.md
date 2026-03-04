# Insight: Parallel Validation + Review Agents — Efficient Feature Audit
**Date:** 2026-03-04 | **Area:** tooling | **Category:** pattern

## Context
Needed to create validation-report.md and review-report.md for 6 features. Running sequentially would take ~30 minutes.

## Insight
Running validation agents in parallel (3 at a time) + review agents in parallel (3 at a time) completed all 8 agent tasks in ~5 minutes wall-clock time instead of ~30 minutes sequential.

**Pattern:**
1. Launch validation agents for features WITHOUT validation (parallel batch 1)
2. Launch review agents for features WITH validation but WITHOUT review (parallel batch 2, concurrent with batch 1)
3. Wait for batch 1 to complete → launch review agents for newly validated features (batch 3)
4. Wait for all → commit everything

**Key: agents must work on non-overlapping files.** Each agent reads its own feature's SPARC docs + implementation files. No conflicts.

## Impact
- 6x speedup for batch documentation work
- Can audit entire project (15 features) in ~15 minutes with 3 waves of 5 parallel agents
- Template the review-report format by pointing agents to an existing exemplar (FR-01's review-report)
