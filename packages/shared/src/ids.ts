import { createId } from '@paralleldrive/cuid2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Never sequential ids (SEC2).
export function newId(): string {
  return createId();
}

// >=128-bit random token for guest/invitation links and magic links (SEC2).
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashIdentifier(identifier: string): string {
  return createHash('sha256').update(identifier.trim().toLowerCase()).digest('hex');
}

export function newNumericCode(): string {
  return randomBytes(4).readUInt32BE(0).toString().padStart(10, '0').slice(-6);
}

export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ha = Buffer.from(a);
  const hb = Buffer.from(b);
  return ha.length === hb.length && timingSafeEqual(ha, hb);
}

export function newIdempotencyKey(): string {
  return randomBytes(16).toString('hex');
}

// S7: random generated username for anonymous accounts.
export function randomUsername(): string {
  const adjectives = [
    'fericit',
    'vesel',
    'curajos',
    'cald',
    'senin',
    'vesnic',
    'rapid',
    'linistit',
  ];
  const nouns = ['soare', 'stea', 'munte', 'mare', 'padure', 'raul', 'vant', 'lumina'];
  const a = adjectives[randomBytes(1)[0]! % adjectives.length]!;
  const n = nouns[randomBytes(1)[0]! % nouns.length]!;
  return `${a}_${n}_${randomBytes(2).toString('hex')}`;
}
