# /deploy $ARGUMENTS — Deployment Workflow

## Role
Deploy КоммуниК to target environment.

## Input
`$ARGUMENTS` — environment: "local", "staging", "production"

## Environments

| Env | Target | Method |
|-----|--------|--------|
| `local` | Local Docker Compose | `docker compose up -d` |
| `staging` | VPS HOSTKEY (staging) | SSH + Docker Compose |
| `production` | VPS HOSTKEY (prod) | SSH + Docker Compose |

## Process

### Pre-Deploy Checks (run in parallel)

1. **Tests pass:** `npm test`
2. **Fitness critical:** `npm run fitness:critical`
3. **Type check:** `npx tsc --noEmit`
4. **Lint:** `npm run lint`
5. **Build:** `npm run build`
6. **Docker build:** `docker compose build`

### Local Deploy

```bash
docker compose up -d
docker compose ps          # verify all healthy
docker compose logs -f app # watch logs
```

### Remote Deploy (staging/production)

```bash
# 1. Build and tag
docker compose build
docker tag kommuniq-app:latest registry/kommuniq-app:${VERSION}
docker push registry/kommuniq-app:${VERSION}

# 2. Deploy via SSH
ssh ${HOST} "cd /opt/kommuniq && docker compose pull && docker compose up -d"

# 3. Verify
ssh ${HOST} "docker compose ps"
ssh ${HOST} "curl -f http://localhost:3000/api/health"
```

### Post-Deploy

1. Run DB migrations if needed
2. Verify health endpoints
3. Check Grafana MCP dashboard (if configured)
4. Monitor Redis Stream lag (FF-08)

### Rollback

```bash
ssh ${HOST} "cd /opt/kommuniq && docker compose pull previous-tag && docker compose up -d"
```

## Data Residency (FF-10)
ALL deployments MUST be on Russian VPS (HOSTKEY/AdminVPS).
NEVER deploy to non-Russian infrastructure for production data.
