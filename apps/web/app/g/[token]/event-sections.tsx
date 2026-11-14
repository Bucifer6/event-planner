import type { GuestVenue } from "@ed/core/guestevent";
import { DIET_TAGS, type GuestMenu } from "@ed/core/menus";
import type { GuestProgramme } from "@ed/core/programme";
import type { SentRequests } from "@ed/core/requests";
import { formatDate, formatWeekdayDate } from "@ed/i18n/format";
import { Notice } from "@ed/ui";
import { EventBlock, JourneyFacts, MenuCard, ProgrammeList, VenueLines } from "@/app/e/_components/content";
import styles from "@/app/e/_components/event.module.css";
import { MealChoiceForm, PrivateRequestForm, type FormGuard, type MealChoiceGroup } from "@/app/e/_components/forms";
import { guestTranslator } from "@/lib/guest";
import type { SectionProps } from "./sections";

// Guest-link sections of release C (registered in @ed/core/programme, menus, guestevent and
// requests): "programme" (C-03/C-10), "menu" (C-05), "venue" (C-10 navigation link + C-07
// accessible journey) and "privateRequest" (C-07). Each shows this household's own view only.

function guardOf(base: SectionProps["base"]): FormGuard {
  return { hidden: { token: base.token, lang: base.lang }, stamp: base.stamp, stampField: base.stampField, honeypotField: base.honeypotField, honeypotLabel: base.honeypotLabel };
}

export function GuestProgrammeSection({ data, locale }: SectionProps<GuestProgramme>) {
  const t = guestTranslator(locale, "programme.guest");
  return (
    <EventBlock title={t("title")} intro={t("intro")}>
      {data.removed.length > 0 ? <Notice tone="attention">{t("removed", { list: data.removed.join(", ") })}</Notice> : null}
      {data.items.length > 0 ? <ProgrammeList items={data.items} locale={locale} /> : null}
    </EventBlock>
  );
}

export function GuestMenuSection({ data, view, locale, base }: SectionProps<GuestMenu>) {
  const t = guestTranslator(locale, "menus.guest");
  const tm = guestTranslator(locale, "menus");
  const tc = guestTranslator(locale, "common");
  const groups: MealChoiceGroup[] = data.groups.map((g) => ({
    key: g.key,
    legend: data.menus.length > 1 ? t("group", { course: tm(`courses.${g.course}`), menu: g.menuName }) : tm(`courses.${g.course}`),
    party: g.party,
    partyText: g.audience === "children" ? t("groupChildren", { count: g.party }) : t("groupAdults", { count: g.party }),
    options: g.options.map((o) => ({ itemId: o.itemId, name: o.name, note: o.dietTags.length > 0 ? o.dietTags.map((d) => tm(`diet.${d}`)).join(", ") : null, count: o.count })),
  }));
  const chosen = data.groups.flatMap((g) => g.options.filter((o) => o.count > 0).map((o) => t("chosen", { name: o.name, count: o.count })));
  const hasChildrenGroup = data.groups.some((g) => g.audience === "children");
  return (
    <EventBlock title={t("title")}>
      <MenuCard menus={data.menus} locale={locale} />
      {data.state === "needsRsvp" ? <p className="ed-small ed-muted">{t("needsRsvp")}</p> : null}
      {data.state === "locked" ? (
        <div>
          <h3 className={styles.sub}>{t("chooseTitle")}</h3>
          <p>{chosen.length > 0 ? chosen.join(" · ") : t("noneChosen")}</p>
          <p className="ed-small ed-muted">{t("locked")}</p>
        </div>
      ) : null}
      {data.state === "open" ? (
        <div className={styles.formStack}>
          <div>
            <h3 className={styles.sub}>{t("chooseTitle")}</h3>
            <p className="ed-muted">{t("chooseIntro")}</p>
          </div>
          <MealChoiceForm
            guard={guardOf(base)}
            lang={locale}
            groups={groups}
            labels={{ decrease: t("decrease"), increase: t("increase"), save: t("save"), saving: t("saving"), saved: t("saved"), retryAt: tc.raw("errors.retryAt") as string }}
          />
          <p className="ed-small ed-muted">
            {data.deadline ? `${t("until", { date: formatWeekdayDate(new Date(data.deadline), locale, view.occasion.timezone) })} ` : ""}
            {hasChildrenGroup ? t("childrenNote") : ""}
          </p>
        </div>
      ) : null}
    </EventBlock>
  );
}

export function GuestVenueSection({ data, locale }: SectionProps<GuestVenue>) {
  const t = guestTranslator(locale, "guestevent");
  return (
    <>
      {data.venueAddress ? (
        <EventBlock title={t("venue.title")}>
          <VenueLines name={data.venueName} address={data.venueAddress} href={data.navigationHref} locale={locale} />
          <p className="ed-small ed-muted">{t("venue.navigateNote")}</p>
        </EventBlock>
      ) : null}
      {data.journey ? (
        <EventBlock title={t("journey.title")} intro={t("journey.intro")}>
          <JourneyFacts journey={data.journey} locale={locale} />
        </EventBlock>
      ) : null}
    </>
  );
}

export function GuestRequestSection({ data, locale, base }: SectionProps<SentRequests>) {
  const t = guestTranslator(locale, "requests.guest");
  const tr = guestTranslator(locale);
  return (
    <EventBlock title={t("title")} intro={t("intro")}>
      {data.sent.length > 0 ? (
        <div>
          <p className="ed-small ed-muted">{t("sentBefore")}</p>
          <ul className={styles.sentList}>
            {data.sent.map((s, i) => (
              <li key={i}>{t("sentRow", { kind: tr(`requests.kinds.${s.kind}`), date: formatDate(new Date(s.at), locale) })}</li>
            ))}
          </ul>
          <p className="ed-small ed-muted">{t("sentNote")}</p>
        </div>
      ) : null}
      {data.canSend ? (
        <PrivateRequestForm
          mode="guest"
          guard={guardOf(base)}
          lang={locale}
          dietTags={DIET_TAGS.map((d) => ({ value: d, label: tr(`menus.diet.${d}`) }))}
          labels={{
            kind: t("kind"),
            kindDietary: t("kindDietary"),
            kindAccess: t("kindAccess"),
            kindOther: t("kindOther"),
            dietTag: t("dietTag"),
            dietTagNone: t("dietTagNone"),
            body: t("body"),
            bodyHint: t("bodyHint"),
            optional: tr("common.optional"),
            childDetailsMessage: tr("rsvp.errors.childDetails"),
            childWarningTitle: t("childWarningTitle"),
            childWarningBody: t("childWarningBody"),
            sendAnyway: t("sendAnyway"),
            send: t("send"),
            sending: t("sending"),
            sent: t("sent"),
            retryAt: tr.raw("common.errors.retryAt") as string,
          }}
        />
      ) : null}
    </EventBlock>
  );
}
