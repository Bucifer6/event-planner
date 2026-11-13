import type { Ctx } from "./context";

/**
 * Runs fn in a database transaction and hands it a ctx whose db IS the transaction.
 * Everything fn does through that ctx commits or rolls back together (throw to roll back).
 * Nesting is fine: an inner inTx becomes a savepoint.
 */
export function inTx<T>(ctx: Ctx, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  return ctx.db.transaction((tx) => fn({ ...ctx, db: tx }));
}
