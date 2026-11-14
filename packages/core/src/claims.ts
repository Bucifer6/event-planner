import { accounts, and, approvalRequests, asc, businessMembers, businesses, desc, eq, inArray, isNotNull, isNull, listingClaims, listings, lt, sql, type ClaimState } from "@ed/db";
import { registerTemplate, sendEmail } from "@ed/email";
import { AppError } from "@ed/shared/errors";
import { hashEquals, hashToken, sixDigitCode } from "@ed/shared/ids";
import { addDays, addMinutes } from "@ed/shared/time";
import { zId } from "@ed/shared/zod";
import { z } from "zod";
import { registerApprovalAction, requestApproval } from "./approvals";
import { audit } from "./audit";
import { createBusiness } from "./business";
import { requireAccount, requireWriteCapable, type Ctx } from "./context";
import { getListingPublicEmail } from "./discovery";
import { convertListingToClaimed } from "./listings";
import { enforceRateLimit } from "./ratelimit";
import { registerRetentionRule } from "./retention";
import { requireStaffRole } from "./staff";
import { recordEvent } from "./stats";
import { inTx } from "./tx";

// Claiming an unclaimed listing (P29, P30).
//
// A claim takes effect only after ownership is PROVEN and a SECOND staff member approves:
//
//   1. an account with an email address starts the claim (startClaim);
//   2. proof — either
//        · code: a six-digit code is emailed to the address the listing's public source
//          publishes (stored only as a hash, valid 15 minutes, 5 attempts, rate limited);
//          a wrong, expired or used-up code fails with the same generic message; or
//        · moderator: when the source publishes no email address, a ListingModerator checks
//          the claimant against the public source and RECORDS the check (checkNote);
//   3. a moderator sends the claim to the approvals queue (W9, action "listing.claim");
//      someone else approves it there. In single-operator mode it waits — no effect.
//   4. on approval the claimant's business is created (or their existing one is used), the
//      listing is converted with convertListingToClaimed and becomes a normal listing.
//
// Until step 4 the listing stays unclaimed: no enquiries, no uploads (P29).

export type ListingClaim = typeof listingClaims.$inferSelect;
export type { ClaimState };

export const CLAIM_APPROVAL_ACTION = "listing.claim";
export const CLAIM_ROLES = ["listing_moderator", "platform_admin"] as const;
export const CLAIM_CODE_MINUTES = 15;
export const CLAIM_CODE_ATTEMPTS = 5;
export const CLAIM_CODES_PER_CLAIM = 5;
const OPEN_STATES: ClaimState[] = ["code_sent", "verified", "needs_check", "in_approval"];

const invalidCode = () => new AppError("VALIDATION", "claims.errors.codeInvalid", { fieldErrors: { code: ["claims.errors.codeInvalid"] } });

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

async function loadUnclaimed(ctx: Pick<Ctx, "db">, listingId: string) {
  if (!zId.safeParse(listingId).success) return null;
  const [l] = await ctx.db.select().from(listings).where(eq(listings.id, listingId));
  if (!l || l.status !== "live") return null;
  return l;
}

export type ClaimView = {
  listingId: string;
  listingName: string;
  /** False once the listing has been claimed (by anyone). */
  unclaimed: boolean;
  sourceUrl: string | null;
  /** The published address a code would go to, masked ("c•••@florarie.ro"); null = none published. */
  maskedEmail: string | null;
  signedIn: boolean;
  /** The account has an email address (needed to own a business, P29). */
  hasEmail: boolean;
  /** The business the listing would be attached to, when the account already owns one. */
  ownBusiness: { id: string; name: string } | null;
  /** The viewer's own claim on this listing, if any. */
  claim: { id: string; state: ClaimState; method: "code" | "moderator"; codeExpiresAt: Date | null; businessId: string | null; decisionReason: string | null } | null;
};

