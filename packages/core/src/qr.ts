import { and, asc, eq, households, invitations, isNull, occasionGuestSettings, occasions } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { hashToken, randomToken } from "@ed/shared/ids";
import QRCode from "qrcode";
import { requireMember } from "./access";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { GUEST_LINK_LIMITS, resolveGuestLink, type GuestLink } from "./invitations";
import { assertOccasionWritable } from "./lifecycle";
import { enforceRateLimit } from "./ratelimit";
import { inTx } from "./tx";

// QR codes for PHYSICAL invitations (C-09, SEC2).
//
// Each household's invitation gets a stable `qrId`: 24 random bytes (192 bits), generated on
// its own — it is NOT the link token and cannot be worked out from it (the token itself is
// never stored). The printed code opens /g/q/<qrId>, which shows exactly what the household's
// own link shows and nothing else: one household, never the guest list.
//
//   ensureQrIds(ctx, occasionId)            manager: gives every invitation a qrId (idempotent)
//   listHouseholdQrs(ctx, occasionId)       manager: household name + landing URL, for the print pack
//   rotateQrId(ctx, { householdId })        manager: a printed code stops working, a new one is made
//   resolveQrLink(ctx, qrId)                anyone: qrId → the household's guest actor, or null
//   resolveGuestCredential(ctx, credential) the web seam: link token OR "qr-<qrId>"
//   qrMatrix / qrPathData / drawQrOnPdf     the code itself, as vector modules
//
// A qrId dies with its invitation: a revoked or expired invitation answers "not found" through
// the QR exactly as through the link (same answer for unknown / revoked / expired — no
// enumeration), and the same per-IP limits apply.

/** 24 bytes = 192 bits (SEC2 asks for at least 128). */
export const QR_ID_BYTES = 24;
const QR_ID_RE = /^[A-Za-z0-9_-]{32}$/;
/** How a qrId travels where a link token is expected (forms of the guest page). */
export const QR_CREDENTIAL_PREFIX = "qr-";

export function qrLandingPath(qrId: string): string {
  return `/g/q/${qrId}`;
}

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Absolute URL a printed code carries. */
export function qrLandingUrl(qrId: string): string {
  return `${appUrl()}${qrLandingPath(qrId)}`;
}

async function manage(ctx: Ctx, occasionId: string): Promise<void> {
  await requireMember(ctx, occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
}

/** Gives every invitation of the occasion that has none a qrId. Idempotent; returns how many were made. */
export async function ensureQrIds(ctx: Ctx, occasionId: string): Promise<number> {
  await manage(ctx, occasionId);
  const missing = await ctx.db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.occasionId, occasionId), isNull(invitations.qrId)));
  if (missing.length === 0) return 0;
  await assertOccasionWritable(ctx, occasionId);
  let made = 0;
  await inTx(ctx, async (tx) => {
    for (const row of missing) {
      const res = await tx.db
        .update(invitations)
        .set({ qrId: randomToken(QR_ID_BYTES) })
        .where(and(eq(invitations.id, row.id), isNull(invitations.qrId)))
        .returning({ id: invitations.id });
      made += res.length;
    }
    if (made > 0) await audit(tx, { action: "invitation.qr_assigned", objectType: "occasion", objectId: occasionId, after: { count: made } });
  });
  return made;
}

export type HouseholdQr = { householdId: string; householdName: string; qrId: string; url: string; revoked: boolean };

/** The printable codes of the occasion (managers; assigns missing ids first). Never the link token. */
export async function listHouseholdQrs(ctx: Ctx, occasionId: string): Promise<HouseholdQr[]> {
  await ensureQrIds(ctx, occasionId);
  const rows = await ctx.db
    .select({ householdId: households.id, name: households.name, qrId: invitations.qrId, revokedAt: invitations.revokedAt })
    .from(invitations)
    .innerJoin(households, eq(households.id, invitations.householdId))
    .where(eq(invitations.occasionId, occasionId))
    .orderBy(asc(households.name), asc(households.id));
  return rows
    .filter((r): r is typeof r & { qrId: string } => !!r.qrId)
    .map((r) => ({ householdId: r.householdId, householdName: r.name, qrId: r.qrId, url: qrLandingUrl(r.qrId), revoked: !!r.revokedAt }));
}

/** Replaces one household's printed code: the old one answers "not found" from now on. */
export async function rotateQrId(ctx: Ctx, input: { householdId: string }): Promise<{ qrId: string }> {
  const [inv] = await ctx.db.select().from(invitations).where(eq(invitations.householdId, String(input.householdId).slice(0, 64)));
  if (!inv) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await manage(ctx, inv.occasionId);
  await assertOccasionWritable(ctx, inv.occasionId);
  const qrId = randomToken(QR_ID_BYTES);
  await inTx(ctx, async (tx) => {
    await tx.db.update(invitations).set({ qrId }).where(eq(invitations.id, inv.id));
    await audit(tx, { action: "invitation.qr_rotated", objectType: "invitation", objectId: inv.id });
  });
  return { qrId };
}

/**
 * qrId → the guest actor of ONE household, or null. Unknown, malformed, revoked and expired
 * all return null (the same answer as a link, SEC2). Throws RATE_LIMITED when an IP keeps
 * guessing or one code is hammered.
 */
