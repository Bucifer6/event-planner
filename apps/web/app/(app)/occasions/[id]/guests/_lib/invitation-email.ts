import "server-only";
import type { DeliverInvitation } from "@ed/core/invitations";
import { registerTemplate, sendEmail } from "@ed/email";
import { formatWeekdayDate } from "@ed/i18n/format";

// The invitation email (A6). Bilingual, Romanian first (L5); strings live in `rsvp.email`.
// It carries the household's fresh link — the only personal data in it is the household name.

export const INVITATION_TEMPLATE = "rsvp.invitation";

export type InvitationEmailParams = {
  householdName: string;
  occasionTitle: string;
  startsAtIso: string | null;
  timezone: string;
  venueName: string | null;
  url: string;
};

registerTemplate<InvitationEmailParams>(INVITATION_TEMPLATE, (p, { t, locale }) => ({
  subject: t("rsvp.email.subject", { title: p.occasionTitle }),
  blocks: [
    { kind: "text", text: t("rsvp.email.greeting", { name: p.householdName }) },
    { kind: "text", text: t("rsvp.email.intro", { title: p.occasionTitle }) },
    ...(p.startsAtIso
      ? [{ kind: "text" as const, text: t("rsvp.email.when", { date: formatWeekdayDate(new Date(p.startsAtIso), locale, p.timezone) }) }]
      : []),
    ...(p.venueName ? [{ kind: "text" as const, text: t("rsvp.email.where", { venue: p.venueName }) }] : []),
    { kind: "button", label: t("rsvp.email.button"), url: p.url },
    { kind: "note", text: t("rsvp.email.linkNote") },
    { kind: "note", text: t("rsvp.email.childrenNote") },
  ],
}));

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Hands one invitation to @ed/email. `occasionId` makes it count against the 500/day cap (Q6). */
export const deliverInvitation: DeliverInvitation = async (ctx, email) => {
  await sendEmail(ctx, {
    to: email.to,
    template: INVITATION_TEMPLATE,
    locale: email.locale,
    occasionId: email.occasionId,
    params: {
      householdName: email.householdName,
      occasionTitle: email.occasionTitle,
      startsAtIso: email.startsAt ? email.startsAt.toISOString() : null,
      timezone: email.timezone,
      venueName: email.venueName,
      url: `${appUrl()}${email.path}`,
    } satisfies InvitationEmailParams,
  });
};
