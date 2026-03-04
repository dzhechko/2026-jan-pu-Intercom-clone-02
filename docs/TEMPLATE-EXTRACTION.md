# КоммуниК — Reusable Templates & Configurations

Extracted reusable file structures, configs, and patterns from the КоммуниК project for use as starting points in other projects.

---

## 1. Docker Compose Multi-Service Architecture

**Name:** Multi-Service Docker Compose with Health Checks
**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/docker-compose.yml`
**What it templates:** Full-stack composition with Next.js app, Node.js worker, PostgreSQL, Redis, and Nginx reverse proxy with health checks and internal/external networks.
**Parameterizable:** YES
**Parameters:**
- App service name (default: `app`)
- Worker service name (default: `worker`)
- Database name, user, password (default: `kommuniq`)
- Redis max memory and policy (default: `256mb`, `allkeys-lru`)
- Nginx ports (default: 80, 443)
- Volume mount paths
- Environment variables per service

**Tech Stack:** Docker, Docker Compose
**Key Features:**
- Dual network setup (internal for services, external for public)
- Health checks with configurable intervals and retries
- Volume persistence for PostgreSQL and Redis
- Depends-on conditions for service startup ordering
- Environment file support (.env)
- Rate limiting zones in Nginx config

**Reusability:** High - standard pattern for monolith deployments
**Customization Points:**
```yaml
# Easily swappable services
services:
  app:              # Next.js + Express server
  worker:           # Background jobs / cron tasks
  postgres:         # PostgreSQL 16 (can swap version)
  redis:            # Redis 7 (can swap version)
  nginx:            # Reverse proxy (can add SSL certs)
```

---

## 2. Multi-Stage Node.js Dockerfile

**Name:** Node 20 Multi-Stage Build for Next.js + Express
**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/Dockerfile`
**What it templates:** Three-stage Docker build optimizing dependency caching, build artifacts, and runtime image size with non-root user execution.
**Parameterizable:** YES
**Parameters:**
- Base image version (default: `node:20-alpine`)
- Build command (default: `npm run build`)
- App user UID/GID (default: 1001/1001, "kommuniq")
- Exposed ports (default: 3000, 4000)
- Startup command (default: `npm start`)

**Tech Stack:** Docker, Node.js 20, Next.js 14, Express
**Key Features:**
- Stage 1 (deps): Installs both dev and prod dependencies with layer caching
- Stage 2 (builder): Compiles TypeScript, builds Next.js, bundles assets
- Stage 3 (runner): Minimal runtime with only necessary files
- Non-root user for security (uid 1001, "kommuniq")
- Copies built artifacts selectively (`.next/standalone`, `.next/static`, `dist/`, migrations, scripts)

**Reusability:** High - universal pattern for Node.js full-stack apps
**Customization Points:**
```dockerfile
# Swap base image for different Node versions or distros
FROM node:20-alpine AS deps
FROM node:22-alpine AS deps  # or any version

# Adjust build step
RUN npm run build  # or: npm ci && npm run compile

# Change app user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 kommuniq
# to:
RUN addgroup --system --gid 1000 appuser && \
    adduser --system --uid 1000 apprunner

# Modify exposed ports
EXPOSE 3000 4000
# to:
EXPOSE 8080 9000
```

---

## 3. TypeScript Configuration (Frontend + Backend)

**Name:** TypeScript Strict Mode with Path Aliases (Dual Config)
**Files:**
- Frontend: `/workspaces/2026-jan-pu-Intercom-clone-02/tsconfig.json`
- Backend: `/workspaces/2026-jan-pu-Intercom-clone-02/tsconfig.server.json`

**What it templates:** Two TypeScript configurations enforcing strict type checking with module path aliases for BC (Bounded Context) imports.
**Parameterizable:** YES
**Parameters:**
- Strict mode (default: `true`)
- Target ES version (default: `ES2022`)
- Module system (frontend: `esnext`, backend: `commonjs`)
- Path aliases (parameterizable per BC)
- Include/exclude patterns

**Tech Stack:** TypeScript 5.4, Next.js 14 (frontend), Express (backend)

