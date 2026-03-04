# Coding Style — КоммуниК

## TypeScript
- `strict: true` in tsconfig
- Explicit types for domain events and aggregates
- FORBIDDEN: `any`, `as any`, `@ts-ignore` without justification comment
- Value Objects: readonly fields, no setters
- Use `zod` for all API input validation

## Naming Conventions

| Entity | Pattern | Example |
|--------|---------|---------|
| Aggregate | PascalCase, noun | `Dialog`, `PQLDetector` |
| Domain Event | PascalCase, past tense | `MessageReceived`, `PQLDetected` |
| Application Service | PascalCase + "Service" | `PQLDetectorService` |
| Port interface | PascalCase + "Port" | `CRMPort`, `RAGPort` |
| MCP Adapter | PascalCase + "MCPAdapter" | `AmoCRMMCPAdapter` |
| Repository | PascalCase + "Repository" | `DialogRepository` |
| Value Object | PascalCase, noun | `PQLScore`, `MemoryContext` |

## Domain Language (mandatory)
- "Dialog" — NOT "chat" or "conversation object"
- "PQL Score" — NOT "lead score"
- "Operator" — NOT "user" (for support agents)
- "Client" — NOT "user" (for end users who write in chat)
- "Tenant" — NOT "customer" (for companies using КоммуниК)
- "MCP Adapter" — NOT "integration" (for BC-04 adapters)

## File Structure (per BC)
```
src/{bc-name}/
  domain/aggregates/     — Aggregate Root classes
  domain/events/         — Domain Event types
  domain/ports/          — Interface definitions
  domain/value-objects/  — Value Objects (readonly)
  application/services/  — Use case orchestration
  application/handlers/  — Event handlers (Redis Stream consumers)
  infrastructure/repositories/ — DB implementations
  infrastructure/adapters/     — MCP adapters (BC-04 only)
```

## Error Handling
- Domain errors: `throw new DomainException(code, message)`
- MCP errors: catch → Circuit Breaker → return `Result<T, Error>`
- NEVER propagate MCP errors into domain layer
- NEVER swallow errors silently — always log

## Imports
- Cross-BC imports FORBIDDEN (FF-02)
- Allowed shared imports: `shared/events/*`, `shared/middleware/*`, `shared/utils/*`
- Within BC: domain layer must not import from infrastructure
