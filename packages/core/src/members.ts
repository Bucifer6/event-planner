import {
  accounts,
  and,
  asc,
  delegations,
  eq,
  isNull,
  occasionMembers,
  occasionRoleSchema,
  occasions,
  tasks,
  type OccasionKind,
  type OccasionRole,
} from "@ed/db";
import { registerTemplate, sendEmail } from "@ed/email";
import { AppError } from "@ed/shared/errors";
import { hashToken, randomToken } from "@ed/shared/ids";
import { addDays } from "@ed/shared/time";
import { zEmail, zOptionalText } from "@ed/shared/zod";
import { z } from "zod";
import { isManager, requireMember } from "./access";
import { accountLabel, requireFreshAuth } from "./accounts";
import { audit } from "./audit";
import { requireAccount, requireWriteCapable, type Ctx } from "./context";
import { inTx } from "./tx";

// Team, roles and capability grants (A5, D2, S4).
//
// - Roles: owner, pm, workstream_lead, contributor, supplier, guest. There is exactly one owner.
// - Finance and private-request access are separate, explicit grants; only the owner hands
//   them out (the owner holds both implicitly).
// - People join by an emailed link (/invite/<token>); only the SHA-256 of the token is stored.
// - Changing roles or grants, removing a member and transferring ownership are sensitive
//   (S4): they need a fresh confirmation (requireFreshAuth).

export const INVITE_TTL_DAYS = 14;
export const ASSIGNABLE_ROLES = ["pm", "workstream_lead", "contributor", "supplier", "guest"] as const;
const assignableRole = z.enum(ASSIGNABLE_ROLES);
const idSchema = z.string().min(1).max(64);

/** Suggested custom labels per occasion kind (i18n keys under team.labels). */
export function suggestedLabelKeys(kind: OccasionKind): string[] {
  switch (kind) {
    case "botez":
      return ["nas", "nasa"];
    case "nunta":
      return ["nasCununie", "nasaCununie", "domnisoaraOnoare", "cavalerOnoare"];
    default:
      return [];
  }
}

export type TeamMember = {
  id: string;
  accountId: string | null;
  /** Login email or generated username; for a pending invitation the invited address. */
  name: string;
  role: OccasionRole;
  customLabel: string | null;
  grants: { finance: boolean; privateRequests: boolean };
  /** Invitation sent, not accepted yet. */
  pending: boolean;
  inviteExpired: boolean;
  isSelf: boolean;
  createdAt: Date;
};

const ROLE_ORDER: Record<OccasionRole, number> = {
  owner: 0,
  pm: 1,
  workstream_lead: 2,
  contributor: 3,
  supplier: 4,
  guest: 5,
};

/**
 * The team. Every member sees who is on it; pending invitations and other people's grants
 * are shown to the owner and project managers only.
 */
export async function listMembers(ctx: Ctx, occasionId: string): Promise<TeamMember[]> {
  const me = await requireMember(ctx, occasionId);
  const manager = isManager(me);
  const rows = await ctx.db
    .select({ m: occasionMembers, email: accounts.email, username: accounts.username, displayName: accounts.displayName })
    .from(occasionMembers)
    .leftJoin(accounts, eq(accounts.id, occasionMembers.accountId))
    .where(and(eq(occasionMembers.occasionId, occasionId), isNull(occasionMembers.removedAt)))
    .orderBy(asc(occasionMembers.createdAt));
  const out: TeamMember[] = [];
  for (const { m, email, username, displayName } of rows) {
    const pending = m.accountId === null;
    if (pending && !manager) continue;
    const owner = m.role === "owner";
    const self = m.id === me.id;
    out.push({
      id: m.id,
      accountId: m.accountId,
      name: pending ? (m.inviteEmail ?? "") : accountLabel({ displayName, email, username }),
      role: m.role,
      customLabel: m.customLabel,
      grants:
        manager || self
          ? { finance: owner || m.grantFinance, privateRequests: owner || m.grantPrivateRequests }
          : { finance: false, privateRequests: false },
      pending,
      inviteExpired: pending && addDays(m.createdAt, INVITE_TTL_DAYS).getTime() <= ctx.now.getTime(),
      isSelf: self,
      createdAt: m.createdAt,
    });
  }
  return out.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.createdAt.getTime() - b.createdAt.getTime());
}

/* ── Invitations ────────────────────────────────────────────────────────── */

export type InviteEmailParams = { occasionTitle: string; roleKey: string; acceptUrl: string; days: number };

