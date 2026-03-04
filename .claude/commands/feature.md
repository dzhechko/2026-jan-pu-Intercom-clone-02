# /feature $ARGUMENTS — Feature Lifecycle

## Role
Orchestrate full feature development lifecycle: Plan → Validate → Implement → Review.

## Input
`$ARGUMENTS` — feature name/description (e.g., "PQL Detection v1", "Telegram channel")

## Phase 1: Plan

1. Read relevant docs:
   - `docs/PRD.md` — find matching FR/US
   - `docs/pseudocode.md` — find algorithm if applicable
   - `docs/bounded-contexts.md` — identify which BC owns this feature
   - `docs/tactical-design.md` — DB schema for the feature

2. Use `explore` skill (`.claude/skills/explore/SKILL.md`) if requirements unclear

3. Create implementation plan:
   - Files to create/modify
   - Dependencies on other features
   - Estimated complexity
   - Test strategy

4. Save plan to `docs/plans/{feature-name}.md`

## Phase 2: Validate

1. Use `requirements-validator` skill (`.claude/skills/requirements-validator/SKILL.md`)
   - Check INVEST criteria for user stories
   - Verify acceptance criteria are testable
   - Generate BDD scenarios if missing

2. Gate: score ≥ 50 to proceed

## Phase 3: Implement

1. Follow the plan from Phase 1
2. Reference pseudocode from `docs/pseudocode.md`
3. Respect architectural constraints:
   - No cross-BC imports (FF-02)
   - Circuit Breaker on MCP adapters (FF-04)
   - RLS on all queries (FF-03)
   - Domain types only in domain layer
4. Write tests alongside code
5. Use parallel Task execution where possible

## Phase 4: Review

1. Use `brutal-honesty-review` skill (`.claude/skills/brutal-honesty-review/SKILL.md`)
2. Check against Fitness Functions from `docs/fitness-functions.md`
3. Run tests: `npm test`
4. Verify no cross-BC imports

## Git
```
feat({bc}): add {feature-name}
```

Commit after each meaningful milestone, not after every file change.
