# Infrastructure Guide

## Overview

KommuniK runs on a Russian VPS (HOSTKEY) to ensure 152-FZ data residency compliance. The infrastructure consists of PostgreSQL 16 for persistent storage, Redis 7 for caching and event streaming, and Nginx for reverse proxy and SSL termination.

## PostgreSQL 16

### Schema Organization

The database is organized into 6 schemas, one per Bounded Context:

| Schema | Tables | Purpose |
|--------|--------|---------|
| `conversation` | dialogs, messages, assignments | Message intake and routing |
| `pql` | pql_signals, pql_scores, pql_feedback, pql_rules | PQL detection and scoring |
| `revenue` | attributions, revenue_reports, report_lines | Revenue attribution and reporting |
| `integration` | mcp_configs, sync_logs, webhook_endpoints | MCP adapter configuration |
| `iam` | tenants, operators, api_keys, tenant_settings | Identity, access, multi-tenancy |
| `notifications` | notification_log, notification_settings | PQL Pulse and alerts |

### Row-Level Security (RLS)

Every table containing tenant data has RLS enabled. The middleware sets the tenant context before every query:

```sql
-- Set tenant context (done by middleware, never manually)
SET app.tenant_id = '<tenant-uuid>';

-- Example RLS policy on dialogs table
CREATE POLICY tenant_isolation ON conversation.dialogs
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Rules:**
- RLS is enforced on ALL tenant-scoped tables with no exceptions.
- The application NEVER passes `tenant_id` as a WHERE clause filter. RLS handles isolation.
- Integration tests verify that Tenant A cannot access Tenant B data.

### Migrations

Migrations are managed with a sequential numbering scheme:

```bash
# Run all pending migrations
npm run db:migrate

# Check migration status
npm run db:migrate:status

# Create a new migration
npm run db:migrate:create -- --name add_pql_feedback_table

# Rollback last migration
npm run db:migrate:rollback
```

Migration files are located in `src/shared/infrastructure/migrations/`.

### Connection pooling

```yaml
# docker-compose.yml excerpt
postgres:
  image: postgres:16-alpine
  environment:
    POSTGRES_MAX_CONNECTIONS: 100
    POSTGRES_SHARED_BUFFERS: 256MB
  volumes:
    - postgres_data:/var/lib/postgresql/data
