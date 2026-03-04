# Development Guide — КоммуниК

## Quick Start

```bash
# 1. Clone and setup
git clone <repo-url>
cd kommuniq

# 2. Install dependencies
npm install

# 3. Start infrastructure
docker compose up -d postgres redis

# 4. Run migrations
npm run db:migrate

# 5. Start dev server
npm run dev
```

## Development Lifecycle

### Starting a New Feature
```
/feature {feature-name}
```
This runs the full lifecycle: Plan → Validate → Implement → Review.

### Planning Only
```
/plan {feature-name}
```
Creates a plan in `docs/plans/` without starting implementation.

### Running Tests
```
/test all          # full suite
/test pql          # PQL Intelligence BC
/test fitness      # fitness functions only
```

### Deploying
```
/deploy local       # docker compose up
/deploy staging     # deploy to staging VPS
/deploy production  # deploy to production VPS
```

## Feature Priority (MVP Roadmap)

### M1: Foundation (4 weeks)
1. Project setup + Docker Compose
2. BC-05 IAM: Tenant + Operator + JWT + RLS
3. BC-01 Conversation: Dialog + WebSocket + Chat Widget
4. BC-02 PQL: RuleEngine (15 signals) + PQL Flag in Workspace
5. BC-02+04: Memory AI (amoCRM MCP)
6. BC-06: PQL Pulse notifications

### M2: Revenue Intelligence (4 weeks)
7. BC-03: Revenue Attribution + Report
8. BC-01+04: VK Max / Мессенджер Max MCP
9. Multi-operator: assignment queue, roles
10. Admin Dashboard

### M3: Growth (4 weeks)
11. ML Training data pipeline
12. PQL Feedback UI
13. Admin PQL Rule Editor
14. Grafana MCP monitoring

## Architecture Quick Reference

```
6 Bounded Contexts → single Docker Compose → VPS HOSTKEY
Event-driven via Redis Streams
MCP integrations via Cloud.ru AI Fabric + ACL + Circuit Breakers
Multi-tenancy: JWT + PostgreSQL RLS
```

See `docs/C4-diagrams.md` for visual architecture.

## Key Files

| Purpose | Path |
|---------|------|
| Project context | `CLAUDE.md` |
| Requirements | `docs/PRD.md` |
| Architecture | `docs/C4-diagrams.md`, `docs/ADR.md` |
| Domain model | `docs/bounded-contexts.md`, `docs/tactical-design.md` |
| Algorithms | `docs/pseudocode.md` |
| Test scenarios | `docs/test-scenarios.feature` |
| Quality gates | `docs/fitness-functions.md` |
| Risks | `docs/refinement.md` |

## Feature Workflow

The recommended development cycle:

```
/next                  → see sprint progress, pick next feature
/go {feature-name}     → auto-analyze complexity, select pipeline
  → /plan (simple)     → just plan + implement
  → /feature (standard)→ plan → validate → implement → review
/next {feature-id}     → mark done, cascade unblocking
```

## Autonomous Development

For hands-off development:

```
/run          → implement MVP features (next + in_progress)
/run mvp      → same as /run
/run all      → implement ALL features until roadmap is 100% done
```

Command hierarchy:
```
/run → /start → /next → /go → /plan | /feature
```

For documentation:
```
/docs         → generate RU + EN docs
/docs rus     → Russian only
/docs eng     → English only
/docs update  → refresh existing docs
```

## Available Commands

| Command | Description |
|---------|-------------|
| `/start` | Bootstrap project from docs |
| `/feature {name}` | Full feature lifecycle |
| `/plan {name}` | Plan implementation |
| `/test {scope}` | Run/generate tests |
| `/deploy {env}` | Deploy to environment |
| `/myinsights` | Capture development insights |
| `/next` | Sprint progress + next feature |
| `/go {feature}` | Smart pipeline selector |
| `/run [scope]` | Autonomous build loop |
| `/docs [lang]` | Bilingual documentation |

## Agents

| Agent | Purpose |
|-------|---------|
| `planner` | Feature planning with algorithm templates |
| `code-reviewer` | Quality + security + architecture review |
| `architect` | System design decisions |

## Fitness Functions

Run `npm run fitness` to verify all architectural constraints.
See `docs/fitness-functions.md` for details on all 10 fitness functions.

Critical: FF-01 (PQL latency), FF-03 (RLS isolation), FF-10 (data residency).
