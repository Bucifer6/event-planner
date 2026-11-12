import { prisma } from '@eventdesk/db';
import { now } from '@eventdesk/shared';

// P31/INF11/D4: listing response statistics — computed nightly by the worker from
// application events only (enquiries sent/answered, reply times). Daily-verified
// facts; no star rating, no testimonials, no visitor identifier, and payment can
// never influence them. Shown only once the listing has >=10 answered enquiries;
// the listing may hide them (hideStats).
export async function computeListingStats(): Promise<number> {
  const listings = await prisma.listing.findMany({
    where: { claimed: true, status: 'live' },
    select: { id: true },
  });
  let updated = 0;
  for (const l of listings) {
    const enquiries = await prisma.enquiry.findMany({
      where: { listingId: l.id },
      select: { sentAt: true, answeredAt: true, state: true },
    });
    const sent = enquiries.length;
    const answered = enquiries.filter((e) => e.state === 'answered' && e.answeredAt).length;
    if (answered < 10) continue; // P31: only listings with >=10 answered enquiries show stats
    const replyHours = enquiries
      .filter((e) => e.answeredAt)
      .map((e) => (e.answeredAt!.getTime() - e.sentAt.getTime()) / 3_600_000)
      .sort((a, b) => a - b);
    const median = replyHours.length ? replyHours[Math.floor(replyHours.length / 2)]! : null;
    await prisma.listingStats.upsert({
      where: { listingId: l.id },
      update: {
        enquiriesSent: sent,
        enquiriesAnswered: answered,
        medianReplyHours: median,
        computedAt: now(),
      },
      create: {
        listingId: l.id,
        enquiriesSent: sent,
        enquiriesAnswered: answered,
        medianReplyHours: median,
        computedAt: now(),
      },
    });
    updated++;
  }
  return updated;
}
