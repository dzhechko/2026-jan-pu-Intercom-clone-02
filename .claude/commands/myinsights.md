# /myinsights $ARGUMENTS — Development Insights

## Role
Capture, index, and retrieve development insights for the КоммуниК project.

## Input
`$ARGUMENTS` — subcommand: "add", "list", "search [query]", "summary", or empty (show index)

## Subcommands

### `/myinsights` (no args) — Show Index
Display `docs/insights/index.md` summary.

### `/myinsights add`
Capture a new insight interactively:
1. Ask: What did you learn? (pattern, gotcha, optimization, decision)
2. Ask: Which BC/area? (pql, conversation, revenue, integration, iam, infra)
3. Ask: Category? (pattern, bug-fix, performance, architecture, tooling)
4. Save to `docs/insights/detail/{date}-{slug}.md`
5. Update `docs/insights/index.md`

### `/myinsights list`
Show all insights grouped by category.

### `/myinsights search [query]`
Search insights by keyword.

### `/myinsights summary`
Generate summary of all insights by area and category.

## Insight File Format

```markdown
# Insight: {title}
**Date:** {YYYY-MM-DD} | **Area:** {bc-name} | **Category:** {category}

## Context
{what were you doing}

## Insight
{what you learned}

## Impact
{how this affects future development}
```

## Index Format (`docs/insights/index.md`)

```markdown
# Development Insights — КоммуниК

## Recent
- [{date}] {title} — {area}/{category}

## By Area
### PQL Intelligence
- ...
### Conversation
- ...

## Stats
Total: N insights | Most active: {area}
```

## Duplicate Detection
Before saving, grep existing insights for similar titles/content.
If potential duplicate found, ask user to confirm or merge.

## Auto-Capture
The `insights-capture` rule and Stop hook automatically remind to capture insights
at the end of significant work sessions.
