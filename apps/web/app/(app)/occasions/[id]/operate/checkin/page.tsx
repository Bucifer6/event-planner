import { getCheckInRoster } from "@ed/core/checkin";
import { getOccasionView } from "@ed/core/occasions";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import { offlineStatusLabels } from "../_components/labels";
import styles from "../_components/operate.module.css";
import { CheckInBoard } from "./CheckInBoard";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("operate"))("checkin.title") };
}

/**
 * E-02 / E-03: check-in on the dark "Minuit" surface. The page itself carries NO guest data —
 * only the shell and the words; the roster is fetched by the board and kept on the device for
 * the event, so the screen also opens without network (see public/sw.js, RELEASE E block).
 */
export default async function CheckInPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("operate");
  const tc = await getTranslations("common");
  // access check only (planning members); the rows are not rendered into the page
  await orNotFound(getCheckInRoster(ctx, id).then(() => true));
  const { occasion } = await getOccasionView(ctx, id);
  const raw = (key: string) => t.raw(key as never) as string;

  return (
    <div data-theme="dark" className={styles.surface}>
      <header className={styles.top}>
        <Link href={`/occasions/${id}/operate`} className={styles.back}>
          <IconArrowLeft size={16} /> {t("backToHub")}
        </Link>
        <h2 className="ed-vh">{t("checkin.title")}</h2>
      </header>
      <CheckInBoard
        occasionId={id}
        locale={ctx.locale}
        timeZone={occasion.timezone}
        labels={{
          heroLabel: t("checkin.heroLabel"),
          heroOf: raw("checkin.heroOf"),
          heroUnit: t("checkin.heroUnit"),
          heroNote: raw("checkin.heroNote"),
          search: t("checkin.search"),
          searchHint: t("checkin.searchHint"),
          scan: t("checkin.scan"),
          stopScan: t("checkin.stopScan"),
          scanning: t("checkin.scanning"),
          scanUnsupported: t("checkin.scanUnsupported"),
          cameraDenied: t("checkin.cameraDenied"),
          codeLabel: t("checkin.codeLabel"),
          codeSubmit: t("checkin.codeSubmit"),
          arrive: t("checkin.arrive"),
          arrived: t("checkin.arrived"),
          arrivedAt: raw("checkin.arrivedAt"),
          waitingSync: t("checkin.waitingSync"),
          party: raw("checkin.party"),
          partyUnknown: t("checkin.partyUnknown"),
          rsvp: { yes: t("checkin.rsvp.yes"), no: t("checkin.rsvp.no"), maybe: t("checkin.rsvp.maybe"), pending: t("checkin.rsvp.pending") },
          fbArrived: raw("checkin.fbArrived"),
          fbAlready: raw("checkin.fbAlready"),
          fbQueued: raw("checkin.fbQueued"),
          fbUnknownCode: t("checkin.fbUnknownCode"),
          fbUnknownOffline: t("checkin.fbUnknownOffline"),
          emptyRoster: t("checkin.emptyRoster"),
          emptyRosterBody: t("checkin.emptyRosterBody"),
          noMatch: t("checkin.noMatch"),
          more: raw("checkin.more"),
          staleRoster: t("checkin.staleRoster"),
          noRoster: t("checkin.noRoster"),
          closed: t("closedNotice"),
          correct: t("checkin.correct"),
          correctTitle: raw("checkin.correctTitle"),
          correctIntro: t("checkin.correctIntro"),
          correctAdults: t("checkin.correctAdults"),
          correctChildren: t("checkin.correctChildren"),
          correctUndo: t("checkin.correctUndo"),
          correctUndoHint: t("checkin.correctUndoHint"),
          correctReason: t("checkin.correctReason"),
          correctReasonHint: t("checkin.correctReasonHint"),
          correctSubmit: t("checkin.correctSubmit"),
          saving: tc("status.saving"),
          close: tc("actions.close"),
          optional: tc("optional"),
          status: offlineStatusLabels(raw),
        }}
      />
    </div>
  );
}
