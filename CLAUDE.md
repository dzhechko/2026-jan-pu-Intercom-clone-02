# КоммуниК — Revenue Intelligence Platform

## Project Overview

КоммуниК превращает службу поддержки PLG/SaaS компаний из центра затрат в источник выручки.
Автоматически обнаруживает Product-Qualified Leads (PQL) в диалогах поддержки и атрибутирует выручку.

**Core Value:** PQL Detection + Revenue Attribution + Memory AI (CRM context)

**Differentiation vs Intercom/Zendesk:**
- PQL Detection (нет у конкурентов в RU)
- Revenue Intelligence Report — "поддержка принесла X руб."
- Memory AI через amoCRM MCP
- 100% российская инфраструктура (152-ФЗ)

## Architecture

**Pattern:** Distributed Monolith (Monorepo)
**Deploy:** Docker Compose → VPS HOSTKEY

```
Stack: Next.js 14 + Node.js/Express + PostgreSQL 16 + Redis 7
AI:    Rule-based PQL v1 → ML v2 → GLM-5/vLLM v3 (on-premise)
MCP:   Cloud.ru AI Fabric (amoCRM, Max, Postgres, Grafana, RAG)
```

### Bounded Contexts (6)

| BC | Folder | Role |
|----|--------|------|
| BC-01 Conversation | `src/conversation/` | Message intake, routing, WebSocket |
| BC-02 PQL Intelligence ⭐ | `src/pql/` | PQL detection, Memory AI, ML pipeline |
| BC-03 Revenue ⭐ | `src/revenue/` | Attribution, Revenue Report, dashboard |
| BC-04 Integration | `src/integration/` | MCP adapters (ACL + Circuit Breaker) |
| BC-05 Identity & Access | `src/iam/` | Multi-tenancy, JWT, RLS |
| BC-06 Notifications | `src/notifications/` | PQL Pulse, email, push |

### Event Flow (primary)

```
MessageReceived → [Redis Stream] → PQLDetector →
  [amoCRM MCP + RAG MCP] → PQLDetected →
  [WS push + Revenue Attribution + Notification]
```

### MCP Integrations (Cloud.ru AI Fabric)

| MCP Server | Use Case | Priority |
|------------|----------|----------|
| amoCRM MCP (38★) | Memory AI + deal creation + revenue attribution | MUST |
| Мессенджер Max MCP (23★) | VK Max channel | SHOULD |
| Postgres MCP (7★) | AI analytics | SHOULD |
| Grafana MCP (8★) | Monitoring | COULD |
| Evolution RAG MCP | KB + auto-reply drafts | COULD |

## Key Architectural Decisions

1. **Cloud.ru MCP = Integration Layer (ADR-002):** NEVER call external APIs directly from domain code. Always through MCP Adapter + ACL.
2. **Rule-Based PQL v1 → ML v2 → LLM v3 (ADR-009):** v1 = regex only, NO LLM. v2 after 1K dialogs. v3 after 10K + GPU.
3. **Redis Streams for async events (ADR-006):** MessageReceived does NOT wait for PQL detection. Fire-and-forget.
4. **JWT + RLS (ADR-007):** ALWAYS `SET app.tenant_id` before DB query. NEVER pass tenant_id as filter param.
5. **Data Residency (ADR-003 + FF-10):** FORBIDDEN: OpenAI/Anthropic API for production data. ONLY on-premise vLLM + Cloud.ru.

## Tech Stack (locked versions)

```yaml
Runtime: Node 20.x LTS, TypeScript 5.4.x
Frontend: Next.js 14.2.x, Tailwind 3.4.x, shadcn/ui, Socket.io-client 4.7.x
Backend: Express 4.19.x, Socket.io 4.7.x, pg 8.11.x, ioredis 5.3.x, opossum 8.1.x, zod 3.22.x
Testing: Jest 29.x, Supertest 6.x
Infra: PostgreSQL 16-alpine, Redis 7-alpine, Nginx 1.25-alpine
```

## Folder Structure (per BC)

```
src/{bc-name}/
  domain/
    aggregates/     # Aggregate classes
    events/         # Domain Event types
    ports/          # Interface definitions (CRMPort, etc)
    value-objects/  # Value Object classes
  application/
    services/       # Application Services (use cases)
    handlers/       # Event Handlers (Redis Stream consumers)
  infrastructure/
    repositories/   # DB implementations
    adapters/       # MCP Adapters (BC-04 only)
```

## Fitness Functions (DO NOT BREAK)

**CRITICAL (block deploy):**
- FF-01: PQL detection < 2000ms p95
- FF-03: Tenant RLS isolation 100%
- FF-10: Data residency — only Russian VPS

**HIGH (block merge):**
- FF-02: No cross-BC imports (ESLint)
- FF-04: Circuit Breaker on every MCP adapter
- FF-05: RuleEngine coverage ≥ 95%
- FF-08: Redis Stream lag < 1000

## Parallel Execution Strategy

- Use `Task` tool for independent subtasks (e.g., running tests + linting + type-check in parallel)
- PQL detection: RuleEngine + MemoryAI run in parallel (PS-01)
- Revenue Report: iterate tenants in parallel with error isolation
- For complex features: spawn specialized agents (planner, code-reviewer, architect)

## Swarm Agents

