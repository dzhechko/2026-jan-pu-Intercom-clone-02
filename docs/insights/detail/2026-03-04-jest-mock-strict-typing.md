# Jest Mock Strict Typing — Use mockResolvedValue

**Date:** 2026-03-04 | **Area:** testing | **Type:** pattern

## Problem
With TypeScript strict mode, `jest.fn(async () => value)` does NOT satisfy `jest.Mocked<T>` when the interface method has parameters. The mock's `MockContext` types don't match.

```typescript
// FAILS with strict: true
const repo: jest.Mocked<MyRepo> = {
  findById: jest.fn(async () => null),  // TS2322
}
```

Error: `Mock<Promise<null>, [], unknown>` is not assignable to `MockInstance<Promise<Entity | null>, [id: string], unknown>`

## Solution
Use `.mockResolvedValue()` or `.mockImplementation()` instead:

```typescript
// WORKS
const repo: jest.Mocked<MyRepo> = {
  findById: jest.fn().mockResolvedValue(null),
}

// Also works when you need the param
const repo: jest.Mocked<MyRepo> = {
  save: jest.fn().mockImplementation(async (entity) => entity),
}
```

## Why
`jest.fn()` without type params returns `Mock<any, any>` which is assignable to any mock type. Adding `async () => value` narrows the type to `Mock<Promise<T>, [], unknown>` where `[]` (no params) conflicts with the interface's parameter types.

## Affected Files (fixed)
- `notification-service.test.ts`
- `pql-detector-service.test.ts`
- `ml-model-service.test.ts`
- `revenue-report-service.test.ts`
- `auto-attribution-service.test.ts`