/** What the public claim page shows. Null when there is no such public listing. */
export async function getClaimView(ctx: Ctx, listingId: string): Promise<ClaimView | null> {
  const l = await loadUnclaimed(ctx, listingId);
  if (!l) return null;
  const email = l.claimed ? null : await getListingPublicEmail(ctx, l.id);
  const accountId = ctx.actor.kind === "account" ? ctx.actor.accountId : null;
  let hasEmail = false;
  let ownBusiness: ClaimView["ownBusiness"] = null;
  let claim: ClaimView["claim"] = null;
  if (accountId) {
    const [a] = await ctx.db.select({ email: accounts.email, kind: accounts.kind }).from(accounts).where(eq(accounts.id, accountId));
    hasEmail = a?.kind === "email" && !!a.email;
    const [own] = await ctx.db
      .select({ id: businesses.id, name: businesses.name })
      .from(businessMembers)
      .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
      .where(and(eq(businessMembers.accountId, accountId), eq(businessMembers.role, "owner"), isNull(businessMembers.removedAt)));
    ownBusiness = own ?? null;
    const [c] = await ctx.db
      .select()
      .from(listingClaims)
      .where(and(eq(listingClaims.listingId, l.id), eq(listingClaims.claimantAccountId, accountId)))
      .orderBy(desc(listingClaims.createdAt))
      .limit(1);
    if (c) claim = { id: c.id, state: c.state, method: c.method, codeExpiresAt: c.codeExpiresAt, businessId: c.businessId, decisionReason: c.decisionReason };
  }
  return { listingId: l.id, listingName: l.name, unclaimed: !l.claimed, sourceUrl: l.sourceUrl, maskedEmail: email ? maskEmail(email) : null, signedIn: !!accountId, hasEmail, ownBusiness, claim };
}

type CodeEmailParams = { code: string; listingName: string; minutes: number };

async function issueCode(ctx: Ctx, claimId: string, email: string, listingName: string): Promise<void> {
  const code = sixDigitCode();
  await ctx.db
    .update(listingClaims)
    .set({ codeHash: hashToken(code), codeExpiresAt: addMinutes(ctx.now, CLAIM_CODE_MINUTES), codeAttempts: 0, codesSent: sql`${listingClaims.codesSent} + 1` })
    .where(eq(listingClaims.id, claimId));
  await sendEmail(ctx, { to: email, template: "claims.code", locale: "ro", params: { code, listingName, minutes: CLAIM_CODE_MINUTES } satisfies CodeEmailParams });
}

const startInput = z.object({
  listingId: zId,
  /** Needed only when the account does not own a business yet: it is created on approval. */
  businessName: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().min(2, "common.validation.required").max(120, "common.validation.tooLong").optional()),
  /** The claimant's role in the business, in their own words — shown to the moderator. */
  statement: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(1000, "common.validation.tooLong").optional()),
});

/**
 * Starts a claim (or returns the open one). The account must have an email address. When the
 * listing's public source publishes an address, the code goes THERE — never to an address
 * the claimant types. Otherwise the claim waits for a moderator's check.
 */
export async function startClaim(ctx: Ctx, input: z.input<typeof startInput>): Promise<{ claimId: string; method: "code" | "moderator" }> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind !== "account") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const data = startInput.parse(input);
  const l = await loadUnclaimed(ctx, data.listingId);
  if (!l) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  if (l.claimed) throw new AppError("CONFLICT", "listings.errors.alreadyClaimed");
  const [account] = await ctx.db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account || account.kind !== "email" || !account.email) throw new AppError("FORBIDDEN", "claims.errors.emailRequired");
  const [own] = await ctx.db
    .select({ id: businessMembers.businessId })
    .from(businessMembers)
    .where(and(eq(businessMembers.accountId, accountId), eq(businessMembers.role, "owner"), isNull(businessMembers.removedAt)));
  const [open] = await ctx.db
    .select()
    .from(listingClaims)
    .where(and(eq(listingClaims.listingId, l.id), eq(listingClaims.claimantAccountId, accountId), inArray(listingClaims.state, OPEN_STATES)));
  if (!own && !open && !data.businessName) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { businessName: ["common.validation.required"] } });

  // SEC11 / INF4: before any write, so the counters stay counted
  await enforceRateLimit(ctx, {
    scope: "claim.start",
    rules: [
      { axis: "ip", key: ctx.ip, limit: 20, windowSeconds: 3600 },
      { axis: "key", key: `account:${accountId}`, limit: 5, windowSeconds: 3600 },
      { axis: "key", key: `listing:${l.id}`, limit: 10, windowSeconds: 3600 },
    ],
  });

  const publicEmail = await getListingPublicEmail(ctx, l.id);
  const method = publicEmail ? "code" : "moderator";
  let claimId = open?.id ?? null;
  if (!open) {
    const [row] = await ctx.db
      .insert(listingClaims)
      .values({
        listingId: l.id,
        claimantAccountId: accountId,
        businessId: own?.id ?? null,
        businessName: own ? null : (data.businessName ?? null),
        method,
        state: method === "code" ? "code_sent" : "needs_check",
        statement: data.statement ?? null,
        createdAt: ctx.now,
      })
      .onConflictDoNothing()
      .returning({ id: listingClaims.id });
    claimId = row?.id ?? null;
    if (!claimId) throw new AppError("CONFLICT", "common.errors.CONFLICT");
    await audit(ctx, { action: "claim.started", objectType: "listing_claim", objectId: claimId, after: { listingId: l.id, method } });
    await recordEvent(ctx, "claims.started", { method });
  }
  if (publicEmail && (!open || open.state === "code_sent")) {
    if ((open?.codesSent ?? 0) >= CLAIM_CODES_PER_CLAIM) throw new AppError("RATE_LIMITED", "claims.errors.tooManyCodes");
    await issueCode(ctx, claimId!, publicEmail, l.name);
  }
  return { claimId: claimId!, method: open?.method ?? method };
}

