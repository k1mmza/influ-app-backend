import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Encrypts/decrypts sensitive strings (PlatformAccount OAuth access/refresh
 * tokens) at rest with AES-256-GCM.
 *
 * Stored format:  v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 *   - v1        version tag, lets us rotate the scheme later
 *   - iv        96-bit random nonce (fresh per encryption)
 *   - authTag   128-bit GCM authentication tag (integrity)
 *   - ciphertext
 *
 * Key: ENCRYPTION_KEY env var, 32 bytes as hex (64 chars) or base64. Resolved
 * lazily and cached so the app still BOOTS without it (a boot-time warning is
 * logged); encrypt/decrypt then throw a clear error if actually invoked while
 * the key is missing. That matches the codebase's "feature-level failure, not
 * boot failure" convention — platform sync/connect must not be enabled until
 * the key is set.
 */
@Injectable()
export class TokenCryptoService {
  private readonly logger = new Logger(TokenCryptoService.name);
  private cachedKey: Buffer | null = null;

  constructor() {
    if (!process.env.ENCRYPTION_KEY) {
      this.logger.warn(
        'ENCRYPTION_KEY is not set. Platform OAuth tokens cannot be encrypted ' +
          'or decrypted — do not enable platform connect or *_SYNC_ENABLED ' +
          'until ENCRYPTION_KEY is configured (32 bytes, hex or base64).',
      );
    }
  }

  /** Encrypt a plaintext string into the versioned stored format. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /**
   * Decrypt a stored value. Any value NOT in the v1 format is returned as-is —
   * defensive passthrough so a legacy/plaintext value never hard-fails a read.
   * (Currently there are no such rows; every stored token is written encrypted.)
   */
  decrypt(stored: string): string {
    if (!stored.startsWith('v1:')) return stored;
    const [, ivB64, tagB64, ctB64] = stored.split(':');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private key(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    const raw = process.env.ENCRYPTION_KEY;
    if (!raw) {
      throw new Error(
        'ENCRYPTION_KEY is not set — cannot encrypt/decrypt platform tokens.',
      );
    }
    const key = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error(
        'ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64).',
      );
    }
    this.cachedKey = key;
    return key;
  }
}
