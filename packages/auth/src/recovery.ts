import type { Ctx } from "@ed/core/context";
import { and, count, eq, isNull, recoveryCodes } from "@ed/db";
import { newRecoveryCode, normaliseRecoveryCode, RECOVERY_CODE_COUNT, recoveryCodeHash } from "./util";

// Ten single-use recovery codes (S2, S8). Shown once; stored hashed; only the last four
// characters are ever shown again (SEC8).

/** Internal: replace the account's codes with ten new ones and return them — the only time. */
export async function replaceRecoveryCodes(ctx: Ctx, accountId: string): Promise<string[]> {
  await ctx.db.delete(recoveryCodes).where(eq(recoveryCodes.accountId, accountId));
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(newRecoveryCode());
  const list = [...codes];
  await ctx.db.insert(recoveryCodes).values(
    list.map((code) => ({
      accountId,
      codeHash: recoveryCodeHash(accountId, code),
      lastFour: normaliseRecoveryCode(code).slice(-4),
      createdAt: ctx.now,
    })),
  );
  return list;
}

/** Internal: consume one code. True exactly once per code. */
export async function useRecoveryCode(ctx: Ctx, accountId: string, code: string): Promise<boolean> {
  if (normaliseRecoveryCode(code).length !== 10) return false;
  const rows = await ctx.db
    .update(recoveryCodes)
    .set({ usedAt: ctx.now })
    .where(
      and(
        eq(recoveryCodes.accountId, accountId),
        eq(recoveryCodes.codeHash, recoveryCodeHash(accountId, code)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return rows.length === 1;
}

export async function countUnusedRecoveryCodes(ctx: Ctx, accountId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.accountId, accountId), isNull(recoveryCodes.usedAt)));
  return row?.n ?? 0;
}
