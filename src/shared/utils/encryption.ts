/**
 * AES-256-GCM encryption for API keys stored in TenantSettings.
 * Reference: docs/refinement.md SH-01
 *
 * ENCRYPTION_KEY from environment variable — NEVER stored in DB.
 * Keys decrypted only at MCP request time, zeroed immediately after.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

export interface EncryptedValue {
  encrypted: string  // base64
  iv: string         // base64
  authTag: string    // base64
}

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required')
  }
  return Buffer.from(key, 'hex')
}

export function encrypt(plaintext: string): EncryptedValue {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}

export function decrypt(value: EncryptedValue): string {
  const key = getEncryptionKey()
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(value.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(value.authTag, 'base64'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(value.encrypted, 'base64')),
    decipher.final(),
  ])

  return decrypted.toString('utf-8')
}