export async function resolveQrLink(ctx: Ctx, qrId: string, opts: { rateLimit?: boolean } = {}): Promise<GuestLink | null> {
  const limit = opts.rateLimit ?? true;
  const wellFormed = typeof qrId === "string" && QR_ID_RE.test(qrId);
  const [inv] = wellFormed ? await ctx.db.select().from(invitations).where(eq(invitations.qrId, qrId)) : [];
  let ok = !!inv && !inv.revokedAt;
  if (ok && inv) {
    // the same expiry rules as the link (invitations.ts: isExpired)
    const [facts] = await ctx.db
      .select({ status: occasions.status, closedAt: occasions.closedAt, rsvpDeadline: occasionGuestSettings.rsvpDeadline })
      .from(occasions)
      .leftJoin(occasionGuestSettings, eq(occasionGuestSettings.occasionId, occasions.id))
      .where(eq(occasions.id, inv.occasionId));
    const now = ctx.now.getTime();
    if (!facts) ok = false;
    else if (inv.expiresAt && inv.expiresAt.getTime() <= now) ok = false;
    else if (inv.expiryMode === "rsvp_deadline" && facts.rsvpDeadline && facts.rsvpDeadline.getTime() <= now) ok = false;
    else if (inv.expiryMode === "closeout" && (facts.status === "closed" || (facts.closedAt && facts.closedAt.getTime() <= now))) ok = false;
  }
  const linkKey = wellFormed ? hashToken(`qr:${qrId}`) : null;
  if (limit) {
    if (!ok) {
      await enforceRateLimit(ctx, {
        scope: "guest.link.miss",
        rules: [{ axis: "ip", key: ctx.ip, limit: GUEST_LINK_LIMITS.missesPerIpPerHour, windowSeconds: 3600 }],
      });
    } else {
      await enforceRateLimit(ctx, {
        scope: "guest.link",
        rules: [
          { axis: "ip", key: ctx.ip, limit: GUEST_LINK_LIMITS.perIpPerHour, windowSeconds: 3600 },
          { axis: "key", key: linkKey, limit: GUEST_LINK_LIMITS.perLinkPerHour, windowSeconds: 3600 },
        ],
      });
    }
  }
  if (!ok || !inv || !linkKey) return null;
  return {
    actor: { kind: "guest", invitationId: inv.id, householdId: inv.householdId, occasionId: inv.occasionId },
    invitationId: inv.id,
    householdId: inv.householdId,
    occasionId: inv.occasionId,
    language: inv.language,
    linkKey,
  };
}

/** The value the guest page carries in place of a link token after a QR scan. */
export function qrCredential(qrId: string): string {
  return `${QR_CREDENTIAL_PREFIX}${qrId}`;
}

/**
 * THE WEB SEAM (apps/web/lib/guest.ts): resolves what the guest page was opened with — a
 * link token, or "qr-<qrId>" after a QR scan — to the same GuestLink. A value that looks like
 * a QR credential but is no known code falls through to the token lookup, so the answer (and
 * the miss counting) is the link's own.
 */
export async function resolveGuestCredential(ctx: Ctx, credential: string, opts: { rateLimit?: boolean } = {}): Promise<GuestLink | null> {
  if (typeof credential === "string" && credential.startsWith(QR_CREDENTIAL_PREFIX)) {
    const qrId = credential.slice(QR_CREDENTIAL_PREFIX.length);
    if (QR_ID_RE.test(qrId)) {
      const [known] = await ctx.db.select({ id: invitations.id }).from(invitations).where(eq(invitations.qrId, qrId));
      if (known) return resolveQrLink(ctx, qrId, opts);
    }
  }
  return resolveGuestLink(ctx, credential, opts);
}

/* ── The code itself: vector modules ───────────────────────────────────── */

export type QrMatrix = { size: number; dark: boolean[] };

/** Error correction M: fine for clean print at 20 mm and up. */
export function qrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const dark: boolean[] = new Array<boolean>(size * size);
  for (let i = 0; i < size * size; i += 1) dark[i] = !!data[i];
  return { size, dark };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The dark modules as one SVG/PDF path (runs of modules joined into rectangles), drawn in a
 * square of `sizePt` at (x, y), with the 4-module quiet zone INSIDE that square.
 */
export function qrPathData(m: QrMatrix, x: number, y: number, sizePt: number, quiet = 4): string {
  const cell = sizePt / (m.size + quiet * 2);
  let d = "";
  for (let row = 0; row < m.size; row += 1) {
    let col = 0;
    while (col < m.size) {
      if (!m.dark[row * m.size + col]) {
        col += 1;
        continue;
      }
      let run = 1;
      while (col + run < m.size && m.dark[row * m.size + col + run]) run += 1;
      const px = x + (col + quiet) * cell;
      const py = y + (row + quiet) * cell;
      d += `M${r3(px)} ${r3(py)}h${r3(run * cell)}v${r3(cell)}h${r3(-run * cell)}z`;
      col += run;
    }
  }
  return d;
}

/** Draws the code on a pdfkit page as vector modules on a white square (always dark on light). */
export function drawQrOnPdf(doc: PDFKit.PDFDocument, m: QrMatrix, x: number, y: number, sizePt: number, opts: { dark?: string; light?: string | null } = {}): void {
  const light = opts.light === undefined ? "#ffffff" : opts.light;
  doc.save();
  if (light) doc.rect(x, y, sizePt, sizePt).fill(light);
  doc.path(qrPathData(m, x, y, sizePt)).fill(opts.dark ?? "#17161b");
  doc.restore();
}
