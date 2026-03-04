# Socket.io Server Has No .toRoom() — Wrap It

**Date:** 2026-03-04 | **Area:** integration | **Type:** gotcha

## Problem
When defining a `PushEmitter` interface for dependency injection:

```typescript
interface PushEmitter {
  toRoom(room: string): { emit(event: string, payload: unknown): void }
}
```

Socket.io's `Server` class doesn't have `.toRoom()`. It uses `.to(room).emit()`.

Passing `io` directly as `PushEmitter` causes `TS2741: Property 'toRoom' is missing`.

## Solution
Wrap the Socket.io server with an adapter object:

```typescript
const notificationService = new NotificationService({
  pushEmitter: { toRoom: (room: string) => io.to(room) },
})
```

## Why Not Change the Interface?
The `PushEmitter` interface is a domain port — it shouldn't depend on Socket.io's API shape. The wrapper keeps the infrastructure adapter pattern clean (hexagonal architecture).
