# Insight: Use Master Validation Checklist as post-generation audit

**Date:** 2026-03-04 | **Area:** tooling | **Category:** pattern

## Context
After generating Phase 3 toolkit, user noticed /run command was missing. The cc-toolkit-generator-enhanced SKILL.md contains a Master Validation Checklist (lines 339-389) with explicit checkboxes for every artifact.

## Insight
The Master Validation Checklist in SKILL.md serves as a definitive audit tool. After generation, walk through EVERY checkbox:
- P0 Mandatory (12 items)
- P0 Conditional (3 items)
- P1 Enterprise (IF DDD) (5 items)
- P1 Feature Suggestions (3 items)
- P1 Automation (3 items)
- Pipeline-Specific (6 items)

Any unchecked item = missed artifact. This checklist should be run as Phase 6 (Package & Deliver) per the module pipeline.

## Impact
Always run the Master Validation Checklist after toolkit generation. Consider automating it as a script that checks file existence for each artifact.
