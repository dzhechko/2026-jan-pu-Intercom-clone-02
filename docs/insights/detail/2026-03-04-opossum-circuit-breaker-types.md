# Insight: Opossum CircuitBreaker.fire() returns unknown — needs explicit casting

**Date:** 2026-03-04 | **Area:** integration | **Category:** pattern

## Context
Implementing AmoCRMMCPAdapter with opossum Circuit Breaker. TypeScript errors on `this.breaker.fire()` return type.

## Insight
`CircuitBreaker.fire()` returns `Promise<unknown>` in @types/opossum. When the wrapped function returns `Result<T>`, you must cast: `await this.breaker.fire({...}) as Result<any>`. This is safe because we control the wrapped `callMCP` method.

Also: `@types/opossum` is a separate package from `opossum` — must install both.

## Impact
Pattern for all future MCP adapters: always cast `breaker.fire()` result to expected type. Consider creating a typed wrapper: `TypedCircuitBreaker<TInput, TOutput>` if many adapters are needed.
