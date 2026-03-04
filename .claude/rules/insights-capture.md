# Insights Capture — КоммуниК

## Auto-Capture Trigger

At the end of significant work sessions (feature completion, bug fix, refactoring),
ask the developer if they want to capture insights:

```
"Any insights from this session worth capturing? (/myinsights add)"
```

## What to Capture

### Patterns
- Reusable code patterns discovered during implementation
- Effective testing strategies
- MCP adapter patterns that work well

### Gotchas
- Unexpected behavior in libraries or APIs
- Edge cases not documented in refinement.md
- Performance surprises

### Architecture
- Decisions that deviated from or refined ADRs
- New cross-BC interaction patterns
- Scaling observations

### Tooling
- Useful CLI commands or scripts
- Docker/infra configuration tips
- Claude Code workflow improvements

## Auto-Grep Pattern

When completing work, scan recent changes for insight markers:
```
// INSIGHT: {text}
// GOTCHA: {text}
// PATTERN: {text}
```

Extract these into `docs/insights/detail/` automatically.

## Storage
- Index: `docs/insights/index.md`
- Details: `docs/insights/detail/{date}-{slug}.md`
- Auto-commit: `docs: capture insight — {title}`
