# Git Workflow — КоммуниК

## Commit Message Format

```
{type}({scope}): {description}
```

### Types
- `feat` — new feature
- `fix` — bug fix
- `refactor` — code restructuring
- `test` — tests
- `chore` — infrastructure, config
- `docs` — documentation
- `perf` — performance improvement

### Scopes (Bounded Contexts)
- `conversation` — BC-01
- `pql` — BC-02 PQL Intelligence
- `revenue` — BC-03
- `integration` — BC-04 MCP Layer
- `iam` — BC-05
- `notifications` — BC-06
- `shared` — shared kernel
- `docker` — Docker/infra
- `widget` — Chat Widget
- `workspace` — Operator Workspace UI
- `admin` — Admin Dashboard UI

### Examples
```
feat(pql): add rule engine with 15 default PQL signals
fix(conversation): handle empty telegram message content
refactor(integration): extract circuit breaker to base adapter
test(revenue): add attribution edge cases for draft reports
chore(docker): add health checks to all services
```

## Branch Strategy
- `main` — production-ready
- `feat/{bc}-{feature}` — feature branches
- `fix/{bc}-{description}` — bugfix branches

## Rules
- Commit after each meaningful milestone
- Never commit secrets (.env, API keys)
- Run `npm test` before pushing
- Squash WIP commits before merge
