# AI Template Lossy Compression — Anti-Pattern

**Date:** 2026-03-04 | **Area:** tooling | **Type:** CRITICAL anti-pattern

## Problem

When a toolkit generator module says "Generate file X from template Y", the AI:
1. Reads the full template (e.g., 211 lines)
2. "Understands" the template's intent
3. Generates a **compressed version** (e.g., 60 lines) that captures the gist but loses critical details

This happened with `/feature` command — the template in `cc-toolkit-generator-enhanced` defined a full 4-phase lifecycle with `docs/features/<name>/sparc/` directory structure, swarm agents, validation loops, and review reports. The generated version was a simplified 4-phase lifecycle without directory creation, without SPARC docs, without swarm agents.

## Root Cause

The instruction word "**Generate**" is ambiguous to AI. It can mean:
- "Create a new version inspired by this template" (AI's interpretation → compression)
- "Copy this template and adapt project-specific values" (intended meaning → preservation)

## Solution

Three-layer defense:

### 1. Explicit anti-compression instruction in module
```markdown
> **CRITICAL: COPY, DO NOT SUMMARIZE.**
> Read Section 2 from the template file VERBATIM.
> Copy the FULL text into the output file.
> Only adapt project-specific values.
> DO NOT compress, shorten, or "generate a version of" the template.
```

### 2. Validation checklist after generation
```markdown
**Validation checklist (verify before writing):**
- [ ] Phase 0 PRE-FLIGHT CHECK present
- [ ] Phase 1 creates docs/features/<name>/sparc/ directory
- [ ] Phase 2 has swarm agent table (5 agents)
- [ ] Output file is ≥100 lines
```

### 3. Global anti-compression rule in SKILL.md
Add at the top of any skill that generates files from templates:
```markdown
> When generating files from templates, COPY the full template structure — do NOT summarize.
```

## Affected

- `.claude/skills/cc-toolkit-generator-enhanced/SKILL.md` — added global rule
- `.claude/skills/cc-toolkit-generator-enhanced/modules/03-generate-p0.md` — added per-item rule + checklist
- `.claude/commands/feature.md` — regenerated from full template

## Prevention

Apply this pattern to ALL toolkit generator modules that reference templates via `view()`.
Every `view()` reference that feeds into a generated file needs the anti-compression guard.
