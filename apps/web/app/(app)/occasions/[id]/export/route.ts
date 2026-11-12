import { requireUser } from '../../../../lib/session';
import { exportOccasionCsv } from '@eventdesk/core';

// A12: basic export — own occasion data only; never directory/Featured content (P16)
// and never another household's private data (D2).
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;
  const csv = await exportOccasionCsv(id, user.accountId);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="eventdesk-export.csv"',
    },
  });
}
