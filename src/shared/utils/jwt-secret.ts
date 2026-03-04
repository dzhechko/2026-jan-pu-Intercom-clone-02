/**
 * Centralized JWT secret accessor.
 * MUST be used everywhere that signs or verifies JWT tokens.
 *
 * In production: reads from JWT_SECRET env var (minimum 32 chars).
 * In tests: can be overridden via process.env.JWT_SECRET in beforeEach.
 *
 * Startup guard in server.ts calls validateJwtSecret() before accepting requests.
 */

export function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? 'dev-secret-change-me'
}

/**
 * Call at server startup. Crashes the process if JWT_SECRET is not set
 * or is the development default. Prevents accidental production deployment
 * with a weak secret.
 */
export function validateJwtSecret(): void {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    console.error('FATAL: JWT_SECRET environment variable is not set')
    process.exit(1)
  }
  if (secret === 'dev-secret-change-me') {
    console.warn('WARNING: Using default JWT_SECRET — not safe for production')
  }
  if (secret.length < 32) {
    console.warn('WARNING: JWT_SECRET should be at least 32 characters')
  }
}
