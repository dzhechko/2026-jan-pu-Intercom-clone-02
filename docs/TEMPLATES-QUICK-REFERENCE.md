# Template Quick Reference — КоммуниК

Fast lookup guide for copying and customizing КоммуниК templates to new projects.

---

## 1. Docker Compose — Copy & Customize Checklist

**Source:** `/workspaces/2026-jan-pu-Intercom-clone-02/docker-compose.yml`

**Quick Copy:**
```bash
cp docker-compose.yml ../new-project/
```

**Customize For Your Project:**
- [ ] Change service names (`app`, `worker`, `postgres`, `redis` → your names)
- [ ] Update environment variables (database name, user, password)
- [ ] Adjust volumes (postgres_data, redis_data → your naming)
- [ ] Modify ports if conflicts (3000, 4000, 5432, 6379)
- [ ] Update health check endpoints if different
- [ ] Adjust Redis maxmemory and policy for your load profile

**Template Sections to Modify:**
```yaml
# Change these:
services:
  app:  # YOUR_APP_NAME
    environment:
      - DATABASE_URL=postgresql://YOUR_USER:YOUR_PASS@postgres:5432/YOUR_DB

volumes:
  postgres_data:  # or: postgres-volumes, db-data, etc.
  redis_data:     # or: cache-volumes, etc.
```

**Dependencies:** docker, docker-compose

---

## 2. Dockerfile — Copy & Customize Checklist

**Source:** `/workspaces/2026-jan-pu-Intercom-clone-02/Dockerfile`

**Quick Copy:**
```bash
cp Dockerfile ../new-project/
```

**Customize For Your Project:**
- [ ] Change `node:20-alpine` if using different Node version
- [ ] Update app user name (kommuniq → your-app-name)
- [ ] Modify build command if different (`npm run build` → `yarn build`, etc.)
- [ ] Adjust COPY paths based on your build output folders
- [ ] Update EXPOSE ports (3000, 4000) to match your app
- [ ] Change CMD if startup is different

**Key Customization Points:**
```dockerfile
# Change base image
FROM node:22-alpine AS deps  # or node:20-slim, node:21, etc.

# Change app user
RUN adduser --system --uid 1001 your-app-name

# Adjust build step
RUN npm run build  # or: pnpm build, yarn build

# Modify exposed ports
EXPOSE 8080 9000  # instead of 3000 4000
```

**Verification:**
```bash
docker build -t your-app:latest .
docker run -it your-app:latest npm start
```

---

## 3. TypeScript — Copy & Customize Checklist

**Source:**
- `/workspaces/2026-jan-pu-Intercom-clone-02/tsconfig.json` (frontend)
- `/workspaces/2026-jan-pu-Intercom-clone-02/tsconfig.server.json` (backend)

**Quick Copy:**
```bash
cp tsconfig.json ../new-project/
cp tsconfig.server.json ../new-project/
```

**Customize For Your Project:**

**Frontend tsconfig.json:**
- [ ] Add/remove BCs from `paths` based on your folder structure
- [ ] Change `lib` if not using DOM (server-only app)
- [ ] Adjust `jsx` setting (preserve, react-jsx, react, etc.)
- [ ] Include/exclude paths matching your project layout

**Backend tsconfig.server.json:**
- [ ] Add/remove BCs from `paths`
- [ ] Adjust `outDir` if not using `./dist`
- [ ] Modify `include`/`exclude` patterns

**Template Customization:**
```json
// Update path aliases for your BCs:
"paths": {
  "@shared/*": ["./src/shared/*"],
  "@api/*": ["./src/api/*"],        // ADD your BCs
  "@auth/*": ["./src/auth/*"],      // ADD your BCs
  "@database/*": ["./src/database/*"] // ADD your BCs
}
```

**Verification:**
```bash
npx tsc --noEmit  # Check for type errors
```

---

## 4. Jest — Copy & Customize Checklist

**Source:** `/workspaces/2026-jan-pu-Intercom-clone-02/jest.config.ts`

**Quick Copy:**
```bash
cp jest.config.ts ../new-project/
```