/**
 * Checks the emailed code. Every way of failing — no such claim, wrong code, expired, too
 * many attempts — gives the same generic error, so nothing can be learned by guessing.
 */
export async function verifyClaimCode(ctx: Ctx, input: { claimId: string; code: string }): Promise<{ verified: true }> {
  requireWriteCapable(ctx);
  const accountId = requireAccount(ctx);
  const data = z.object({ claimId: z.string().max(64), code: z.string().trim().max(12) }).parse(input);
  await enforceRateLimit(ctx, {
    scope: "claim.code_entry",
    rules: [
      { axis: "ip", key: ctx.ip, limit: 30, windowSeconds: 3600 },
      { axis: "key", key: `account:${accountId}`, limit: 20, windowSeconds: 3600 },
    ],
  });
  const code = data.code.replace(/\s/g, "");
  // count the attempt first (atomically), then compare: parallel guesses cannot exceed the cap
  const [claim] = await ctx.db
    .update(listingClaims)
    .set({ codeAttempts: sql`${listingClaims.codeAttempts} + 1` })
    .where(
      and(
        eq(listingClaims.id, data.claimId),
        eq(listingClaims.claimantAccountId, accountId),
        eq(listingClaims.state, "code_sent"),
        isNotNull(listingClaims.codeHash),
        lt(listingClaims.codeAttempts, CLAIM_CODE_ATTEMPTS),
      ),
    )
    .returning();
  if (!claim || !claim.codeHash || !claim.codeExpiresAt || claim.codeExpiresAt.getTime() < ctx.now.getTime()) throw invalidCode();
  if (!/^\d{6}$/.test(code) || !hashEquals(hashToken(code), claim.codeHash)) throw invalidCode();
  const done = await ctx.db
    .update(listingClaims)
    .set({ state: "verified", verifiedAt: ctx.now, codeHash: null, codeExpiresAt: null })
    .where(and(eq(listingClaims.id, claim.id), eq(listingClaims.state, "code_sent")))
    .returning({ id: listingClaims.id });
  if (!done[0]) throw invalidCode();
  await audit(ctx, { action: "claim.code_verified", objectType: "listing_claim", objectId: claim.id, meta: { listingId: claim.listingId } });
  return { verified: true };
}

/** The claimant gives up an open claim. */
export async function cancelClaim(ctx: Ctx, input: { claimId: string }): Promise<void> {
  const accountId = requireAccount(ctx);
  const rows = await ctx.db
    .update(listingClaims)
    .set({ state: "cancelled", decidedAt: ctx.now, codeHash: null })
    .where(and(eq(listingClaims.id, input.claimId), eq(listingClaims.claimantAccountId, accountId), inArray(listingClaims.state, ["code_sent", "verified", "needs_check"])))
    .returning({ id: listingClaims.id });
  if (!rows[0]) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await audit(ctx, { action: "claim.cancelled", objectType: "listing_claim", objectId: input.claimId });
}

/* ── Staff ─────────────────────────────────────────────────────────────── */

export type ClaimRow = {
  claim: ListingClaim;
  listingName: string;
  sourceUrl: string | null;
  publicContactRoute: string | null;
  claimantEmail: string | null;
  /** State of its approval request, when one exists. */
  approvalState: string | null;
};

/**
 * Claims for the console. A claim whose approval request was rejected or cancelled is put
 * back to where it was (proof stays valid), so it can be sent again or rejected.
 */
