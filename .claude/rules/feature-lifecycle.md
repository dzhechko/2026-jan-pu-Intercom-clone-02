# Feature Development Lifecycle

## Protocol

Every new feature MUST follow the 4-phase lifecycle:

```
/feature [name]
  Phase 1: PLAN     → sparc-prd-mini → docs/features/<name>/sparc/
  Phase 2: VALIDATE → requirements-validator (swarm, max 3 iterations)
  Phase 3: IMPLEMENT → swarm of agents + parallel tasks
  Phase 4: REVIEW   → brutal-honesty-review (swarm)
```

## Rules

### Planning (Phase 1)
- ALL features get SPARC documentation, no exceptions
- Documentation lives in `docs/features/<feature-name>/sparc/`
- sparc-prd-mini runs Gate to assess task clarity before starting
- Use sparc-prd-mini in MANUAL mode for complex features, AUTO for minor
- sparc-prd-mini delegates to explore, goap-research, problem-solver-enhanced via view()
- Architecture.md MUST be consistent with project's root Architecture
- Also save implementation plan to `docs/plans/{feature-id}-{feature-name}.md`
- Commit docs before implementation

### Validation (Phase 2)
- Run requirements-validator as swarm (parallel validation agents)
- Minimum score: 70/100 average, no BLOCKED items
- Fix gaps in docs, not in code
- Max 3 iterations — if not passing, escalate to user
- Commit validation-report.md

### Implementation (Phase 3)
- Read SPARC docs — don't hallucinate code
- Modular design — components reusable across projects
- Use Agent tool for parallel work on independent modules
- Commit after each logical change (not at end)
- Run tests in parallel with development
- Format: `feat(<bc>): <description>`
- Respect architectural constraints:
  - No cross-BC imports (FF-02)
  - Circuit Breaker on MCP adapters (FF-04)
  - RLS on all queries (FF-03)
  - Domain types only in domain layer

### Review (Phase 4)
- Use brutal-honesty-review with swarm of agents
- No sugar-coating — find real problems
- Fix all critical and major issues before marking complete
- Benchmark performance after implementation
- Commit review-report.md

## Feature Directory Structure

```
docs/features/
├── pql-flag-in-dialog/
│   ├── sparc/
│   │   ├── PRD.md
│   │   ├── Specification.md
│   │   ├── Architecture.md
│   │   ├── Pseudocode.md
│   │   ├── Solution_Strategy.md
│   │   ├── Refinement.md
│   │   ├── Completion.md
│   │   ├── Research_Findings.md
│   │   ├── Final_Summary.md
│   │   └── validation-report.md
│   └── review-report.md
├── memory-ai/
│   ├── sparc/
│   │   └── ...
│   └── review-report.md
└── ...
```

## Skills Used

| Phase | Skill | Path |
|-------|-------|------|
| Plan | sparc-prd-mini | `.claude/skills/sparc-prd-mini/SKILL.md` |
| Plan | explore | `.claude/skills/explore/SKILL.md` |
| Plan | goap-research-ed25519 | `.claude/skills/goap-research-ed25519/SKILL.md` |
| Plan | problem-solver-enhanced | `.claude/skills/problem-solver-enhanced/SKILL.md` |
| Validate | requirements-validator | `.claude/skills/requirements-validator/SKILL.md` |
| Review | brutal-honesty-review | `.claude/skills/brutal-honesty-review/SKILL.md` |

## When to Skip Phases

| Scenario | Skip | Justification |
|----------|------|---------------|
| Hotfix (1-5 lines) | Phase 1-2 | Too small for full SPARC |
| Config change | Phase 1-2 | No new functionality |
| Dependency update | Phase 1-2 | No new design needed |
| Refactoring | Phase 1 only | Validate + implement + review |
| New feature | NEVER skip | Full lifecycle always |

For skipped phases, still run Phase 4 (brutal-honesty-review) on the changes.

## Git Commits During Feature

```
docs(feature): SPARC planning for <feature-name>
docs(feature): validation complete for <feature-name>
feat(<bc>): implement <feature-name>
fix(<bc>): <fixes from review>
docs(feature): review complete for <feature-name>
```