**Customize For Your Project:**
- [ ] Update `roots` to match your test folders
- [ ] Adjust `testMatch` patterns if using different naming (.test.js vs .spec.js)
- [ ] Update `moduleNameMapper` for your path aliases
- [ ] Modify `coverageThreshold` for your standards (global, per-module)
- [ ] Change `testEnvironment` if needed (node → jsdom for React)

**Common Customizations:**
```typescript
// Adjust coverage thresholds for maturity level:
// For MVP:
coverageThreshold: { global: { lines: 50 } }

// For production:
coverageThreshold: { global: { lines: 80 } }

// For critical domains:
coverageThreshold: {
  global: { lines: 70 },
  'src/auth/': { lines: 95 },        // ADD per-domain rules
  'src/payment/': { lines: 95 },     // ADD per-domain rules
}
```

**Verification:**
```bash
npm test -- --coverage
```

---

## 5. Next.js — Copy & Customize Checklist

**Source:** `/workspaces/2026-jan-pu-Intercom-clone-02/next.config.js`

**Quick Copy:**
```bash
cp next.config.js ../new-project/
```

**Customize For Your Project:**
- [ ] Keep `output: 'standalone'` if using Docker
- [ ] Add/remove database drivers from `serverComponentsExternalPackages`
- [ ] Add environment variables if needed
- [ ] Add redirects, rewrites if using API routes

**Common Additions:**
```javascript
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['pg', 'redis', 'ioredis'],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
  // Add redirects for auth:
  async redirects() {
    return [
      { source: '/login', destination: '/auth/login', permanent: false },
    ]
  },
}
```

---

## 6. Tailwind + PostCSS — Copy & Customize Checklist

**Source:**
- `/workspaces/2026-jan-pu-Intercom-clone-02/tailwind.config.ts`
- `/workspaces/2026-jan-pu-Intercom-clone-02/postcss.config.js`

**Quick Copy:**
```bash
cp tailwind.config.ts ../new-project/
cp postcss.config.js ../new-project/
```

**Customize For Your Project:**
- [ ] Update `content` paths to match your structure
- [ ] Extend `theme` with custom colors, fonts, spacing if needed
- [ ] Add Tailwind plugins if required (forms, daisyui, etc.)

**Common Customizations:**
```typescript
// Extend with brand colors:
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0066cc',
        secondary: '#ff6600',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),  // Add form plugin
  ],
}
```

---

## 7. Nginx — Copy & Customize Checklist

**Source:** `/workspaces/2026-jan-pu-Intercom-clone-02/nginx/nginx.conf`

**Quick Copy:**
```bash
mkdir -p ../new-project/nginx
cp nginx/nginx.conf ../new-project/nginx/
```

**Customize For Your Project:**
- [ ] Update upstream server addresses (app:3000, api:4000)
- [ ] Adjust rate limits based on expected load
- [ ] Modify cache duration for static assets
- [ ] Add SSL cert paths for production
- [ ] Update health check endpoint path

**Production Checklist:**
```nginx
# Add SSL (uncomment and point to real certs):
listen 443 ssl http2;
ssl_certificate /etc/nginx/ssl/cert.pem;
ssl_certificate_key /etc/nginx/ssl/key.pem;

# Redirect HTTP to HTTPS:
server {
  listen 80;
  return 301 https://$host$request_uri;
}

# Add security headers:
add_header X-Frame-Options "SAMEORIGIN";
add_header X-Content-Type-Options "nosniff";
add_header X-XSS-Protection "1; mode=block";
```

---

## 8. .gitignore — Copy & Customize Checklist

**Source:** `/workspaces/2026-jan-pu-Intercom-clone-02/.gitignore`

**Quick Copy:**
```bash
cp .gitignore ../new-project/
```

**Customize For Your Project:**
- [ ] Add project-specific folders to ignore
- [ ] Remove unused sections (e.g., if not using Docker)
- [ ] Add sensitive file patterns

**Common Additions:**
```gitignore
# Project-specific
/uploads/
/temp/
/cache/

# IDE
.vscode/
.idea/
*.sublime-project

# Sensitive data
.env
.env.*.local
*.pem
*.key
secrets/

# OS
.DS_Store
Thumbs.db
```