**Frontend tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "strict": true,
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "paths": {
      "@shared/*": ["./src/shared/*"],
      "@conversation/*": ["./src/conversation/*"],
      "@pql/*": ["./src/pql/*"],
      "@revenue/*": ["./src/revenue/*"],
      "@integration/*": ["./src/integration/*"],
      "@iam/*": ["./src/iam/*"],
      "@notifications/*": ["./src/notifications/*"]
    }
  }
}
```

**Backend tsconfig.server.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "sourceMap": true,
    "declaration": true,
    "paths": {
      "@shared/*": ["./src/shared/*"],
      "@conversation/*": ["./src/conversation/*"],
      // ... (same as frontend)
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

**Key Features:**
- Strict type checking (no `any`, no implicit `any`)
- Path aliases for cross-module imports (prevents relative path hell)
- Separate configs for frontend (JSX, bundler mode) and backend (CommonJS, declaration maps)
- Source maps for debugging
- Declaration files for type exports

**Reusability:** Very High - standard for monorepos with DDD structure
**Customization Points:**
- Add/remove BC aliases as needed
- Swap `ES2022` for `ES2020` or `ES2023`
- Toggle `strict: false` (not recommended)
- Adjust `outDir`, `rootDir` based on folder structure

---

## 4. Jest Configuration with Coverage Thresholds

**Name:** Jest Config with Per-Module Coverage Enforcement
**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/jest.config.ts`
**What it templates:** Jest test config with module name mapping, coverage thresholds per domain layer (PQL ≥95%), and output routing.
**Parameterizable:** YES
**Parameters:**
- Test roots (default: `['<rootDir>/src', '<rootDir>/tests', '<rootDir>/widget']`)
- Test file patterns (default: `**/*.test.ts`, `**/*.spec.ts`)
- Coverage thresholds (global: 50%, PQL domain: 95%)
- Coverage directory (default: `coverage/`)

**Tech Stack:** Jest 29, ts-jest, TypeScript
**Key Features:**
- TypeScript preset via `ts-jest`
- Module name mapper for BC path aliases
- Per-module coverage thresholds (can enforce higher standards on critical domains)
- Excludes coverage for index files and types
- Node test environment (not jsdom)

```typescript
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests', '<rootDir>/widget'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@conversation/(.*)$': '<rootDir>/src/conversation/$1',
    '^@pql/(.*)$': '<rootDir>/src/pql/$1',
    // ... (for each BC)
  },
  coverageThreshold: {
    global: { lines: 50 },
    'src/pql/domain/': {
      lines: 95,
      functions: 100,
      branches: 90,
    },
  },
}
```

**Reusability:** Very High - standard Jest setup with per-module enforcement
**Customization Points:**
- Adjust global threshold (50% → 80% for mature projects)
- Add more domain-specific thresholds for other BCs
- Change test environment (node → jsdom for React components)
- Modify roots to match your folder structure

---

## 5. Next.js Configuration

**Name:** Next.js 14 Standalone Build for Containerization
**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/next.config.js`
**What it templates:** Minimal Next.js config enabling standalone output and external packages for database drivers.
**Parameterizable:** YES
**Parameters:**
- Output format (default: `standalone`)
- External packages (default: `['pg']` for PostgreSQL)

**Tech Stack:** Next.js 14, Node.js 20
**Key Features:**
- `output: 'standalone'` — creates self-contained .next/standalone folder for Docker
- `serverComponentsExternalPackages` — marks native modules to skip bundling

```javascript
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['pg'],  // Don't bundle pg driver
  },
}
```

**Reusability:** High - standard for containerized Next.js apps
**Customization Points:**
- Add more external packages: `['pg', 'bcrypt', 'sharp']`
- Remove standalone if not using Docker
- Add env var prefixes, redirects, rewrites as needed

---

## 6. Tailwind + PostCSS Configuration

**Name:** Minimal Tailwind & PostCSS Setup
**Files:**
- Tailwind: `/workspaces/2026-jan-pu-Intercom-clone-02/tailwind.config.ts`
- PostCSS: `/workspaces/2026-jan-pu-Intercom-clone-02/postcss.config.js`

**What it templates:** Basic Tailwind + autoprefixer with content path configuration.
**Parameterizable:** YES
**Parameters:**
- Content paths (default: `./app/**/*.{js,ts,jsx,tsx,mdx}`, `./src/**/*.{js,ts,jsx,tsx,mdx}`)
- Theme extensions
- Plugins

**Tech Stack:** Tailwind CSS 3.4, PostCSS, Next.js 14

**tailwind.config.ts:**
```typescript
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: { extend: {} },
  plugins: [],
}
```

**postcss.config.js:**
```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

