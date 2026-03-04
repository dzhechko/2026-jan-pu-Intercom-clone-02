# /start — Bootstrap КоммуниК Project

## Role
Project bootstrapper. Set up the full monorepo structure from SPARC documentation.

## Execution

### Phase 1: Project Structure (use Task tool for parallel setup)

Create monorepo structure based on Bounded Contexts:

```
kommuniq/
├── src/
│   ├── conversation/          # BC-01
│   │   ├── domain/aggregates/ # Dialog, Message
│   │   ├── domain/events/     # DialogStarted, MessageReceived
│   │   ├── domain/ports/
│   │   ├── application/services/
│   │   ├── application/handlers/
│   │   └── infrastructure/repositories/
│   ├── pql/                   # BC-02 ⭐ CORE
│   │   ├── domain/aggregates/ # PQLDetector, SignalRule
│   │   ├── domain/events/     # PQLDetected
│   │   ├── domain/value-objects/ # RuleSet, MemoryContext, PQLScore
│   │   ├── application/services/ # PQLDetectorService, MemoryAIService
│   │   └── infrastructure/
│   ├── revenue/               # BC-03 ⭐ CORE
│   │   ├── domain/aggregates/ # RevenueReport, PQLAttribution
│   │   ├── application/services/
│   │   └── infrastructure/
│   ├── integration/           # BC-04
│   │   └── adapters/          # AmoCRMMCPAdapter, MaxMCPAdapter
│   ├── iam/                   # BC-05
│   │   ├── domain/aggregates/ # Tenant, Operator
│   │   └── infrastructure/
│   ├── notifications/         # BC-06
│   │   └── infrastructure/
│   └── shared/
│       ├── middleware/        # tenant.middleware.ts, auth.middleware.ts
│       ├── events/            # Domain Event types (shared kernel)
│       └── utils/             # encryption.ts
├── app/                       # Next.js 14 App Router
│   ├── (workspace)/           # Operator Workspace (Client Components)
│   ├── (admin)/               # Admin Dashboard (Server Components)
│   └── api/                   # API routes
├── widget/                    # Chat Widget (vanilla JS, ~20KB)
├── worker/                    # Cron jobs (Revenue Report)
├── prisma/ or migrations/     # DB migrations
├── docker-compose.yml
├── Dockerfile
├── package.json
└── tsconfig.json
```

### Phase 2: Database Setup

Create PostgreSQL schemas from `docs/tactical-design.md`:
- `conversations` — dialogs, messages (with RLS)
- `pql` — detectors, detections, ml_training_data
- `revenue` — reports, attributions
- `iam` — tenants, operators
- `notifications` — jobs

**CRITICAL:** Enable Row-Level Security on all tables with tenant_id.

Reference: `docs/tactical-design.md` for exact CREATE TABLE statements.

### Phase 3: Docker Compose

Set up services from `docs/C4-diagrams.md` Deployment Diagram:
- `app` — Next.js 14 + Node.js API + Socket.io (:3000, :4000)
- `postgres` — PostgreSQL 16 (:5432 internal)
- `redis` — Redis 7 (:6379 internal)
- `worker` — Cron jobs (Revenue Reports)
- `nginx` — Reverse proxy + SSL (:80, :443)

Health checks on all services. Internal network for DB/Redis.

### Phase 4: Core Dependencies

Install from `docs/refinement.md` R-07:
```bash
# Runtime
npm install express socket.io pg ioredis opossum zod jsonwebtoken puppeteer

# Dev
npm install -D typescript @types/node jest supertest @types/jest
npm install -D next@14 tailwindcss @shadcn/ui socket.io-client
```

## Anti-Hallucination Rules
- ALWAYS reference actual docs before generating code
- Check `docs/pseudocode.md` for algorithm implementations
- Check `docs/tactical-design.md` for DB schema
- Check `docs/ADR.md` for architectural decisions
- DO NOT invent features not in `docs/PRD.md`

## Checkpoint
After setup: run `docker compose up -d` and verify all services are healthy.
