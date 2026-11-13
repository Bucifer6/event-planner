import { and, eq, idempotencyKeys } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { actorAccountId, type Ctx } from "./context";
import { inTx } from "./tx";

const scopeSchema = z.string().min(1).max(200);
const keySchema = z.string().min(1).max(300);

/**
 * Runs fn at most once per (scope, key) and returns the same result on every repeat (Q4).
 *
 * - `scope` names the operation ("rsvp.submit", "expense.create"); `key` is the caller's
 *   idempotency key (usually generated in the browser per form render).
 * - fn runs inside a transaction together with the key row: if fn throws, nothing is stored
 *   and a retry runs fn again.
 * - Concurrent double-submit: the second caller blocks on the unique (scope, key) insert
 *   until the first commits, then receives the stored result without running fn.
 * - The result must be JSON-serialisable (it is replayed from the database, so Dates come
 *   back as ISO strings — return ids and plain data).
 * - A key first used by one account cannot be replayed by another (CONFLICT).
 */
export async function withIdempotency<T>(
  ctx: Ctx,
  scope: string,
  key: string,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<T> {
  scopeSchema.parse(scope);
  keySchema.parse(key);
  const accountId = actorAccountId(ctx.actor);

  return inTx(ctx, async (tx) => {
    const inserted = await tx.db
      .insert(idempotencyKeys)
      .values({ scope, key, accountId, createdAt: ctx.now })
      .onConflictDoNothing({ target: [idempotencyKeys.scope, idempotencyKeys.key] })
      .returning({ id: idempotencyKeys.id });

    const mine = inserted[0];
    if (!mine) {
      const [existing] = await tx.db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
      if (!existing || existing.accountId !== accountId) {
        throw new AppError("CONFLICT", "common.errors.CONFLICT");
      }
      const stored = existing.resultJson as { v?: T } | null;
      return stored?.v as T;
    }

    const result = await fn(tx);
    const json = JSON.parse(JSON.stringify({ v: result ?? null })) as { v: unknown };
    await tx.db
      .update(idempotencyKeys)
      .set({ resultJson: json })
      .where(eq(idempotencyKeys.id, mine.id));
    return result;
  });
}
