export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'CAPACITY_TAKEN'
  | 'UNITS_TAKEN'
  | 'INVALID_CODE'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'LINK_REVOKED'
  | 'LINK_EXPIRED'
  | 'BOT_SUSPECTED'
  | 'SUPPRESSED';

export class AppError extends Error {
  code: ErrorCode;
  retryAfterMs?: number;
  constructor(code: ErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
