# /feature $ARGUMENTS

## Overview

Four-phase feature development lifecycle with quality gates between each phase.
All documentation goes to `docs/features/<feature-name>/sparc/`.

## Phase 0: PRE-FLIGHT CHECK

Before starting, verify all required skills exist:

- ✅ `sparc-prd-mini/SKILL.md` — ABORT if missing (core orchestrator)
- ⚠️ `explore/SKILL.md` — fallback: built-in Socratic questions (degraded)
- ⚠️ `goap-research-ed25519/SKILL.md` — fallback: direct web_search (degraded)
- ⚠️ `problem-solver-enhanced/SKILL.md` — fallback: First Principles + SCQA only (degraded)
- ✅ `requirements-validator/SKILL.md` — ABORT if missing (Phase 2 blocker)
- ✅ `brutal-honesty-review/SKILL.md` — ABORT if missing (Phase 4 blocker)

If any ✅ skill is missing → stop and inform user to re-run toolkit generator.
If any ⚠️ skill is missing → warn user about degraded quality, continue.

## Phase 1: PLAN (sparc-prd-mini)

**Goal:** Research, analyze, and create full SPARC documentation for the feature.

1. Read the sparc-prd-mini skill from `.claude/skills/sparc-prd-mini/SKILL.md`
2. Create feature directory: `docs/features/<feature-name>/sparc/`
3. Run sparc-prd-mini Gate to assess task clarity (skip Explore if clear)
4. Apply sparc-prd-mini MANUAL mode to the feature
5. sparc-prd-mini delegates to external skills via view():
   - explore → Socratic questioning → Product Brief
   - goap-research → GOAP A* + OODA → Research Findings
   - problem-solver-enhanced → 9 modules + TRIZ → Solution Strategy
6. Output all SPARC documents into the feature directory:
   - PRD.md, Solution_Strategy.md, Specification.md
   - Pseudocode.md, Architecture.md, Refinement.md
   - Completion.md, Research_Findings.md, Final_Summary.md
   - Note: CLAUDE.md is NOT generated per-feature (project-level CLAUDE.md already exists)
7. Also save implementation plan to `docs/plans/{feature-id}-{feature-name}.md`
8. Git commit: `docs(feature): SPARC planning for <feature-name>`

**⏸️ Checkpoint:** Show SPARC summary, ask to proceed to validation.

## Phase 2: VALIDATE (requirements-validator, swarm)

**Goal:** Validate SPARC documentation quality using swarm of validation agents.

1. Read the requirements-validator skill from `.claude/skills/requirements-validator/SKILL.md`
2. Use swarm of agents to validate:

| Agent | Scope | Target |
|-------|-------|--------|
| validator-stories | User Stories from Specification.md | INVEST criteria, score ≥70 |
| validator-acceptance | Acceptance Criteria | SMART criteria, testability |
| validator-architecture | Architecture.md | Consistency with project Architecture |
| validator-pseudocode | Pseudocode.md | Completeness, implementability |
| validator-coherence | All SPARC files | Cross-reference consistency |

3. **Iterative loop (max 3 iterations):**
   - Run all validators in parallel (Agent tool)
   - Aggregate gaps and blocked items
   - Fix gaps in SPARC documents
   - Re-validate
   - Repeat until: no BLOCKED items, average score ≥70

4. Save validation report: `docs/features/<feature-name>/sparc/validation-report.md`
5. Git commit: `docs(feature): validation complete for <feature-name>`

**⏸️ Checkpoint:** Show validation results, ask to proceed to implementation.

## Phase 3: IMPLEMENT (swarm + parallel tasks)

**Goal:** Implement the feature using validated SPARC documents as source of truth.

1. Read ALL documents from `docs/features/<feature-name>/sparc/`
2. Use swarm of agents and specialized skills to deliver:
   - `@planner` — break down into tasks from Pseudocode.md
   - `@architect` — ensure consistency with Architecture.md
   - Implementation agents — parallel Agent tool for independent modules
3. **Make implementation modular** for reuse in other cases and applications
4. Save frequent commits to GitHub
5. Spawn concurrent tasks to speed up development

**Implementation rules:**
- Each module gets its own Agent for parallel execution
- Reference SPARC docs, don't hallucinate code
- Commit after each logical unit: `feat(<bc>): <what>`
- Run tests in parallel with implementation
- Respect architectural constraints:
  - No cross-BC imports (FF-02)
  - Circuit Breaker on MCP adapters (FF-04)
  - RLS on all queries (FF-03)
  - Domain types only in domain layer

**⏸️ Checkpoint:** Show implementation summary, ask to proceed to review.

## Phase 4: REVIEW (brutal-honesty-review, swarm)

**Goal:** Rigorous post-implementation review and improvement.

1. Read the brutal-honesty-review skill from `.claude/skills/brutal-honesty-review/SKILL.md`
2. Use swarm of agents for review:

| Agent | Scope | Focus |
|-------|-------|-------|
| code-quality | Source code | Clean code, patterns, naming |
| architecture | Integration | Consistency with project architecture |
| security | Security surface | Vulnerabilities, input validation |
| performance | Hot paths | Bottlenecks, complexity |
| testing | Test coverage | Edge cases, missing tests |

3. Process:
   - Run brutal-honesty-review on implementation
   - Fix identified issues (use Agent tool for parallel fixes)
   - Save frequent commits: `fix(<bc>): <what>`
   - Benchmark after implementation
   - Re-review critical findings until clean

4. Save review report: `docs/features/<feature-name>/review-report.md`
5. Git commit: `docs(feature): review complete for <feature-name>`

## Completion

After all 4 phases:

```
✅ Feature: <feature-name>
📁 docs/features/<feature-name>/
   ├── sparc/                  # SPARC documentation
   │   ├── PRD.md
   │   ├── Specification.md
   │   ├── Architecture.md
   │   ├── Pseudocode.md
   │   ├── Solution_Strategy.md
   │   ├── Refinement.md
   │   ├── Completion.md
   │   ├── Research_Findings.md
   │   ├── Final_Summary.md
   │   └── validation-report.md
   └── review-report.md       # Brutal honesty review

📊 Validation: score XX/100
🔍 Review: X issues found → X fixed
💾 Commits: N commits
```

## Git
```
docs(feature): SPARC planning for <feature-name>
docs(feature): validation complete for <feature-name>
feat({bc}): implement <feature-name>
fix({bc}): <fixes from review>
docs(feature): review complete for <feature-name>
```
