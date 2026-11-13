import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, id, ref, timestamptz, updatedAt } from "./_helpers";

// Accounts, sign-in, sessions, rate limits, email delivery records and deletion requests
// (S1–S8, INF4, SEC1, SEC3, SEC8, SEC12, SEC14, SEC16, D6, Q6).
// Codes and tokens are stored only as SHA-256 hashes (SEC8).

export const ACCOUNT_KINDS = ["email", "anonymous"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const accountKindSchema = z.enum(ACCOUNT_KINDS);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    kind: text("kind").$type<AccountKind>().notNull(),
    /** Lower-cased login email; NULL for anonymous accounts (S7). */
    email: text("email"),
    /** Random generated username (S7). Kept when an email is added so removal can return to it. */
    username: text("username"),
    /** Argon2id PHC string with its own salt (S8). NULL for email accounts: they have no password. */
    passwordHash: text("password_hash"),
    locale: text("locale").$type<"ro" | "en">().notNull().default("ro"),
    emailVerifiedAt: timestamptz("email_verified_at"),
    /** Set while a deletion request is inside its 7-day undo window (D6). */
    deletionRequestedAt: timestamptz("deletion_requested_at"),
    /** Set when the account was purged; the row stays only as an anonymised tombstone. */
    deletedAt: timestamptz("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("accounts_email_uq").on(t.email),
    uniqueIndex("accounts_username_uq").on(t.username),
  ],
);

