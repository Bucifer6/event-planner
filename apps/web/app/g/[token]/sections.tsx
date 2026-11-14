import type { GuestNeeds } from "@ed/core/contributions";
import type { Locale } from "@ed/core/context";
import type { GuestView } from "@ed/core/invitations";
import type { GuestPoll } from "@ed/core/polls";
import { formatWeekdayDate } from "@ed/i18n/format";
import type { ReactNode } from "react";
import { GuestSeatSection, GuestSpaceSection } from "@/components/plan/GuestSections"; // seating domain (C-08, V9)
import { guestTranslator } from "@/lib/guest";
import { GuestMenuSection, GuestProgrammeSection, GuestRequestSection, GuestVenueSection } from "./event-sections"; // release C: programme, menu, venue + accessible journey, private request
import styles from "./guest.module.css";
import { ContributionForm, PollVoteForm, type GuestFormBase } from "./section-forms";

// Renderers for the sections registered with registerGuestSection() in @ed/core/invitations.
// A later release adds its section by (1) registering `load` in its core module, (2) importing
// that module in apps/web/lib/guest.ts, (3) adding one entry to `renderers` below.

export type SectionProps<T = unknown> = {
  data: T;
  view: GuestView;
  locale: Locale;
  base: GuestFormBase;
};

function Block({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className={styles.block}>
      <h2 className={styles.blockTitle}>{title}</h2>
      {intro ? <p className="ed-muted">{intro}</p> : null}
      {children}
    </section>
  );
}

function PollSection({ data, view, locale, base }: SectionProps<GuestPoll>) {
  const t = guestTranslator(locale, "polls.guest");
  return (
    <Block title={t("title")} intro={t("intro")}>
      <PollVoteForm
        base={base}
        pollId={data.pollId}
        options={data.options.map((o) => ({
          id: o.id,
          label: formatWeekdayDate(new Date(o.startsAt), locale, view.occasion.timezone),
          vote: o.vote,
        }))}
        labels={{
          yes: t("yes"),
          maybe: t("maybe"),
          no: t("no"),
          send: t("send"),
          sending: t("sending"),
          saved: t("saved"),
        }}
      />
    </Block>
  );
}

function ContributionSection({ data, locale, base }: SectionProps<GuestNeeds>) {
  const t = guestTranslator(locale, "contributions.guest");
  return (
    <Block title={t("title")} intro={t("intro")}>
      <div>
        {data.needs.map((n) => (
          <ContributionForm
            key={n.id}
            base={base}
            need={n}
            labels={{
              meter: n.unitsLeft === 0 ? t("full") : t("meter", { left: n.unitsLeft, needed: n.unitsNeeded }),
              stepper: t("stepper"),
              decrease: t("decrease"),
              increase: t("increase"),
              save: t("save"),
              saving: t("saving"),
              saved: t("saved"),
              full: t("full"),
              mine: t("mine", { count: n.mine }),
            }}
          />
        ))}
      </div>
    </Block>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderers: Record<string, (props: SectionProps<any>) => ReactNode | Promise<ReactNode>> = {
  polls: PollSection,
  contributions: ContributionSection,
  seat: GuestSeatSection,
  spaceView: GuestSpaceSection,
  programme: GuestProgrammeSection,
  menu: GuestMenuSection,
  venue: GuestVenueSection,
  privateRequest: GuestRequestSection,
};

export function GuestSections({ view, locale, base }: { view: GuestView; locale: Locale; base: GuestFormBase }) {
  return (
    <>
      {view.sections.map((s) => {
        const Render = renderers[s.key];
        return Render ? <Render key={s.key} data={s.data} view={view} locale={locale} base={base} /> : null;
      })}
    </>
  );
}