**Reusability:** Very High - standard Tailwind setup
**Customization Points:**
- Extend theme colors, spacing, fonts
- Add Tailwind plugins (forms, daisyui, etc.)
- Adjust content paths for your folder structure

---

## 7. Nginx Reverse Proxy with Rate Limiting

**Name:** Nginx Reverse Proxy with Rate Limiting & WebSocket Support
**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/nginx/nginx.conf`
**What it templates:** Production-grade Nginx config with upstream definitions, rate limiting zones, health checks, WebSocket proxy, and caching.
**Parameterizable:** YES
**Parameters:**
- Upstream servers (default: `app:3000`, `api:4000`)
- Rate limit zones (default: 100 req/min API, 10 req/min widget)
- Burst settings (default: burst=20 API, burst=5 widget)
- Cache duration (default: 1h for widget.js)
- Health check endpoint (default: `/api/health`)

**Tech Stack:** Nginx 1.25, Express, Socket.io
**Key Features:**
- Dual upstreams (frontend app, backend API)
- Rate limiting by IP address
- WebSocket upgrade support (Upgrade header)
- Long read timeout for WebSocket (86400s)
- Static asset caching with Cache-Control headers
- Health check endpoint routing

```nginx
events { worker_connections 1024; }
http {
  upstream app { server app:3000; }
  upstream api { server app:4000; }

  limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;
  limit_req_zone $binary_remote_addr zone=widget_limit:10m rate=10r/m;

  server {
    listen 80;

    # Frontend
    location / { proxy_pass http://app; }

    # API with rate limit
    location /api/ {
      limit_req zone=api_limit burst=20 nodelay;
      proxy_pass http://api;
    }

    # WebSocket
    location /socket.io/ {
      proxy_pass http://api;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_read_timeout 86400;
    }

    # Static asset caching
    location /widget.js {
      limit_req zone=widget_limit burst=5;
      proxy_cache_valid 200 1h;
    }

    # Health check
    location /health { proxy_pass http://api/api/health; }
  }
}
```

**Reusability:** Very High - standard pattern for containerized full-stack apps
**Customization Points:**
- Add SSL/TLS cert paths for HTTPS
- Adjust upstream server addresses
- Modify rate limits for your load profile
- Add additional locations for other services
- Configure gzip compression
- Add security headers (X-Frame-Options, etc.)

---

## 8. .gitignore Template

**Name:** Comprehensive .gitignore for Node.js + Next.js + Docker
**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/.gitignore`
**What it templates:** Complete ignore list for dependencies, build artifacts, environment files, IDE settings, logs, Docker volumes, and generated files.
**Parameterizable:** Minimal (mostly static)
**Parameters:**
- Docker volume folders (adjust if using different names)
- Build output folders (dist/, .next/, etc.)
- Environment patterns

**Tech Stack:** Git, Node.js, Next.js, Docker
**Content Highlights:**
```gitignore
# Dependencies
node_modules/
.pnp

# Build artifacts
dist/
.next/
out/
build/

# Environment
.env
.env.*.local

# IDE
.vscode/
.idea/

# Docker volumes (local only)
postgres_data/
redis_data/

# Testing
coverage/

# Generated
public/widget.js
*.tsbuildinfo
```

**Reusability:** Very High - standard for Node.js projects
**Customization Points:**
- Add project-specific folders
- Exclude platform-specific IDE configs
- Add API key patterns to prevent accidental commits

---

## 9. Database Migrations Schema Pattern

**Name:** SQL Migrations with DDD Schemas & RLS Policies
**Files:**
- Schema creation: `/workspaces/2026-jan-pu-Intercom-clone-02/migrations/001_create_schemas.sql`
- IAM tables: `/workspaces/2026-jan-pu-Intercom-clone-02/migrations/002_iam_tables.sql`
- Conversation tables: `/workspaces/2026-jan-pu-Intercom-clone-02/migrations/003_conversations_tables.sql`
- (Plus 4 more for PQL, Revenue, Notifications, ML features)

**What it templates:** PostgreSQL migration pattern using schemas per Bounded Context, UUIDs as PKs, JSONB for flexible data, Row-Level Security (RLS) policies, and composite indexes.
**Parameterizable:** YES (per BC context)
**Parameters:**
- Bounded Context name (becomes PostgreSQL schema)
- Table names and column definitions
- RLS tenant_id column (always present)
- JSONB columns for metadata/settings
- Index strategies (single-column, composite, conditional)

**Tech Stack:** PostgreSQL 16, SQL (no ORM)
**Key Features:**
- **One schema per BC** — prevents cross-BC queries, enforces boundaries
- **Tenant isolation** — every table has `tenant_id`, RLS policy enforces visibility
- **UUIDs as primary keys** — distributed system friendly
- **JSONB storage** — flexible schema evolution
- **RLS policies** — database-level access control

**Migration 001 (Schema Setup):**
```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS conversations;
CREATE SCHEMA IF NOT EXISTS pql;
CREATE SCHEMA IF NOT EXISTS revenue;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS notifications;
```

**Migration 002 (IAM tables with RLS):**
```sql
CREATE TABLE iam.tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  plan          VARCHAR(20) NOT NULL DEFAULT 'TRIAL'
                  CHECK (plan IN ('TRIAL','GROWTH','REVENUE','OUTCOME')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE iam.operators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES iam.tenants(id),
  email         VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'OPERATOR'
                  CHECK (role IN ('ADMIN','OPERATOR')),
  UNIQUE(tenant_id, email)
);

-- RLS Policy (critical!)
ALTER TABLE iam.operators ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_operators ON iam.operators
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

**Migration 003 (Conversation tables):**
```sql
CREATE TABLE conversations.dialogs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES iam.tenants(id),
  channel_type  VARCHAR(20) NOT NULL
                  CHECK (channel_type IN ('WEB_CHAT','TELEGRAM','VK_MAX')),
  status        VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  pql_score     NUMERIC(3,2),
  pql_tier      VARCHAR(10) CHECK (pql_tier IN ('HOT','WARM','COLD')),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dialogs_tenant_status ON conversations.dialogs(tenant_id, status);
CREATE INDEX idx_dialogs_pql_tier ON conversations.dialogs(tenant_id, pql_tier)
  WHERE pql_tier IS NOT NULL;  -- Conditional index for sparse data

ALTER TABLE conversations.dialogs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_dialogs ON conversations.dialogs
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

**Reusability:** Very High - standard pattern for multi-tenant DDD systems
**Customization Points:**
- Create new schema per BC
- Adjust CHECK constraints for domain values
- Customize JSONB columns based on domain needs
- Add/modify indexes for performance
- Adjust RLS policies based on access patterns

---

## 10. Environment Variables Template

**Name:** Comprehensive .env.example for Full-Stack App
**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/.env.example`
**What it templates:** Complete environment variable configuration for database, cache, auth, encryption, APIs, and MCP servers.
**Parameterizable:** YES (all values)
**Parameters:**
- Database credentials and URL
- Redis connection string
- JWT secret and expiry
- Encryption key for sensitive data
- API server ports and URLs
- Third-party service keys (email, MCP servers)
- Webhook secrets
- Node environment

**Tech Stack:** Node.js, PostgreSQL, Redis, Express, Next.js
**Key Sections:**

```bash
# Database
DATABASE_URL=postgresql://kommuniq:kommuniq@localhost:5432/kommuniq
POSTGRES_USER=kommuniq
POSTGRES_PASSWORD=kommuniq

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=change-this-to-a-random-string-in-production
JWT_EXPIRES_IN=7d

# Encryption (for sensitive stored data)
ENCRYPTION_KEY=change-this-to-a-32-byte-hex-string-in-production

# Server
API_PORT=4000
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000

# External APIs
RESEND_API_KEY=re_xxxxxxxxxxxx

# MCP Servers (Cloud.ru)
AMOCRM_MCP_URL=https://amocrm-mcp.cloud.ru
MESSENGER_MAX_MCP_URL=https://max-mcp.cloud.ru
POSTGRES_MCP_URL=https://postgres-mcp.cloud.ru
GRAFANA_MCP_URL=https://grafana-mcp.cloud.ru
EVOLUTION_RAG_MCP_URL=https://rag-mcp.cloud.ru

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=

# Node
NODE_ENV=development
```

**Reusability:** Very High - adaptable for any Node.js full-stack app
**Customization Points:**
- Add/remove service credentials as needed
- Change database type (PostgreSQL → MySQL, etc.)
- Add feature flags
- Adjust port numbers
- Add log level, debug flags

---

## 11. Claude.md — Project Documentation Template

**Name:** Claude.md Project Context & Architecture
**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/CLAUDE.md` (1500+ lines)
**What it templates:** Comprehensive project documentation covering overview, architecture, tech stack, bounded contexts, constraints, fitness functions, git workflow, domain glossary, and automation commands.
**Parameterizable:** YES (highly customizable per project)
**Parameters:**
- Project name, vision, and value proposition
- Architecture pattern (monolith, microservices, etc.)
- Bounded Contexts (number, roles, folders)
- Tech stack versions (locked)
- Constraints and ADRs (Architectural Decision Records)
- Fitness functions (metrics that matter)
- Git workflow conventions
- Team automation commands

**Tech Stack:** Markdown
**Key Sections:**
- Project Overview (vision, differentiation)
- Architecture (pattern, services, event flow)
- Bounded Contexts table (BC ID, folder, role)
- MCP Integrations (if applicable)
- Tech Stack (locked versions)
- Folder Structure (standard per BC)
- Fitness Functions (CRITICAL, HIGH priority)
- Key Architectural Decisions
- Git Workflow (commit format, branch strategy)
- Domain Glossary (terminology)
- Feature Roadmap reference
- Available Commands & Agents
- Development Insights capture

**Reusability:** Very High — excellent template for any team project
**Customization Points:**
```markdown
# [Project Name] — [Tagline]

## Project Overview
[1 paragraph: transforms X into Y, core value, differentiation]

## Architecture
- Pattern: [monolith | microservices | serverless]
- Deploy: [how to deploy]
- Tech: [stack overview]

### Bounded Contexts
[List of BCs with roles]

### MCP Integrations (if applicable)
[External APIs/services]

## Tech Stack (locked versions)
```
Runtime: [version]
Frontend: [version]
Backend: [version]
Testing: [version]
Infra: [version]
```

## Fitness Functions
[Metrics that matter for this project]

## Key Architectural Decisions
[ADRs and their implications]

## Git Workflow
[Commit format, branch strategy]

## Domain Glossary
[Key terms defined]
```

---

## 12. Claude Settings Hooks Configuration

**Name:** Claude Code Session Hooks (SessionStart, Stop)
**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/.claude/settings.json`
**What it templates:** Configuration for session-level automation (running scripts on session start/stop, auto-committing changes).
**Parameterizable:** YES
**Parameters:**
- Hook triggers (SessionStart, Stop)
- File matchers (regex patterns)
- Commands to run (shell commands, Python scripts)
- Timeout values

**Tech Stack:** JSON, Shell scripting (bash, python)
**Key Features:**
- **SessionStart hooks** — runs before first turn (e.g., load project context)
- **Stop hooks** — runs on session end (e.g., auto-commit changes)
- **Matchers** — only run hook if certain files changed
- **Commands** — shell scripts or Python

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/feature-context.py",
            "timeout": 10000
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "feature-roadmap.json",
        "hooks": [
          {
            "type": "command",
            "command": "cd /workspaces/2026-jan-pu-Intercom-clone-02 && git add .claude/feature-roadmap.json && git commit -m 'chore: update feature roadmap' || true"
          }
        ]
      },
      {
        "matcher": "docs/plans/",
        "hooks": [
          {
            "type": "command",
            "command": "cd /workspaces/2026-jan-pu-Intercom-clone-02 && git add docs/plans/ && git commit -m 'docs: auto-save plans' || true"
          }
        ]
      }
    ]
  }
}
```

**Reusability:** Medium — useful for teams using Claude Code
**Customization Points:**
- Add SessionStart hook to run tests
- Add Stop hook to auto-commit specific folders
- Add matcher patterns for different file types
- Modify command timeouts based on hook complexity

---

## 13. Package.json Scripts & Dependencies

**Name:** Full-Stack Node.js Package Configuration
**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/package.json`
**What it templates:** Comprehensive package.json with dev/prod dependencies, scripts for dev/build/test/lint, and version constraints.
**Parameterizable:** YES
**Parameters:**
- Project name, version, description
- Scripts (dev, build, test, lint, deploy tasks)
- Dependencies (versions can be locked or ranges)
- Dev dependencies
- Engines (Node.js version requirement)

**Tech Stack:** Node.js 20, npm (or yarn/pnpm)
**Key Scripts:**
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:next\" \"npm run dev:api\"",
    "dev:next": "next dev --port 3000",
    "dev:api": "tsx watch src/server.ts",
    "build": "next build && tsc -p tsconfig.server.json",
    "start": "concurrently \"next start\" \"node dist/server.js\"",
    "test": "jest",
    "test:coverage": "jest --coverage",
    "lint": "next lint && eslint src/ --ext .ts,.tsx",
    "lint:arch": "eslint src/ --rule 'no-restricted-imports: error'",
    "typecheck": "tsc --noEmit",
    "db:migrate": "node scripts/migrate.js",
    "db:seed": "node scripts/seed.js",
    "fitness": "jest --testPathPattern=tests/fitness/",
    "fitness:critical": "jest --testPathPattern=tests/fitness/ -t 'CRITICAL'",
    "worker": "tsx src/worker.ts",
    "widget:build": "esbuild widget/src/index.ts --bundle --minify --outfile=public/widget.js"
  }
}
```

**Key Dependencies:**
```json
{
  "dependencies": {
    "express": "^4.19.2",
    "next": "14.2.14",
    "pg": "^8.11.5",
    "ioredis": "^5.3.2",
    "socket.io": "^4.7.5",
    "zod": "^3.22.5",
    "opossum": "^8.1.4"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.4",
    "tsx": "^4.11.0",
    "eslint": "^8.57.0"
  }
}
```

**Reusability:** Very High — standard for full-stack Node.js projects
**Customization Points:**
- Add/remove scripts for your workflow
- Lock specific versions or use ranges
- Add monorepo tools (lerna, turborepo)
- Include pre-commit hooks (husky)
- Add custom build steps

---

## Summary Table: Extraction by Reusability & Parameterization

| # | Name | File | Type | Reusability | Parameterizable | Tech |
|---|------|------|------|-------------|-----------------|------|
| 1 | Docker Compose Multi-Service | docker-compose.yml | Infra | Very High | YES (services, ports, volumes) | Docker |
| 2 | Multi-Stage Node.js Dockerfile | Dockerfile | Infra | High | YES (base image, user, ports) | Docker |
| 3 | TypeScript Config (Dual) | tsconfig.json, tsconfig.server.json | Config | Very High | YES (strict, aliases, target) | TypeScript |
| 4 | Jest Config with Coverage | jest.config.ts | Config | Very High | YES (thresholds, roots, matchers) | Jest |
| 5 | Next.js Config | next.config.js | Config | High | YES (output, external packages) | Next.js |
| 6 | Tailwind & PostCSS | tailwind.config.ts, postcss.config.js | Config | Very High | YES (content, theme, plugins) | Tailwind |
| 7 | Nginx Reverse Proxy | nginx/nginx.conf | Infra | Very High | YES (upstreams, rate limits, cache) | Nginx |
| 8 | .gitignore | .gitignore | Config | Very High | Minimal (static) | Git |
| 9 | DB Migrations (SQL) | migrations/*.sql | Schema | Very High | YES (per BC, columns, indexes) | PostgreSQL |
| 10 | .env.example | .env.example | Config | Very High | YES (all values) | Shell |
| 11 | Claude.md | CLAUDE.md | Docs | Very High | YES (project-specific) | Markdown |
| 12 | Settings Hooks | .claude/settings.json | Config | Medium | YES (hooks, matchers, commands) | JSON |
| 13 | Package.json | package.json | Config | Very High | YES (scripts, deps, versions) | npm |

---

## How to Use These Templates

### For New Projects:

1. **Infrastructure as Code:**
   - Copy `docker-compose.yml`, `Dockerfile`, `nginx.conf` — adjust service names, ports, volumes
   - Customize via environment variables (.env.example)

2. **TypeScript & Build:**
   - Copy `tsconfig.json`, `tsconfig.server.json` — adjust path aliases for your BCs
   - Copy `jest.config.ts` — adjust coverage thresholds
   - Copy `next.config.js`, `postcss.config.js`, `tailwind.config.ts`

3. **Database:**
   - Copy migration pattern (001_create_schemas.sql) — adapt for your BCs
   - Add RLS policies for multi-tenancy

4. **Git & CI/CD:**
   - Copy `.gitignore`, `package.json` scripts
   - Adapt commit format in `CLAUDE.md`

5. **Project Context:**
   - Copy `CLAUDE.md` structure — fill in your project details
   - Customize commands, fitness functions, and ADRs

### For Teams:

- Use `.claude/settings.json` as a template for session automation
- Adapt Domain Glossary section of `CLAUDE.md` for your domain language
- Reference Git Workflow section for consistent commit messages

### Maintenance:

- Keep versions in `package.json` and docker images up to date
- Review fitness functions quarterly
- Update CLAUDE.md when architecture changes
- Archive old migrations for audit trail

