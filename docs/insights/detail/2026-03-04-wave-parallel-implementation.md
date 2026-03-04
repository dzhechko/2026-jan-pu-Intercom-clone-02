# Wave-Based Parallel Feature Implementation

**Date:** 2026-03-04 | **Area:** architecture | **Type:** pattern

## Pattern
When implementing many features with dependency chains, group them into "waves" based on the dependency DAG:

```
Wave 1 (no deps):     IAM-01 + FR-04          — parallel
Wave 2 (depends W1):  FR-07                    — sequential
Wave 3 (depends W2):  FR-02 + FR-03 + FR-05   — parallel
Wave 4 (depends W2):  FR-11 + FR-09 + FR-13 + FR-14 — parallel
Wave 5 (depends W3):  FR-06 + FR-08 + FR-10 + FR-12 — parallel
```

## Results
- 14 features implemented across 5 waves
- Max parallelism: 4 agents simultaneously (Wave 4)
- Total time: ~30 min wall-clock for all 14 features
- 234 tests, 0 failures

## Caveat
This pattern is for SPEED only. It bypasses the documentation lifecycle (`/go` → `/plan`|`/feature`). Use it only when documentation is not required, or generate docs retroactively.

For proper documentation flow, features must go through the skill chain sequentially: `/next` → `/go` → `/plan`|`/feature` → commit → push.

## When to Use
- Hackathons / rapid prototyping
- When explicitly told "speed over process"
- NEVER as default — always prefer the documented skill chain
