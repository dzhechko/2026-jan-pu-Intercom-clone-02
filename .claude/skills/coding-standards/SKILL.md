---
name: coding-standards
description: >
  КоммуниК tech-specific coding patterns and standards.
  DDD folder structure, TypeScript conventions, domain language enforcement.
version: "1.0"
maturity: production
---

# Coding Standards: КоммуниК

## Tech Stack
- Node.js 20.x LTS + TypeScript 5.4.x (strict: true)
- Next.js 14.2.x (App Router) + Tailwind 3.4.x + shadcn/ui
- Express 4.19.x + Socket.io 4.7.x
- PostgreSQL 16 (schema-per-BC, RLS)
- Redis 7 (Streams, Sessions)
- opossum 8.1.x (Circuit Breaker)
- zod 3.22.x (validation)

## DDD Folder Structure
```
src/{bc-name}/
  domain/
    aggregates/       # PascalCase class files
    events/           # PascalCase, past tense
    ports/            # PascalCase + "Port"
    value-objects/    # readonly, immutable
  application/
    services/         # PascalCase + "Service"
    handlers/         # Redis Stream consumers
  infrastructure/
    repositories/     # DB implementations
    adapters/         # MCP adapters (BC-04 only)
```

## Cross-BC Communication
- ALLOWED: Redis Streams (domain events), Port interfaces
- ALLOWED: shared/events/* (event type definitions)
- FORBIDDEN: Direct imports between BCs (FF-02)

## MCP Adapter Pattern (mandatory)
```typescript
interface CRMPort {
  getContactContext(email: string): Promise<Result<ContactContext>>
}

class AmoCRMMCPAdapter implements CRMPort {
  private circuitBreaker = new CircuitBreaker(fn, {
    timeout: 2000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
  })
  // ACL: translate MCP types → domain types
}
```

## Tenant Middleware (mandatory)
```typescript
// Every request must set tenant context for RLS
app.use(async (req, res, next) => {
  const tenantId = extractFromJWT(req)
  await db.query(`SET app.tenant_id = '${tenantId}'`)
  next()
})
```

## Error Types
- `DomainException` — domain rule violations
- `Result<T, Error>` — for MCP/external operations
- Never throw MCP errors into domain layer