registerTemplate<InviteEmailParams>("team.invite", (p, { t }) => ({
  subject: t("team.email.subject", { occasion: p.occasionTitle }),
  blocks: [
    { kind: "text", text: t("team.email.intro", { occasion: p.occasionTitle, role: t(p.roleKey) }) },
    { kind: "button", label: t("team.email.button"), url: p.acceptUrl },
    { kind: "note", text: t("team.email.validity", { days: p.days }) },
    { kind: "note", text: t("team.email.notExpected") },
  ],
}));

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export const inviteMemberInput = z.object({
  occasionId: idSchema,
  email: zEmail,
  role: assignableRole.default("contributor"),
  customLabel: zOptionalText(60),
  grantFinance: z.boolean().default(false),
  grantPrivateRequests: z.boolean().default(false),
});

/**
 * Invites a person by email. Owner or project manager; only the owner can invite a project
 * manager or attach a grant, and doing so needs a fresh confirmation (S4). Inviting the same
 * address again re-sends the link with a new token (the old one stops working).
 */
export async function inviteMember(
  ctx: Ctx,
  input: z.input<typeof inviteMemberInput>,
): Promise<{ memberId: string; emailStatus: "sent" | "suppressed" }> {
  requireWriteCapable(ctx);
  const data = inviteMemberInput.parse(input);
  const me = await requireMember(ctx, data.occasionId, { manage: true });
  const elevated = data.role === "pm" || data.grantFinance || data.grantPrivateRequests;
  if (elevated) {
    if (me.role !== "owner") throw new AppError("FORBIDDEN", "team.errors.ownerOnly");
    await requireFreshAuth(ctx);
  }
  const [occasion] = await ctx.db.select().from(occasions).where(eq(occasions.id, data.occasionId));
  if (!occasion) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");

  // already on the team with this login email?
  const [existing] = await ctx.db
    .select({ id: occasionMembers.id })
    .from(occasionMembers)
    .innerJoin(accounts, eq(accounts.id, occasionMembers.accountId))
    .where(
      and(
        eq(occasionMembers.occasionId, data.occasionId),
        eq(accounts.email, data.email),
        isNull(occasionMembers.removedAt),
      ),
    );
  if (existing) {
    throw new AppError("TAKEN", "team.errors.alreadyMember", {
      fieldErrors: { email: ["team.errors.alreadyMember"] },
    });
  }

  const token = randomToken();
  const memberId = await inTx(ctx, async (tx) => {
    const [pending] = await tx.db
      .select()
      .from(occasionMembers)
      .where(
        and(
          eq(occasionMembers.occasionId, data.occasionId),
          eq(occasionMembers.inviteEmail, data.email),
          isNull(occasionMembers.accountId),
          isNull(occasionMembers.removedAt),
        ),
      );
    const values = {
      role: data.role as OccasionRole,
      customLabel: data.customLabel ?? null,
      grantFinance: data.grantFinance,
      grantPrivateRequests: data.grantPrivateRequests,
      inviteTokenHash: hashToken(token),
      createdAt: tx.now,
    };
    let id: string;
    if (pending) {
      await tx.db.update(occasionMembers).set(values).where(eq(occasionMembers.id, pending.id));
      id = pending.id;
    } else {
      const [row] = await tx.db
        .insert(occasionMembers)
        .values({ occasionId: data.occasionId, inviteEmail: data.email, ...values })
        .returning({ id: occasionMembers.id });
      id = row!.id;
    }
    await audit(tx, {
      action: pending ? "member.invite_resent" : "member.invited",
      objectType: "occasion_member",
      objectId: id,
      after: { role: data.role, grantFinance: data.grantFinance, grantPrivateRequests: data.grantPrivateRequests },
      meta: { occasionId: data.occasionId },
    });
    return id;
  });

  const sent = await sendEmail(ctx, {
    to: data.email,
    template: "team.invite",
    params: {
      occasionTitle: occasion.title,
      roleKey: `team.roles.${data.role}`,
      acceptUrl: `${appUrl()}/invite/${token}`,
      days: INVITE_TTL_DAYS,
    } satisfies InviteEmailParams,
    locale: occasion.locale,
    occasionId: occasion.id,
  });
  return { memberId, emailStatus: sent.status };
}

export type InviteView = {
  occasionId: string;
  occasionTitle: string;
  occasionKind: OccasionKind;
  role: OccasionRole;
  customLabel: string | null;
  state: "open" | "expired";
};

async function findInvite(ctx: Ctx, token: string) {
  const parsed = z.string().min(20).max(200).safeParse(token);
  if (!parsed.success) return null;
  const [row] = await ctx.db
    .select({ m: occasionMembers, o: occasions })
    .from(occasionMembers)
    .innerJoin(occasions, eq(occasions.id, occasionMembers.occasionId))
    .where(
      and(
        eq(occasionMembers.inviteTokenHash, hashToken(parsed.data)),
        isNull(occasionMembers.accountId),
        isNull(occasionMembers.removedAt),
      ),
    );
  return row ?? null;
}

