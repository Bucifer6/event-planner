import { AppError } from '@eventdesk/shared';
import { consume, rateLimited } from './ratelimit';

// SEC11: public forms (guest RSVP, registration, enquiries, claim requests) resist bots
// with no third-party script (D1): per-IP and per-link rate limits, a honeypot field,
// and a time-to-submit floor. A throttled client sees a retry time, never a silent failure.
export interface BotCheckInput {
  ip: string;
  linkKey?: string;
  honeypot?: string | null;
  formShownAt?: number; // ms epoch when the form was rendered
  now?: number;
}

export async function assertHuman(input: BotCheckInput): Promise<void> {
  if (input.honeypot) {
    await consume('ip', `bot:${input.ip}`, 1000, 3_600_000);
    throw new AppError('BOT_SUSPECTED', 'Rejected.');
  }
  const ipCheck = await consume('ip', `form:${input.ip}`, 30, 3_600_000);
  if (!ipCheck.allowed) throw rateLimited(ipCheck.retryAfterMs ?? 60_000);
  if (input.linkKey) {
    const linkCheck = await consume('link', input.linkKey, 30, 3_600_000);
    if (!linkCheck.allowed) throw rateLimited(linkCheck.retryAfterMs ?? 60_000);
  }
  if (input.formShownAt !== undefined) {
    const elapsed = (input.now ?? Date.now()) - input.formShownAt;
    if (elapsed < 1500) throw new AppError('BOT_SUSPECTED', 'Rejected.');
  }
}
