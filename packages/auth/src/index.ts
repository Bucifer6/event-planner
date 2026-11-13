// @ed/auth — sign-in codes and one-tap link, anonymous accounts, sessions, fresh auth,
// opt-in two-step (R0-04). Rate limiting lives in @ed/core/ratelimit (R0-05).
export * from "./anonymous";
export * from "./codes";
export * from "./fresh";
export * from "./login-email";
export * from "./passkeys";
export * from "./sessions";
export * from "./totp";
export {
  CODE_TTL_MINUTES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RECOVERY_CODE_COUNT,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  summariseUserAgent,
} from "./util";
export { FRESH_AUTH_MINUTES, isFreshAuth, requireFreshAuth, sessionIdOf } from "@ed/core/accounts";