---

## 9. Database Migrations — Copy & Customize Checklist

**Source:** `/workspaces/2026-jan-pu-Intercom-clone-02/migrations/`

**Quick Copy:**
```bash
mkdir -p ../new-project/migrations
cp migrations/001_create_schemas.sql ../new-project/migrations/
```

**Customize For Your Project:**

**Step 1: Create schemas (001_create_schemas.sql)**
```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- One schema per Bounded Context:
CREATE SCHEMA IF NOT EXISTS your_bc_1;
CREATE SCHEMA IF NOT EXISTS your_bc_2;
```

**Step 2: Create BC tables (002_*.sql, 003_*.sql, etc.)**
- [ ] Define tables with `tenant_id` for multi-tenancy
- [ ] Use UUID primary keys
- [ ] Add JSONB for flexible data
- [ ] Create indexes (single-column, composite, conditional)
- [ ] Enable RLS with `tenant_id` policy

**Template:**
```sql
-- Migration 002: Your BC
CREATE TABLE your_schema.your_table (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES iam.tenants(id),
  name          VARCHAR(255) NOT NULL,
  data          JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_your_table_tenant ON your_schema.your_table(tenant_id);

-- RLS
ALTER TABLE your_schema.your_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON your_schema.your_table
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

**Verification:**
```bash
node scripts/migrate.js  # Run migrations
psql -U your_user -d your_db -c "\dt+"  # List tables
```

---

## 10. .env.example — Copy & Customize Checklist

**Source:** `/workspaces/2026-jan-pu-Intercom-clone-02/.env.example`

**Quick Copy:**
```bash
cp .env.example ../new-project/
cp .env.example ../new-project/.env.development.local
```

**Customize For Your Project:**
- [ ] Update database URL (host, user, password, database name)
- [ ] Update Redis URL
- [ ] Generate random JWT_SECRET (use `openssl rand -hex 32`)
- [ ] Generate random ENCRYPTION_KEY (use `openssl rand -hex 16`)
- [ ] Add your API keys (third-party services)
- [ ] Update server ports if different
- [ ] Add feature flags if applicable

**Script to Generate Secrets:**
```bash
# Generate JWT_SECRET
openssl rand -hex 32

# Generate ENCRYPTION_KEY (16 bytes = 32 hex chars)
openssl rand -hex 16

# Generate random password
openssl rand -base64 16
```

**Template:**
```bash
# Copy from .env.example
cp .env.example .env.development.local
cp .env.example .env.production

# Then edit and fill in:
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASS@YOUR_HOST:5432/YOUR_DB
REDIS_URL=redis://YOUR_REDIS_HOST:6379
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
```

---

## 11. Claude.md — Copy & Customize Checklist

**Source:** `/workspaces/2026-jan-pu-Intercom-clone-02/CLAUDE.md`

**Quick Copy:**
```bash
cp CLAUDE.md ../new-project/
```

**Customize For Your Project:**
- [ ] Update project name, tagline, vision
- [ ] Describe value proposition
- [ ] List Bounded Contexts specific to your domain
- [ ] Update architecture pattern and deploy method
- [ ] Lock tech stack versions
- [ ] Define fitness functions for your metrics
- [ ] List key ADRs
- [ ] Customize git workflow
- [ ] Create domain glossary for your terminology

**Template Structure:**
```markdown
# [Your Project] — [Tagline]

## Project Overview
[1 paragraph elevator pitch]

## Architecture
- Pattern: [monolith/microservices]
- Deploy: [Docker Compose/K8s]
- Stack: [list tech]

### Bounded Contexts
[Your BCs with folders and roles]

## Tech Stack (locked versions)
Runtime: [version]
Frontend: [version]
Backend: [version]
Testing: [version]
Infra: [version]

## Fitness Functions
[Metrics for your project]

## Key Architectural Decisions
[ADRs: 1-10 key decisions]

## Git Workflow
[Commit format, branch strategy]

## Domain Glossary
[Your domain-specific terms]

