# Feature Lifecycle — КоммуниК

## Phases

Every feature follows 4 phases:

```
Plan → Validate → Implement → Review
```

### Phase 1: Plan
- Use `/plan {feature}` or `/feature {feature}`
- Read relevant docs (PRD, pseudocode, tactical-design)
- Create plan in `docs/plans/{feature-name}.md`
- Skills: `explore` (if requirements unclear)

### Phase 2: Validate
- Use `requirements-validator` skill
- Check INVEST criteria for user stories
- Verify acceptance criteria are testable
- Gate: score ≥ 50 to proceed

### Phase 3: Implement
- Follow the plan from Phase 1
- Reference pseudocode from `docs/pseudocode.md`
- Write tests alongside code
- Respect fitness functions

### Phase 4: Review
- Use `brutal-honesty-review` skill
- Check architectural compliance
- Run full test suite
- Verify fitness functions pass

## Skills Used

| Phase | Skill | Path |
|-------|-------|------|
| Plan | explore | `.claude/skills/explore/SKILL.md` |
| Plan | sparc-prd-mini | `.claude/skills/sparc-prd-mini/SKILL.md` |
| Validate | requirements-validator | `.claude/skills/requirements-validator/SKILL.md` |
| Review | brutal-honesty-review | `.claude/skills/brutal-honesty-review/SKILL.md` |

## Feature Branch
```
feat/{bc}-{feature-name}
```

## Git Commits During Feature
```
docs: plan for {feature}
feat({bc}): implement {feature} — phase 1
test({bc}): add tests for {feature}
feat({bc}): complete {feature}
```

## MVP Feature Priority (from PRD)

| Priority | Feature | BC |
|----------|---------|-----|
| 1 | Project setup + Docker Compose | infra |
| 2 | IAM: Tenant + Operator + JWT + RLS | BC-05 |
| 3 | Conversation: Dialog + WebSocket | BC-01 |
| 4 | Chat Widget v1 | BC-01 |
| 5 | PQL RuleEngine (15 rules) | BC-02 |
| 6 | PQL Flag in Workspace | BC-02 |
| 7 | Memory AI (amoCRM MCP) | BC-02+04 |
| 8 | Telegram channel | BC-01+04 |
| 9 | Revenue Report | BC-03 |
| 10 | Admin Dashboard | BC-03 |