export async function listClaims(ctx: Ctx, input: { state?: "open" | "decided" } = {}): Promise<ClaimRow[]> {
  requireStaffRole(ctx, ...CLAIM_ROLES);
  const stale = await ctx.db
    .select({ id: listingClaims.id, method: listingClaims.method })
    .from(listingClaims)
    .innerJoin(approvalRequests, eq(approvalRequests.id, listingClaims.approvalRequestId))
    .where(and(eq(listingClaims.state, "in_approval"), inArray(approvalRequests.state, ["rejected", "cancelled"])));
  for (const s of stale) {
    await ctx.db
      .update(listingClaims)
      .set({ state: s.method === "code" ? "verified" : "needs_check", approvalRequestId: null })
      .where(and(eq(listingClaims.id, s.id), eq(listingClaims.state, "in_approval")));
  }
  const open = (input.state ?? "open") === "open";
  const rows = await ctx.db
    .select({ claim: listingClaims, listingName: listings.name, sourceUrl: listings.sourceUrl, publicContactRoute: listings.publicContactRoute, claimantEmail: accounts.email, approvalState: approvalRequests.state })
    .from(listingClaims)
    .innerJoin(listings, eq(listings.id, listingClaims.listingId))
    .innerJoin(accounts, eq(accounts.id, listingClaims.claimantAccountId))
    .leftJoin(approvalRequests, eq(approvalRequests.id, listingClaims.approvalRequestId))
    .where(inArray(listingClaims.state, open ? ["verified", "needs_check", "in_approval", "code_sent"] : ["approved", "rejected", "cancelled"]))
    .orderBy(open ? asc(listingClaims.createdAt) : desc(listingClaims.decidedAt))
    .limit(200);
  // the code hash never leaves core
  return rows.map((r) => ({ ...r, claim: { ...r.claim, codeHash: null } }));
}

const submitInput = z.object({
  claimId: zId,
  /**
   * The check against the public source, as recorded evidence (what was compared with what).
   * Mandatory when no code could be sent; for a code-verified claim a short note is enough.
   */
  checkNote: z.string().trim().max(2000, "common.validation.tooLong"),
});

/**
 * A moderator sends a proven claim to the approvals queue (W9). For a claim without a
 * published email this is where the moderator's verification is recorded: `checkNote` is
 * mandatory and kept on the claim with who checked and when. Nothing changes on the listing
 * until a second person approves the request.
 */
export async function submitClaimForApproval(ctx: Ctx, input: z.input<typeof submitInput>): Promise<{ approvalRequestId: string }> {
  const staffId = requireStaffRole(ctx, ...CLAIM_ROLES);
  const data = submitInput.parse(input);
  return inTx(ctx, async (tx) => {
    const [claim] = await tx.db.select().from(listingClaims).where(eq(listingClaims.id, data.claimId)).for("update");
    if (!claim) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (claim.state !== "verified" && claim.state !== "needs_check") throw new AppError("CONFLICT", "claims.errors.notReady");
    if (claim.method === "moderator" && data.checkNote.length < 10) {
      throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { checkNote: ["claims.errors.checkRequired"] } });
    }
    const [l] = await tx.db.select({ name: listings.name, claimed: listings.claimed }).from(listings).where(eq(listings.id, claim.listingId));
    if (!l || l.claimed) throw new AppError("CONFLICT", "listings.errors.alreadyClaimed");
    const note = data.checkNote || "Code sent to the published address was confirmed.";
    const request = await requestApproval(tx, {
      action: CLAIM_APPROVAL_ACTION,
      payload: { claimId: claim.id, listingName: l.name, method: claim.method },
      reason: note.slice(0, 1000),
    });
    await tx.db
      .update(listingClaims)
      .set({ state: "in_approval", checkNote: note, checkedByStaffId: staffId, checkedAt: tx.now, approvalRequestId: request.id })
      .where(eq(listingClaims.id, claim.id));
    await audit(tx, { action: "claim.check_recorded", objectType: "listing_claim", objectId: claim.id, after: { method: claim.method, checkNote: note, approvalRequestId: request.id }, meta: { listingId: claim.listingId } });
    return { approvalRequestId: request.id };
  });
}

