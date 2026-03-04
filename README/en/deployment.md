# Deployment Guide

## Overview

KommuniK is deployed as a set of Docker containers managed by Docker Compose on a VPS (HOSTKEY) within Russian infrastructure to comply with 152-FZ data residency requirements.

## Services

The platform consists of 5 Docker services:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `app` | Node 20 + Next.js 14 | 3000 | API server, WebSocket, SSR frontend |
| `worker` | Node 20 | — | Redis Stream consumers, PQL detection, event handlers |
| `postgres` | PostgreSQL 16-alpine | 5432 | Primary database with RLS |
| `redis` | Redis 7-alpine | 6379 | Cache, streams, presence, rate limiting |
| `nginx` | Nginx 1.25-alpine | 80/443 | Reverse proxy, SSL termination, static assets |

## Environment Variables

Create a `.env` file in the project root before starting:

```bash
# Application
NODE_ENV=production
APP_PORT=3000
APP_URL=https://your-domain.ru

# Database
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=kommunik
POSTGRES_USER=kommunik
POSTGRES_PASSWORD=<strong-password>

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=<strong-password>

# Authentication
JWT_SECRET=<64-char-random-string>
JWT_EXPIRES_IN=24h

# Encryption (for API keys stored in DB)
ENCRYPTION_KEY=<32-byte-hex-string>

# Telegram Bot
TELEGRAM_BOT_TOKEN=<bot-token-from-botfather>
TELEGRAM_WEBHOOK_SECRET=<random-secret>

# amoCRM MCP
AMOCRM_MCP_URL=https://mcp.cloud.ru/amocrm
AMOCRM_MCP_TOKEN=<cloud-ru-token>

# VK Max MCP
MAX_MCP_URL=https://mcp.cloud.ru/max
MAX_MCP_TOKEN=<cloud-ru-token>

# Email (Resend — metadata only, no PII)
RESEND_API_KEY=<resend-api-key>
EMAIL_FROM=noreply@your-domain.ru

# Logging
LOG_LEVEL=info
```

**Security notes:**
- Never commit `.env` to version control.
- `ENCRYPTION_KEY` is used for AES-256-GCM encryption of tenant API keys.
- `JWT_SECRET` should be at least 64 characters of random data.

## Startup

### First-time setup

```bash
# Clone the repository
git clone <repo-url> kommunik
cd kommunik

# Copy and edit environment variables
cp .env.example .env
nano .env

# Build and start all services
docker-compose up -d --build

# Run database migrations
docker-compose exec app npm run db:migrate

# Verify all services are running
docker-compose ps
```

### Startup order

Docker Compose handles dependency ordering:

1. `postgres` and `redis` start first (no dependencies).
2. `app` starts after `postgres` and `redis` are healthy.
3. `worker` starts after `postgres` and `redis` are healthy.
4. `nginx` starts after `app` is healthy.

### Restart

```bash
# Restart all services
docker-compose restart

# Restart a single service
docker-compose restart app

# Rebuild and restart after code changes
docker-compose up -d --build app worker
```

## Health Check

The application exposes a health endpoint:

```bash
curl https://your-domain.ru/api/health
```

Expected response:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "redis": "connected",
    "worker": "running"
  },
  "uptime": 3600
}
```

Docker health checks are configured for each service in `docker-compose.yml`:

- **postgres:** `pg_isready -U kommunik`
- **redis:** `redis-cli ping`
- **app:** `curl -f http://localhost:3000/api/health`

## Database Migrations

```bash
# Run pending migrations
docker-compose exec app npm run db:migrate

# Check migration status
docker-compose exec app npm run db:migrate:status

# Rollback last migration
docker-compose exec app npm run db:migrate:rollback
```

Migrations create 6 schemas corresponding to the Bounded Contexts and enable Row-Level Security on all tenant-scoped tables.

## SSL/TLS via Nginx

Nginx handles SSL termination. Place your certificates in the mapped volume:

```bash
# Directory structure
ssl/
  cert.pem        # Full certificate chain
  key.pem         # Private key
```

Nginx configuration snippet (included in `nginx/nginx.conf`):

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.ru;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

For automatic certificate renewal, use certbot with the webroot plugin:

```bash
certbot certonly --webroot -w /var/www/certbot -d your-domain.ru
```

## Monitoring and Logging

### Log access

```bash
# View logs for all services
docker-compose logs -f

# View logs for a specific service
docker-compose logs -f app
docker-compose logs -f worker

# View last 100 lines
docker-compose logs --tail=100 app
```

### Log format

All services output structured JSON logs:

```json
{
  "level": "info",
  "timestamp": "2026-01-15T10:30:00Z",
  "service": "app",
  "tenantId": "uuid",
  "message": "PQL detected",
  "metadata": { "dialogId": "uuid", "score": 0.85 }
}
```

### Monitoring with Grafana MCP

Grafana MCP (Cloud.ru AI Fabric) can be connected for dashboards:

```bash
# Environment variable for Grafana MCP
GRAFANA_MCP_URL=https://mcp.cloud.ru/grafana
GRAFANA_MCP_TOKEN=<cloud-ru-token>
```

### Resource monitoring

```bash
# Check container resource usage
docker stats

# Check disk usage
docker system df
```

## Updating

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose up -d --build app worker

# Run any new migrations
docker-compose exec app npm run db:migrate
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| App fails to start | Database not ready | Check `docker-compose logs postgres` |
| WebSocket disconnects | Nginx timeout | Increase `proxy_read_timeout` in nginx.conf |
| PQL detection slow | Redis Stream lag | Check `docker-compose logs worker`, scale workers |
| 502 Bad Gateway | App crashed | `docker-compose restart app`, check logs |
| RLS errors | Missing tenant context | Verify JWT middleware sets `app.tenant_id` |
