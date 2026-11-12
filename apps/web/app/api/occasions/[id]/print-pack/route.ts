import { requireUser } from '../../../../lib/session';
import { assemblePrintPack, getMember } from '@eventdesk/core';
import { isAppError } from '@eventdesk/shared';

// C-09: print pack as print-ready PDF generated from the same records: QR on each
// physical invitation -> that guest's own invitation view; table cards with QR ->
// the guest event page; the to-scale room plan. QRs resolve to scoped views only.
// Rendered with pdfkit + qrcode in the web layer.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  try {
    const member = await getMember(id, user.accountId);
    if (!member) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    const pack = await assemblePrintPack(id, user.accountId);

    const PDFDocument = (await import('pdfkit')).default;
    const QRCode = await import('qrcode');
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks)))
    );

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    doc.fontSize(18).text(`${pack.occasion.title} — print pack`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text('Invitații (QR -> vederea invitației proprii):');
    for (const inv of pack.invitations.slice(0, 12)) {
      const url = `${appUrl}/g/q/${inv.qrId}`; // scoped QR view (C-09): the raw token stays hashed (SEC2)
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 120 });
      doc.image(Buffer.from(qr.split(',')[1]!, 'base64'), { width: 60 });
      doc.text(` ${inv.household}`, { continued: true });
      doc.moveDown(0.4);
    }
    if (pack.occasion.publicSlug) {
      doc.moveDown().fontSize(12).text('Cărți de masă (QR -> pagina publică a evenimentului):');
      const qr = await QRCode.toDataURL(`${appUrl}/e/${pack.occasion.publicSlug}`, {
        margin: 1,
        width: 120,
      });
      doc.image(Buffer.from(qr.split(',')[1]!, 'base64'), { width: 60 });
      doc.text(` /e/${pack.occasion.publicSlug}`);
    }
    if (pack.roomPlan) {
      doc
        .moveDown()
        .fontSize(12)
        .text(`Planul sălii (scara ${pack.roomPlan.pixelsPerMeter?.toFixed(2) ?? '?'} px/m):`);
      for (const tb of pack.roomPlan.tables) {
        doc.text(
          `- ${tb.tableType} × ${tb.count}${tb.widthM != null ? ` (${tb.widthM}×${tb.heightM} m)` : ' (dimensiuni necunoscute)'}`
        );
      }
      for (const ct of pack.roomPlan.customTables) {
        doc.text(
          `- ${ct.name} (custom)${ct.widthM != null ? ` (${ct.widthM}×${ct.heightM} m)` : ''}`
        );
      }
    }
    doc.end();
    const pdf = await done;
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="print-pack.pdf"',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      },
    });
  } catch (e) {
    if (isAppError(e)) return Response.json({ error: e.code }, { status: 400 });
    console.error(e);
    return Response.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