/** A moderator turns a claim down, with the reason the claimant will see. */
export async function rejectClaim(ctx: Ctx, input: { claimId: string; reason: string }): Promise<void> {
  requireStaffRole(ctx, ...CLAIM_ROLES);
  const data = z.object({ claimId: zId, reason: z.string().trim().min(10, "moderation.errors.reasonRequired").max(1000, "common.validation.tooLong") }).parse(input);
  const rows = await ctx.db
    .update(listingClaims)
    .set({ state: "rejected", decisionReason: data.reason, decidedAt: ctx.now, codeHash: null })
    .where(and(eq(listingClaims.id, data.claimId), inArray(listingClaims.state, ["code_sent", "verified", "needs_check"])))
    .returning({ id: listingClaims.id });
  if (!rows[0]) throw new AppError("CONFLICT", "claims.errors.notReady");
  await audit(ctx, { action: "claim.rejected", objectType: "listing_claim", objectId: data.claimId, after: { reason: data.reason } });
}

/** Runs once, inside the transaction of the final approval (W9). */
async function executeClaim(tx: Ctx, payload: { claimId: string }): Promise<void> {
  const [claim] = await tx.db.select().from(listingClaims).where(eq(listingClaims.id, payload.claimId)).for("update");
  if (!claim || claim.state !== "in_approval") throw new AppError("CONFLICT", "claims.errors.notReady");
  let businessId = claim.businessId;
  if (!businessId) {
    const [own] = await tx.db
      .select({ id: businessMembers.businessId })
      .from(businessMembers)
      .where(and(eq(businessMembers.accountId, claim.claimantAccountId), eq(businessMembers.role, "owner"), isNull(businessMembers.removedAt)));
    businessId = own?.id ?? null;
  }
  if (!businessId) {
    // the business is created AS the claimant, who becomes its owner
    const asClaimant: Ctx = { ...tx, actor: { kind: "account", accountId: claim.claimantAccountId } };
    businessId = (await createBusiness(asClaimant, { name: claim.businessName ?? "—" })).id;
  }
  await convertListingToClaimed(tx, { listingId: claim.listingId, businessId });
  await tx.db.update(listingClaims).set({ state: "approved", businessId, decidedAt: tx.now, codeHash: null }).where(eq(listingClaims.id, claim.id));
  // other open claims on the same listing end here
  await tx.db
    .update(listingClaims)
    .set({ state: "rejected", decidedAt: tx.now, decisionReason: "claimed", codeHash: null })
    .where(and(eq(listingClaims.listingId, claim.listingId), inArray(listingClaims.state, OPEN_STATES)));
  await audit(tx, { action: "claim.approved", objectType: "listing_claim", objectId: claim.id, after: { listingId: claim.listingId, businessId } });
  await recordEvent(tx, "claims.approved", { method: claim.method });
}

function registerRules(): void {
  registerApprovalAction<{ claimId: string; listingName: string; method: "code" | "moderator" }>(CLAIM_APPROVAL_ACTION, {
    roles: [...CLAIM_ROLES],
    approverRoles: [...CLAIM_ROLES],
    approvalsNeeded: 1,
    input: z.object({ claimId: zId, listingName: z.string().max(200), method: z.enum(["code", "moderator"]) }),
    describe: (p) => ({ key: `claims.approval.describe_${p.method}`, params: { listing: p.listingName } }),
    execute: (ctx, p) => executeClaim(ctx, p),
  });

  registerTemplate<CodeEmailParams>("claims.code", (p, { t }) => ({
    subject: t("claims.email.code.subject", { listing: p.listingName }),
    blocks: [
      { kind: "text", text: t("claims.email.code.body", { listing: p.listingName }) },
      { kind: "code", code: p.code },
      { kind: "note", text: t("claims.email.code.note", { minutes: p.minutes }) },
    ],
  }));

  // INF6: codes are cleared a day after they expire; abandoned claims go after 90 days
  registerRetentionRule({
    name: "claim-codes",
    run: async (ctx) => {
      const cleared = await ctx.db
        .update(listingClaims)
        .set({ codeHash: null })
        .where(and(isNotNull(listingClaims.codeHash), lt(listingClaims.codeExpiresAt, addDays(ctx.now, -1))))
        .returning({ id: listingClaims.id });
      const gone = await ctx.db
        .delete(listingClaims)
        .where(and(inArray(listingClaims.state, ["code_sent", "cancelled"]), lt(listingClaims.updatedAt, addDays(ctx.now, -90))))
        .returning({ id: listingClaims.id });
      return cleared.length + gone.length;
    },
  });
}
registerRules();

/** Called by @ed/jobs/registry in the worker. */
export function registerJobs(): void {
  registerRules();
}
