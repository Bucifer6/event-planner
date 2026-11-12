import PDFDocument from 'pdfkit';
import { requireUser } from '../../../../lib/session';
import { listTasks, getOccasionForMember, listHouseholds } from '@eventdesk/core';
import { formatDate } from '@eventdesk/shared';

// B11: downloadable briefing PDF generated from the same records.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;
  const { occasion } = await getOccasionForMember(id, user.accountId);
  const tasks = await listTasks(id, user.accountId);
  const households = await listHouseholds(id, user.accountId);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  );

  doc.fontSize(22).text(occasion.title);
  doc
    .fontSize(12)
    .text(`Data: ${occasion.dateStart ? formatDate(occasion.dateStart, 'ro') : 'necunoscut'}`);
  if (occasion.briefPurpose) doc.text(`Scop: ${occasion.briefPurpose}`);
  doc.moveDown();
  doc.fontSize(16).text('Sarcini');
  for (const t of tasks) {
    doc
      .fontSize(11)
      .text(`- [${t.status}] ${t.title}${t.dueAt ? ` (${formatDate(t.dueAt, 'ro')})` : ''}`);
  }
  doc.moveDown();
  doc.fontSize(16).text('Gospodării');
  for (const h of households) {
    doc.fontSize(11).text(`- ${h.name}: ${h.guests.length} adulți`);
  }
  doc.end();
  const pdf = await done;
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="briefing.pdf"',
    },
  });
}
