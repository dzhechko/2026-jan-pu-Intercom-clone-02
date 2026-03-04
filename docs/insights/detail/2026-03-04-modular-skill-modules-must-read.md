# Insight: Modular skills require reading ALL module files, not just SKILL.md

**Date:** 2026-03-04 | **Area:** tooling | **Category:** pattern

## Context
During Phase 3 (cc-toolkit-generator-enhanced), only SKILL.md was read as the main orchestrator. The skill has 9 modules in `modules/` subdirectory that contain the actual generation logic.

## Insight
When a skill has a `modules/` directory, SKILL.md is just the orchestrator — it delegates phases to numbered module files (01-detect-parse.md, 02-analyze-map.md, etc.). Skipping module files means missing entire artifact categories. In this case, `modules/04-generate-p1.md` Steps 7-8 defined Feature Suggestions and Automation Commands — both marked "Always generated for P1" — but were completely skipped because the module file wasn't read.

## Impact
**CRITICAL:** Always read ALL module files for modular skills before generating artifacts. The Master Validation Checklist in SKILL.md can serve as a cross-check, but the actual generation specs live in the modules. Missing these caused 10+ artifacts to be omitted: /go, /run, /docs, /next commands, feature-roadmap.json, feature-context.py hook, feature-navigator skill, testing-patterns skill, SessionStart hook, and CLAUDE.md/DEVELOPMENT_GUIDE.md sections.