/** What the invitation link is for — shown before accepting. Null = unknown, used or revoked. */
export async function getInvite(ctx: Ctx, token: string): Promise<InviteView | null> {
  const row = await findInvite(ctx, token);
  if (!row) return null;
  const expired = addDays(row.m.createdAt, INVITE_TTL_DAYS).getTime() <= ctx.now.getTime();
  return {
    occasionId: row.o.id,
    occasionTitle: row.o.title,
    occasionKind: row.o.kind,
    role: row.m.role,
    customLabel: row.m.customLabel,
    state: expired ? "expired" : "open",
  };
}

/**
 * Binds the signed-in account to the invitation. Works once: the token hash is cleared. If
 * the account is already on the team the invitation is simply closed.
 */
export async function acceptInvite(ctx: Ctx, input: { token: string }): Promise<{ occasionId: string }> {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind !== "account") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const row = await findInvite(ctx, input.token);
  if (!row) throw new AppError("NOT_FOUND", "team.errors.inviteGone");
  if (addDays(row.m.createdAt, INVITE_TTL_DAYS).getTime() <= ctx.now.getTime()) {
    throw new AppError("CONFLICT", "team.errors.inviteExpired");
  }
  return inTx(ctx, async (tx) => {
    const [already] = await tx.db
      .select()
      .from(occasionMembers)
      .where(and(eq(occasionMembers.occasionId, row.o.id), eq(occasionMembers.accountId, accountId)));
    if (already && already.removedAt === null) {
      await tx.db
        .update(occasionMembers)
        .set({ removedAt: tx.now, inviteTokenHash: null })
        .where(eq(occasionMembers.id, row.m.id));
      return { occasionId: row.o.id };
    }
    if (already) {
      // was on the team before and removed: the old row makes way for the new membership
      await tx.db.delete(occasionMembers).where(eq(occasionMembers.id, already.id));
    }
    const bound = await tx.db
      .update(occasionMembers)
      .set({ accountId, inviteTokenHash: null })
      .where(and(eq(occasionMembers.id, row.m.id), isNull(occasionMembers.accountId), isNull(occasionMembers.removedAt)))
      .returning({ id: occasionMembers.id });
    if (bound.length === 0) throw new AppError("NOT_FOUND", "team.errors.inviteGone");
    await audit(tx, {
      action: "member.joined",
      objectType: "occasion_member",
      objectId: row.m.id,
      meta: { occasionId: row.o.id, role: row.m.role },
    });
    return { occasionId: row.o.id };
  });
}

/* ── Changes (S4) ───────────────────────────────────────────────────────── */

