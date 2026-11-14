import { accounts, occasionMembers, occasions } from "@ed/db";
import type { TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { accountCtx, anonymousCtx, makeCtx, type Ctx } from "../src/context";
import { createHousehold } from "../src/guests";
import { resolveGuestLink } from "../src/invitations";

// Shared fixtures of the release C tests (programme, menus, public page, private requests).

export const NOW = new Date("2027-03-01T09:00:00Z");
export const OWNER = "acc_c_owner";
export const PM = "acc_c_pm"; // manager WITHOUT the privateRequests grant
export const HOLDER = "acc_c_holder"; // contributor WITH the privateRequests grant
export const HELPER = "acc_c_helper";
export const OUTSIDER = "acc_c_outsider";

let seq = 0;

export async function seedAccounts(t: TestDb): Promise<void> {
  await t.db.insert(accounts).values(
    [OWNER, PM, HOLDER, HELPER, OUTSIDER].map((id) => ({ id, kind: "email" as const, email: `${id}@example.test` })),
  );
}

export async function newOccasion(t: TestDb, opts: { startsAt?: Date | null; status?: "planning" | "closed"; closedAt?: Date } = {}): Promise<string> {
  const id = `occ_c_${++seq}_${Math.random().toString(36).slice(2, 8)}`;
  await t.db.insert(occasions).values({
    id,
    ownerAccountId: OWNER,
    title: "Nunta Ioanei și a lui Andrei",
    kind: "nunta",
    startsAt: opts.startsAt === undefined ? new Date("2027-06-12T09:00:00Z") : opts.startsAt, // 12:00 Bucharest
    venueName: "Conacul Polizu",
    venueAddress: "Str. Polizu 4, Iași",
    status: opts.status ?? "planning",
    closedAt: opts.closedAt ?? null,
  });
  await t.db.insert(occasionMembers).values([
    { occasionId: id, accountId: OWNER, role: "owner" },
    { occasionId: id, accountId: PM, role: "pm" },
    { occasionId: id, accountId: HOLDER, role: "contributor", grantPrivateRequests: true },
    { occasionId: id, accountId: HELPER, role: "contributor" },
  ]);
  return id;
}

export const as = (t: TestDb, accountId: string, now: Date = NOW): Ctx => accountCtx(t.db, accountId, { now });

export async function guestCtx(t: TestDb, token: string, now: Date = NOW): Promise<Ctx> {
  const link = await resolveGuestLink(anonymousCtx(t.db, { now }), token, { rateLimit: false });
  if (!link) throw new Error("link did not resolve");
  return makeCtx(t.db, link.actor, { now });
}

export async function household(t: TestDb, occasionId: string, name: string, email?: string) {
  return createHousehold(as(t, OWNER), { occasionId, name, guestNames: [`${name} Unu`, `${name} Doi`], leadEmail: email });
}

export async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "OK";
  } catch (e) {
    return isAppError(e) ? `${e.code}:${e.messageKey}` : `THROWN:${String(e)}`;
  }
}