## Available Commands
[Automation for your team]
```

---

## 12. Settings Hooks — Copy & Customize Checklist

**Source:** `/workspaces/2026-jan-pu-Intercom-clone-02/.claude/settings.json`

**Quick Copy:**
```bash
mkdir -p ../new-project/.claude
cp .claude/settings.json ../new-project/.claude/
```

**Customize For Your Project:**
- [ ] Add SessionStart hook to load project context
- [ ] Add Stop hooks to auto-commit specific folders
- [ ] Adjust file matchers for your files
- [ ] Modify command timeouts based on complexity

**Common Patterns:**
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/context.py",
            "timeout": 5000
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "src/",
        "hooks": [
          {
            "type": "command",
            "command": "cd /your-project && git add src/ && git commit -m 'auto: code changes' || true"
          }
        ]
      }
    ]
  }
}
```

---

## 13. Package.json — Copy & Customize Checklist

**Source:** `/workspaces/2026-jan-pu-Intercom-clone-02/package.json`

**Quick Copy:**
```bash
cp package.json ../new-project/
cp package-lock.json ../new-project/
```

**Customize For Your Project:**
- [ ] Update name, version, description
- [ ] Add/remove scripts for your workflow
- [ ] Adjust dependency versions (locked vs range)
- [ ] Add dev dependencies
- [ ] Update Node.js engine requirement

**Common Customizations:**
```json
{
  "name": "your-project",
  "version": "0.1.0",
  "description": "Your project description",
  "scripts": {
    "dev": "your-dev-script",
    "build": "your-build-script",
    "test": "jest",
    "lint": "eslint src/"
  },
  "dependencies": {
    "express": "^4.19.2",
    "next": "14.2.14"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "jest": "^29.7.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Install Dependencies:**
```bash
npm ci  # Use package-lock for reproducible builds
npm install  # Update packages
npm update  # Check for updates
```

---

## Quick Start Script — New Project Setup

**Copy all templates at once:**

```bash
#!/bin/bash

# Create new project
mkdir new-project && cd new-project
git init
mkdir -p .claude/hooks migrations nginx src tests

# Copy templates
cp ../kommuniq-project/docker-compose.yml .
cp ../kommuniq-project/Dockerfile .
cp ../kommuniq-project/tsconfig*.json .
cp ../kommuniq-project/jest.config.ts .
cp ../kommuniq-project/next.config.js .
cp ../kommuniq-project/postcss.config.js .
cp ../kommuniq-project/tailwind.config.ts .
cp ../kommuniq-project/.gitignore .
cp ../kommuniq-project/.env.example .
cp ../kommuniq-project/CLAUDE.md .
cp ../kommuniq-project/.claude/settings.json ./.claude/
cp ../kommuniq-project/package.json .
cp ../kommuniq-project/nginx/nginx.conf ./nginx/
cp ../kommuniq-project/migrations/001_create_schemas.sql ./migrations/

# Install dependencies
npm ci

# Run initial setup
npm run typecheck
npm test -- --passWithNoTests

echo "New project initialized! Customize CLAUDE.md next."
```

---

## Troubleshooting Template Usage

| Problem | Solution |
|---------|----------|
| Ports conflict | Modify docker-compose.yml, next.config.js, nginx.conf |
| Path aliases not working | Update tsconfig.json and jest.config.ts with your BCs |
| Database migrations fail | Check migration syntax, ensure postgres is running |
| Tests fail after copy | Update moduleNameMapper in jest.config.ts for your paths |
| Docker build fails | Check Dockerfile base image and COPY paths match your structure |
| .env vars not loading | Verify .env file is in project root, not in git |
| RLS policies not working | Ensure `SET app.tenant_id` is called before DB queries |

---

## When to Refer to Full Extraction Document

Refer to **TEMPLATE-EXTRACTION.md** for:
- Detailed feature descriptions of each template
- How each template enforces architectural constraints
- Advanced customization options
- Pattern explanations and rationale
- Reusability notes and gotchas

Use **TEMPLATES-QUICK-REFERENCE.md** (this file) for:
- Copy-paste commands
- Quick customization checklists
- Common modifications
- Verification steps
- Troubleshooting