export const DEVICE_TYPES = ["phone", "tablet", "desktop", "unknown"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    accountId: ref("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** SHA-256 of the cookie value; the value itself is never stored (SEC8). */
    tokenHash: text("token_hash").notNull(),
    deviceType: text("device_type").$type<DeviceType>().notNull().default("unknown"),
    /** Short summary such as "Chrome · Android" — never the full user-agent string. */
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    /** Hard limit: 30 days after sign-in (S3). Idle limit (14 days) is computed from lastSeenAt. */
    expiresAt: timestamptz("expires_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
    /** When the holder last proved identity with a fresh code (S4). */
    freshAuthAt: timestamptz("fresh_auth_at"),
    /** True between the first factor and the second (S2); such a session grants nothing yet. */
    secondFactorPending: boolean("second_factor_pending").notNull().default(false),
    /** WebAuthn challenge for the passkey seam (S2). */
    challenge: text("challenge"),
    challengeExpiresAt: timestamptz("challenge_expires_at"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    index("sessions_account_idx").on(t.accountId, t.revokedAt),
  ],
);

export const SIGN_IN_CODE_PURPOSES = ["sign_in", "fresh_auth", "new_email"] as const;
export type SignInCodePurpose = (typeof SIGN_IN_CODE_PURPOSES)[number];

export const signInCodes = pgTable(
  "sign_in_codes",
  {
    id: id(),
    /** Set only for codes requested by a signed-in account (fresh_auth, new_email). */
    accountId: ref("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    /** SHA-256 of the lower-cased address the code was sent to (hashed lookup). */
    emailHash: text("email_hash").notNull(),
    purpose: text("purpose").$type<SignInCodePurpose>().notNull().default("sign_in"),
    /** SHA-256 of "<row id>:<code>". */
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamptz("expires_at").notNull(),
    usedAt: timestamptz("used_at"),
    /** Set the moment a newer code is issued for the same address and purpose (SEC1). */
    invalidatedAt: timestamptz("invalidated_at"),
    createdAt: createdAt(),
  },
  (t) => [index("sign_in_codes_lookup_idx").on(t.emailHash, t.purpose, t.createdAt)],
);

export const magicLinks = pgTable(
  "magic_links",
  {
    id: id(),
    signInCodeId: ref("sign_in_code_id")
      .notNull()
      .references(() => signInCodes.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /**
     * Address the link signs in. Needed because the account may not exist yet and the code row
     * keeps only a hash. Short-lived: the row is deleted by purgeExpiredAuthRows().
     */
    email: text("email").notNull(),
    /** Same instant as the code's expiry (SEC14). */
    expiresAt: timestamptz("expires_at").notNull(),
    usedAt: timestamptz("used_at"),
    /** The consumed-link page may ask for ONE new code; set when it did (SEC14). */
    resendUsedAt: timestamptz("resend_used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("magic_links_token_hash_uq").on(t.tokenHash)],
);

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: id(),
    accountId: ref("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    /** Last four characters, the most the UI may ever show (SEC8). */
    lastFour: text("last_four").notNull(),
    usedAt: timestamptz("used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("recovery_codes_hash_uq").on(t.accountId, t.codeHash),
    index("recovery_codes_account_idx").on(t.accountId),
  ],
);

export const totpSecrets = pgTable(
  "totp_secrets",
  {
    id: id(),
    accountId: ref("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** AES-256-GCM ciphertext of the base32 secret (key derived from SESSION_SECRET). */
    secretEnc: text("secret_enc").notNull(),
    /** NULL while enrolment is not yet confirmed with a first valid code. */
    enabledAt: timestamptz("enabled_at"),
    /** Last accepted time step: the same code is never accepted twice. */
    lastUsedStep: integer("last_used_step"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("totp_secrets_account_uq").on(t.accountId)],
);

export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: id(),
    accountId: ref("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull(),
    /** COSE public key, base64url. */
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: jsonb("transports").$type<string[]>(),
    label: text("label"),
    createdAt: createdAt(),
    lastUsedAt: timestamptz("last_used_at"),
  },
  (t) => [
    uniqueIndex("passkey_credentials_credential_uq").on(t.credentialId),
    index("passkey_credentials_account_idx").on(t.accountId),
  ],
);

export const RATE_LIMIT_AXES = ["email", "ip", "device", "key"] as const;
export type RateLimitAxis = (typeof RATE_LIMIT_AXES)[number];

/** Fixed-window counters (SEC16, SEC11). `keyHash` is SHA-256 of the axis value. */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    id: id(),
    scope: text("scope").notNull(),
    axis: text("axis").$type<RateLimitAxis>().notNull(),
    keyHash: text("key_hash").notNull(),
    windowSeconds: integer("window_seconds").notNull(),
    windowStart: timestamptz("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("rate_limit_buckets_uq").on(
      t.scope,
      t.axis,
      t.keyHash,
      t.windowSeconds,
      t.windowStart,
    ),
    index("rate_limit_buckets_window_idx").on(t.windowStart),
  ],
);

/** Escalating backoff per address (SEC16): a growing wait, capped, never a lockout. */
export const rateLimitBackoffs = pgTable(
  "rate_limit_backoffs",
  {
    id: id(),
    scope: text("scope").notNull(),
    keyHash: text("key_hash").notNull(),
    strikes: integer("strikes").notNull().default(0),
    lastStrikeAt: timestamptz("last_strike_at").notNull(),
    blockedUntil: timestamptz("blocked_until").notNull(),
  },
  (t) => [uniqueIndex("rate_limit_backoffs_uq").on(t.scope, t.keyHash)],
);

/**
 * Security events (SEC10, SEC16). Holds hashed axis keys only and NEVER whether an account
 * exists for them.
 */
export const securityLog = pgTable(
  "security_log",
  {
    id: id(),
    at: timestamptz("at").notNull().defaultNow(),
    event: text("event").notNull(),
    scope: text("scope"),
    axis: text("axis"),
    keyHash: text("key_hash"),
    ip: text("ip"),
    meta: jsonb("meta"),
  },
  (t) => [index("security_log_at_idx").on(t.at), index("security_log_event_idx").on(t.event, t.at)],
);

export const EMAIL_OUTBOX_STATUSES = ["sent", "suppressed", "capped", "failed"] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];

/**
 * One row per send attempt. The `dev` transport keeps the rendered message here (that is how
 * a local sign-in code is read); real providers store no body, so a code never rests in the
 * database in readable form (SEC8).
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    toEmail: text("to_email").notNull(),
    template: text("template").notNull(),
    locale: text("locale").notNull(),
    occasionId: ref("occasion_id"),
    provider: text("provider").notNull(),
    status: text("status").$type<EmailOutboxStatus>().notNull(),
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("email_outbox_to_idx").on(t.toEmail, t.createdAt),
    index("email_outbox_created_idx").on(t.createdAt),
  ],
);

export const EMAIL_SUPPRESSION_REASONS = ["bounce", "complaint", "manual"] as const;
export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];

/** Addresses that must never be emailed again (hard bounce, complaint). Hash only. */
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: id(),
    emailHash: text("email_hash").notNull(),
    reason: text("reason").$type<EmailSuppressionReason>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("email_suppressions_email_uq").on(t.emailHash)],
);

/** Q6: emails sent per occasion per Bucharest day. */
export const emailDailyCounters = pgTable(
  "email_daily_counters",
  {
    id: id(),
    occasionId: ref("occasion_id").notNull(),
    /** yyyy-mm-dd in Europe/Bucharest */
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("email_daily_counters_uq").on(t.occasionId, t.day)],
);

/**
 * Deletion with a seven-day undo (D6). Generic: `targetType` is "account", "occasion", …
 * Use requestDeletion / undoDeletion / listDue from @ed/core/deletion.
 */
export const deletionRequests = pgTable(
  "deletion_requests",
  {
    id: id(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    requestedByKind: text("requested_by_kind").notNull(),
    requestedById: text("requested_by_id"),
    requestedAt: timestamptz("requested_at").notNull(),
    undoUntil: timestamptz("undo_until").notNull(),
    undoneAt: timestamptz("undone_at"),
    completedAt: timestamptz("completed_at"),
    /** What stays after the purge and why (shown to the user, kept for the record). */
    retainedNote: text("retained_note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("deletion_requests_open_uq")
      .on(t.targetType, t.targetId)
      .where(sql`${t.undoneAt} IS NULL AND ${t.completedAt} IS NULL`),
    index("deletion_requests_due_idx").on(t.undoUntil),
  ],
);
