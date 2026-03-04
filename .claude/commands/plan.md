# /plan $ARGUMENTS — Implementation Planning

## Role
Create detailed implementation plan for a feature or task.

## Input
`$ARGUMENTS` — feature name, task description, or FR/US reference

## Process

1. **Identify scope:**
   - Read `docs/PRD.md` for requirements
   - Read `docs/bounded-contexts.md` for BC ownership
   - Read `docs/pseudocode.md` for algorithms
   - Read `docs/tactical-design.md` for DB schema

2. **Create plan** in `docs/plans/{feature-name}.md`:

```markdown
# Plan: {Feature Name}

## Requirements
- FR-XX: {requirement}
- US-XX: {user story}

## Bounded Context
BC-0X: {name}

## Files to Create/Modify
- src/{bc}/domain/aggregates/{Name}.ts — {description}
- src/{bc}/application/services/{Name}Service.ts — {description}
- ...

## Algorithm Reference
PS-XX from docs/pseudocode.md

## Database Changes
{tables, indexes, RLS policies}

## Dependencies
- {other features or external services needed}

## Test Strategy
- Unit: {what to test}
- Integration: {what to test}
- BDD: reference docs/test-scenarios.feature

## Risks
- {from docs/refinement.md if applicable}

## Estimated Complexity
{S/M/L}
```

3. **Auto-commit plan:**
```
docs: implementation plan for {feature-name}
```

## Rules
- ALWAYS reference actual documentation, never invent requirements
- Plans are living documents — update as implementation progresses
- Check for dependencies on other features before starting
