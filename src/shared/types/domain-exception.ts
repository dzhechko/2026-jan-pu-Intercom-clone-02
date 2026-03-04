/**
 * Base exception for domain rule violations.
 * Reference: docs/ai-context.md — coding-standards
 */
export class DomainException extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DomainException'
  }
}