```

Application-side pooling via `pg` library:

```typescript
const pool = new Pool({
  max: 20,              // max connections per worker
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

### Indexes

Key indexes for performance:

```sql
-- Dialog lookup by tenant and status
CREATE INDEX idx_dialogs_tenant_status ON conversation.dialogs(tenant_id, status);

-- PQL score lookup
CREATE INDEX idx_pql_scores_dialog ON pql.pql_scores(dialog_id);

-- Revenue attribution by tenant and period
CREATE INDEX idx_attributions_tenant_period ON revenue.attributions(tenant_id, attributed_at);

-- Message full-text search
CREATE INDEX idx_messages_content_gin ON conversation.messages USING gin(to_tsvector('russian', content));
```

## Redis 7

### Use cases

| Purpose | Key Pattern | TTL |
|---------|-------------|-----|
| Session cache | `session:{sessionId}` | 24h |
| Operator presence | `presence:{tenantId}:{operatorId}` | 60s (heartbeat) |
| Rate limiting | `ratelimit:{ip}:{endpoint}` | 60s |
| PQL cache | `pql:score:{dialogId}` | 1h |
| CRM context cache | `memory:{tenantId}:{clientEmail}` | 15min |

### Redis Streams

Redis Streams are used for asynchronous event processing:

```
Stream: events:messages       — MessageReceived events
Stream: events:pql            — PQLDetected events
Stream: events:revenue        — RevenueAttributed events
Stream: events:notifications  — NotificationRequested events
```

Consumer groups ensure each event is processed exactly once:

```bash
# Check stream info
redis-cli XINFO STREAM events:messages

# Check consumer group lag
redis-cli XINFO GROUPS events:messages

# Check pending messages
redis-cli XPENDING events:messages pql-detector-group
```

**Monitoring threshold (FF-08):** Stream lag must stay below 1000 messages.

### Configuration

```yaml
# docker-compose.yml excerpt
redis:
  image: redis:7-alpine
  command: >
    redis-server
    --appendonly yes
    --maxmemory 512mb
    --maxmemory-policy allkeys-lru
    --requirepass ${REDIS_PASSWORD}
  volumes:
    - redis_data:/data
```

## Nginx

### Reverse proxy configuration

```nginx
upstream app_backend {
    server app:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.ru;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://app_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    # API
    location /api/ {
        proxy_pass http://app_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static assets (Next.js)
    location /_next/static/ {
        proxy_pass http://app_backend;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    # Chat widget script
    location /widget.js {
        proxy_pass http://app_backend;
        expires 1h;
        add_header Cache-Control "public";
    }

    # Default
    location / {
        proxy_pass http://app_backend;
    }
}
```

### Rate limiting at Nginx level

```nginx
# Rate limit zones
limit_req_zone $binary_remote_addr zone=api:10m rate=100r/m;
limit_req_zone $binary_remote_addr zone=widget:10m rate=10r/m;

# Apply to locations
location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://app_backend;
}

location /api/widget/ {
    limit_req zone=widget burst=5 nodelay;
    proxy_pass http://app_backend;
}
```

## Monitoring

### Health checks

All services expose health checks used by Docker:

| Service | Check | Interval | Timeout |
|---------|-------|----------|---------|
| postgres | `pg_isready -U kommunik` | 10s | 5s |
| redis | `redis-cli ping` | 10s | 5s |
| app | `curl -f http://localhost:3000/api/health` | 30s | 10s |
| worker | Process alive check | 30s | 10s |

### Logging

All services output structured JSON to stdout/stderr. Docker Compose captures logs:

```bash
# Real-time logs
docker-compose logs -f

# Logs with timestamps
docker-compose logs -f -t

# Export logs to file
docker-compose logs --no-color > logs.txt
```

For centralized logging, configure a log driver in `docker-compose.yml`:

```yaml
services:
  app:
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"
```

### Grafana MCP

Connect Grafana MCP (Cloud.ru AI Fabric) for visual dashboards:

- API response times (p50, p95, p99).
- PQL detection latency (must stay under 2000ms p95 per FF-01).
- Redis Stream consumer lag (must stay under 1000 per FF-08).
- Active WebSocket connections per tenant.
- Database connection pool utilization.

## Backups

### PostgreSQL backup

```bash
# Full database dump
docker-compose exec postgres pg_dump -U kommunik -Fc kommunik > backup_$(date +%Y%m%d).dump

# Restore from dump
docker-compose exec -T postgres pg_restore -U kommunik -d kommunik < backup_20260115.dump

# Automated daily backup (add to crontab)
0 3 * * * cd /opt/kommunik && docker-compose exec -T postgres pg_dump -U kommunik -Fc kommunik > /backups/kommunik_$(date +\%Y\%m\%d).dump
```

### Redis backup

Redis is configured with AOF (Append Only File) persistence:

```bash
# Manual save
docker-compose exec redis redis-cli BGSAVE

# Backup AOF file
cp redis_data/appendonly.aof /backups/redis_aof_$(date +%Y%m%d).aof
```

### Backup retention

Recommended retention policy:

| Type | Frequency | Retention |
|------|-----------|-----------|
| PostgreSQL full dump | Daily at 03:00 | 30 days |
| PostgreSQL WAL | Continuous | 7 days |
| Redis AOF | Continuous | 7 days |

## Scaling

### Horizontal scaling

The `worker` service can be scaled independently:

```bash
# Scale workers to 3 instances
docker-compose up -d --scale worker=3
```

Each worker instance joins the Redis Stream consumer group, so events are distributed automatically.

### Vertical scaling guidelines

| Service | Minimum | Recommended | High Load |
|---------|---------|-------------|-----------|
| app | 1 CPU, 1GB RAM | 2 CPU, 2GB RAM | 4 CPU, 4GB RAM |
| worker | 1 CPU, 512MB RAM | 2 CPU, 1GB RAM | 2 CPU, 2GB RAM |
| postgres | 1 CPU, 1GB RAM | 2 CPU, 4GB RAM | 4 CPU, 8GB RAM |
| redis | 1 CPU, 256MB RAM | 1 CPU, 512MB RAM | 2 CPU, 1GB RAM |
| nginx | 1 CPU, 128MB RAM | 1 CPU, 256MB RAM | 1 CPU, 512MB RAM |

### Connection limits

| Resource | Limit | Configurable Via |
|----------|-------|-----------------|
| PostgreSQL connections | 100 | `POSTGRES_MAX_CONNECTIONS` |
| Redis connections | 10000 | `maxclients` in redis.conf |
| WebSocket connections | 10000/instance | `WS_MAX_CONNECTIONS` env var |
| Nginx worker connections | 1024 | `worker_connections` in nginx.conf |