| Agent | When to Use |
|-------|-------------|
| `planner` | Feature planning with algorithm templates from Pseudocode.md |
| `code-reviewer` | Quality review with edge cases from Refinement.md |
| `architect` | System design decisions using Architecture docs |

## MANDATORY Development Rules

> **These rules are NON-NEGOTIABLE. Every feature implementation MUST follow them.**

1. **Document first, code second.** Always create `docs/plans/{feature-id}-{name}.md` BEFORE writing code.
2. **One feature = one commit + push.** Never batch features. Push after every feature.
3. **Use the skill chain.** `/next` → `/go` → `/plan`|`/feature` → commit → push → `/next done`.
4. **Never bypass /go.** Do not launch raw agents to implement features. All work goes through `/go`.
5. **Follow /feature lifecycle.** Plan → Validate → Implement → Review. All 4 phases required.

## Git Workflow

```
feat(bc): description    # new feature
fix(bc): description     # bug fix
refactor(bc): description # refactoring
test(bc): description    # tests
chore(scope): description # infra/config
docs(scope): description  # documentation
```

Where `bc` = conversation | pql | revenue | integration | iam | notifications

**Commit + push frequency:**
- After EACH feature implementation
- After documentation generation
- Before ending any session

## Domain Glossary

| Term | Definition |
|------|-----------|
| **Dialog** | Support session (NOT "chat") |
| **PQL** | Product-Qualified Lead — client ready to buy |
| **PQL Signal** | Phrase/pattern indicating purchase intent |
| **PQL Score** | 0–1 confidence. ≥0.80=HOT, ≥0.65=WARM |
| **Memory AI** | Auto-load CRM context before operator responds |
| **Revenue Attribution** | Link PQL flag → closed CRM deal |
| **Tenant** | Client company of КоммуниК |
| **Operator** | Support agent of a tenant company |
| **MCP Adapter** | ACL wrapper over Cloud.ru MCP server |

## Feature Roadmap

Feature roadmap is tracked in `.claude/feature-roadmap.json` (15 features from PRD).
SessionStart hook auto-injects sprint progress at session start.

Use `/next` to see progress and pick next feature.
Use `/next {feature-id}` to mark done and cascade unblocking.

## Automation Commands

| Command | Purpose |
|---------|---------|
| `/go [feature]` | Analyze complexity → auto-select pipeline (/plan, /feature) |
| `/run` or `/run mvp` | Autonomous loop: /start → /next → /go until MVP complete |
| `/run all` | Implement ALL features until roadmap is 100% done |
| `/docs [lang]` | Generate bilingual RU/EN documentation |

Command hierarchy:
```
/run → /start → /next → /go → /plan | /feature
```

## Available Commands

| Command | Description |
|---------|-------------|
| `/start` | Bootstrap project from docs |
| `/feature [name]` | Full feature lifecycle (plan → validate → implement → review) |
| `/plan [feature]` | Plan implementation for a feature |
| `/test [scope]` | Run/generate tests |
| `/deploy [env]` | Deploy to environment |
| `/myinsights` | Capture development insights |
| `/next` | Sprint progress + next feature suggestions |
| `/go [feature]` | Smart pipeline selector (complexity → pipeline) |
| `/run [scope]` | Autonomous build loop (mvp/all) |
| `/docs [lang]` | Bilingual documentation generator |

## Available Agents

| Agent | File | Purpose |
|-------|------|---------|
| planner | `.claude/agents/planner.md` | Feature planning |
| code-reviewer | `.claude/agents/code-reviewer.md` | Code quality review |
| architect | `.claude/agents/architect.md` | Architecture decisions |

## Key Documentation

| Document | Path |
|----------|------|
| PRD | `docs/PRD.md` |
| Bounded Contexts | `docs/bounded-contexts.md` |
| Tactical Design (DB Schema) | `docs/tactical-design.md` |
| C4 Diagrams | `docs/C4-diagrams.md` |
| Pseudocode (7 algorithms) | `docs/pseudocode.md` |
| ADR (12 decisions) | `docs/ADR.md` |
| Refinement & Risks | `docs/refinement.md` |
| BDD Scenarios | `docs/test-scenarios.feature` |
| Fitness Functions | `docs/fitness-functions.md` |
| AI Context | `docs/ai-context.md` |

## Development Insights

Insights are automatically captured during development. Use `/myinsights` to view and manage.
Insight files: `docs/insights/index.md` (summary) + `docs/insights/detail/` (individual).

## Feature Development Lifecycle

New features use the 4-phase lifecycle: `/feature [name]`
1. **PLAN** — sparc-prd-mini (with Gate + external skills) → `docs/features/<name>/sparc/`
2. **VALIDATE** — requirements-validator swarm → score >=70
3. **IMPLEMENT** — parallel agents from validated docs
4. **REVIEW** — brutal-honesty-review swarm → fix all criticals

Available lifecycle skills in `.claude/skills/`:
- `sparc-prd-mini` (orchestrator, delegates to explore, goap-research, problem-solver-enhanced)
- `explore` (Socratic questioning → Product Brief)
- `goap-research-ed25519` (GOAP A* + OODA → Research Findings)
- `problem-solver-enhanced` (9 modules + TRIZ → Solution Strategy)
- `requirements-validator`
- `brutal-honesty-review`

Feature docs output: `docs/features/<feature-name>/sparc/` (SPARC docs) + `docs/features/<feature-name>/review-report.md`