async function loadTarget(ctx: Ctx, occasionId: string, memberId: string) {
  const [row] = await ctx.db
    .select()
    .from(occasionMembers)
    .where(
      and(
        eq(occasionMembers.id, memberId),
        eq(occasionMembers.occasionId, occasionId),
        isNull(occasionMembers.removedAt),
      ),
    );
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

export const updateMemberInput = z.object({
  occasionId: idSchema,
  memberId: idSchema,
  role: occasionRoleSchema.optional(),
  customLabel: zOptionalText(60),
  grantFinance: z.boolean().optional(),
  grantPrivateRequests: z.boolean().optional(),
});

/**
 * Changes a member's role, label or grants. Role and grant changes are the owner's alone and
 * need a fresh confirmation (S4); a label alone can be set by a project manager too. The
 * owner's own role changes only through transferOwnership.
 */
export async function updateMember(ctx: Ctx, input: z.input<typeof updateMemberInput>): Promise<void> {
  requireWriteCapable(ctx);
  const data = updateMemberInput.parse(input);
  const me = await requireMember(ctx, data.occasionId, { manage: true });
  const target = await loadTarget(ctx, data.occasionId, data.memberId);
  const role = data.role ?? target.role;
  const grantFinance = data.grantFinance ?? target.grantFinance;
  const grantPrivateRequests = data.grantPrivateRequests ?? target.grantPrivateRequests;
  const accessChanged =
    role !== target.role ||
    grantFinance !== target.grantFinance ||
    grantPrivateRequests !== target.grantPrivateRequests;
  if (accessChanged) {
    if (me.role !== "owner") throw new AppError("FORBIDDEN", "team.errors.ownerOnly");
    if (target.role === "owner" || role === "owner") {
      throw new AppError("VALIDATION", "team.errors.ownerRoleFixed");
    }
    await requireFreshAuth(ctx);
  } else if (target.role === "owner" && me.role !== "owner") {
    throw new AppError("FORBIDDEN", "team.errors.ownerOnly");
  }
  await inTx(ctx, async (tx) => {
    await tx.db
      .update(occasionMembers)
      .set({ role, customLabel: data.customLabel ?? null, grantFinance, grantPrivateRequests })
      .where(eq(occasionMembers.id, target.id));
    await audit(tx, {
      action: accessChanged ? "member.access_changed" : "member.label_changed",
      objectType: "occasion_member",
      objectId: target.id,
      before: { role: target.role, grantFinance: target.grantFinance, grantPrivateRequests: target.grantPrivateRequests, customLabel: target.customLabel },
      after: { role, grantFinance, grantPrivateRequests, customLabel: data.customLabel ?? null },
      meta: { occasionId: data.occasionId },
    });
  });
}

/**
 * Removes a member (or cancels a pending invitation). Owner or project manager; a project
 * manager cannot remove the owner or another project manager. Needs a fresh confirmation
 * (S4) unless it only cancels an invitation nobody accepted. The member's tasks become
 * unowned and their open delegation offers are withdrawn — nothing is handed to anyone else.
 */
export async function removeMember(ctx: Ctx, input: { occasionId: string; memberId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const data = z.object({ occasionId: idSchema, memberId: idSchema }).parse(input);
  const me = await requireMember(ctx, data.occasionId, { manage: true });
  const target = await loadTarget(ctx, data.occasionId, data.memberId);
  if (target.role === "owner") throw new AppError("VALIDATION", "team.errors.ownerCannotLeave");
  if (target.role === "pm" && me.role !== "owner") throw new AppError("FORBIDDEN", "team.errors.ownerOnly");
  if (target.accountId !== null) await requireFreshAuth(ctx);
  await inTx(ctx, async (tx) => {
    const done = await tx.db
      .update(occasionMembers)
      .set({ removedAt: tx.now, inviteTokenHash: null })
      .where(and(eq(occasionMembers.id, target.id), isNull(occasionMembers.removedAt)))
      .returning({ id: occasionMembers.id });
    if (done.length === 0) return;
    await tx.db.update(tasks).set({ ownerMemberId: null }).where(eq(tasks.ownerMemberId, target.id));
    await tx.db
      .update(delegations)
      .set({ state: "withdrawn", decidedAt: tx.now })
      .where(and(eq(delegations.toMemberId, target.id), eq(delegations.state, "offered")));
    await tx.db
      .update(delegations)
      .set({ state: "withdrawn", decidedAt: tx.now })
      .where(and(eq(delegations.fromMemberId, target.id), eq(delegations.state, "offered")));
    await audit(tx, {
      action: target.accountId ? "member.removed" : "member.invite_cancelled",
      objectType: "occasion_member",
      objectId: target.id,
      before: { role: target.role },
      meta: { occasionId: data.occasionId },
    });
  });
}

/**
 * Hands the occasion to another member who has joined. Owner only, fresh confirmation (S4).
 * The previous owner stays on the team as project manager; the grants they held implicitly
 * are not carried over — the new owner decides.
 */
export async function transferOwnership(ctx: Ctx, input: { occasionId: string; toMemberId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const data = z.object({ occasionId: idSchema, toMemberId: idSchema }).parse(input);
  const me = await requireMember(ctx, data.occasionId, { roles: ["owner"] });
  const target = await loadTarget(ctx, data.occasionId, data.toMemberId);
  if (target.id === me.id) throw new AppError("VALIDATION", "team.errors.alreadyOwner");
  if (!target.accountId) throw new AppError("VALIDATION", "team.errors.notJoined");
  await requireFreshAuth(ctx);
  await inTx(ctx, async (tx) => {
    const demoted = await tx.db
      .update(occasionMembers)
      .set({ role: "pm" })
      .where(and(eq(occasionMembers.id, me.id), eq(occasionMembers.role, "owner")))
      .returning({ id: occasionMembers.id });
    if (demoted.length === 0) throw new AppError("CONFLICT", "common.errors.CONFLICT");
    await tx.db.update(occasionMembers).set({ role: "owner" }).where(eq(occasionMembers.id, target.id));
    await tx.db
      .update(occasions)
      .set({ ownerAccountId: target.accountId! })
      .where(eq(occasions.id, data.occasionId));
    await audit(tx, {
      action: "occasion.ownership_transferred",
      objectType: "occasion",
      objectId: data.occasionId,
      before: { ownerMemberId: me.id },
      after: { ownerMemberId: target.id },
    });
  });
}
