import { prisma } from '@eventdesk/db';
import { AppError } from '@eventdesk/shared';
import { audit } from './audit';
import { requireMember, requireGrant } from './access';

// B3: shared costs — one balanced ledger: who paid, who benefits, who owes whom,
// per currency. Settlement view derives from the same rows; the ledger balances
// to zero across participants for any split.

export async function addLedgerEntry(
  occasionId: string,
  accountId: string,
  input: {
    payerMemberId: string;
    amountBani: number;
    currency?: string;
    note?: string;
    splits: { memberId: string; shareBani: number }[];
  }
) {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'finance');
  if (input.amountBani <= 0) throw new AppError('INVALID_INPUT', 'Amount must be positive.');
  const totalShares = input.splits.reduce((s, x) => s + x.shareBani, 0);
  if (totalShares !== input.amountBani) {
    throw new AppError(
      'INVALID_INPUT',
      `Splits (${totalShares}) must equal the amount (${input.amountBani}).`
    );
  }
  for (const s of input.splits) {
    const m = await prisma.occasionMember.findUnique({ where: { id: s.memberId } });
    if (!m || m.occasionId !== occasionId) {
      throw new AppError('INVALID_INPUT', 'Split member is not an occasion member.');
    }
  }
  const entry = await prisma.$transaction(async (tx) => {
    const e = await tx.ledgerEntry.create({
      data: {
        occasionId,
        payerMemberId: input.payerMemberId,
        amountBani: input.amountBani,
        currency: input.currency ?? 'RON',
        note: input.note?.trim() || null,
      },
    });
    for (const s of input.splits) {
      await tx.ledgerSplit.create({
        data: { entryId: e.id, memberId: s.memberId, shareBani: s.shareBani },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: accountId,
        actorKind: 'account',
        action: 'ledger_entry_created',
        objectType: 'LedgerEntry',
        objectId: e.id,
        after: { amountBani: e.amountBani, currency: e.currency, splits: input.splits.length },
      },
    });
    return e;
  });
  return entry;
}

export async function listLedger(occasionId: string, accountId: string) {
  const member = await requireMember(occasionId, accountId);
  requireGrant(member, 'finance');
  return prisma.ledgerEntry.findMany({
    where: { occasionId },
    include: { splits: true },
    orderBy: { createdAt: 'asc' },
  });
}

// Settlement view: net balance per member per currency. Paid minus owed.
// The sum of all balances is always zero for any set of balanced entries.
export async function settlementView(occasionId: string, accountId: string) {
  const entries = await listLedger(occasionId, accountId);
  const balances = new Map<string, Map<string, number>>(); // memberId -> currency -> bani
  const add = (memberId: string, currency: string, delta: number) => {
    if (!balances.has(memberId)) balances.set(memberId, new Map());
    const cur = balances.get(memberId)!;
    cur.set(currency, (cur.get(currency) ?? 0) + delta);
  };
  for (const e of entries) {
    add(e.payerMemberId, e.currency, e.amountBani);
    for (const s of e.splits) add(s.memberId, e.currency, -s.shareBani);
  }
  // who owes whom: debtors (negative) owe creditors (positive), simplified per currency
  const settlements: { currency: string; from: string; to: string; amountBani: number }[] = [];
  for (const [currency, members] of groupByCurrency(balances)) {
    const debtors = [...members.entries()].filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
    const creditors = [...members.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const [from, owed] = debtors[i]!;
      const [to, credit] = creditors[j]!;
      const amount = Math.min(-owed, credit);
      if (amount > 0) settlements.push({ currency, from, to, amountBani: amount });
      debtors[i] = [from, owed + amount];
      creditors[j] = [to, credit - amount];
      if (debtors[i]![1] === 0) i++;
      if (creditors[j]![1] === 0) j++;
    }
  }
  return {
    balances: Object.fromEntries([...balances].map(([m, c]) => [m, Object.fromEntries(c)])),
    settlements,
  };
}

function groupByCurrency(
  balances: Map<string, Map<string, number>>
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [memberId, cur] of balances) {
    for (const [currency, v] of cur) {
      if (!out.has(currency)) out.set(currency, new Map());
      out.get(currency)!.set(memberId, v);
    }
  }
  return out;
}
