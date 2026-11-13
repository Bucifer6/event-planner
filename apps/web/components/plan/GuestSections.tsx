import type { Locale } from "@ed/core/context";
import type { GuestSeat, GuestSpaceView } from "@ed/core/seating";
import { guestTranslator } from "@/lib/guest";
import { ParkingFacts } from "@/app/directory/_slots/ParkingFacts";
import { PlanView } from "./PlanView";
import styles from "./guest.module.css";

// Guest-link sections of the seating domain (registered in @ed/core/seating):
//   "seat"      — C-08 "Locul tău": this household's table (and seat), only once published
//   "spaceView" — V9 / V10 "Planul sălii": points of interest and parking facts, read-only
// Both show the guest's own household and the room — never another guest.

type Props<T> = { data: T; locale: Locale };

const plural = (n: number, locale: Locale) => {
  const r = new Intl.PluralRules(locale).select(n);
  return r === "one" ? "one" : r === "few" ? "few" : "other";
};

export function GuestSeatSection({ data, locale }: Props<GuestSeat>) {
  const t = guestTranslator(locale, "seating.guest");
  const tableIds = [...new Set(data.places.map((p) => p.tableItemId))];
  const oneTable = tableIds.length === 1;
  return (
    <section className={styles.block}>
      <h2 className={styles.title}>{t("title")}</h2>
      {oneTable ? (
        <p className={styles.table}>
          <span className="ed-label">{t("tableWord")}</span>
          <span className={styles.tableNo}>{data.places[0]!.tableLabel}</span>
        </p>
      ) : (
        <p className="ed-muted">{t("several")}</p>
      )}
      <ul className={styles.places}>
        {data.places.map((p, i) => (
          <li key={i}>
            <span>{p.who.kind === "guest" ? p.who.name : t(`${p.who.kind}.${plural(p.who.count, locale)}`, { count: p.who.count })}</span>
            <span className="ed-num">
              {oneTable ? null : t("table", { label: p.tableLabel })}
              {p.seatNo ? `${oneTable ? "" : " · "}${t("seat", { n: p.seatNo })}` : null}
            </span>
          </li>
        ))}
      </ul>
      {data.plan ? (
        <>
          <PlanView model={data.plan} label={t("planLabel")} mineIds={tableIds} options={{ showPois: false, showSeats: true }} title={null} />
          <p className="ed-small ed-muted">{t("planNote")}</p>
        </>
      ) : null}
    </section>
  );
}

export function GuestSpaceSection({ data, locale }: Props<GuestSpaceView>) {
  const t = guestTranslator(locale, "space.guest");
  const tp = guestTranslator(locale, "drawings.parking");
  const tk = guestTranslator(locale, "drawings.poiKinds");
  const tc = guestTranslator(locale, "common");
  return (
    <section className={styles.block}>
      <h2 className={styles.title}>{t("title")}</h2>
      {data.plan ? (
        <>
          <p className="ed-muted">{t("intro")}</p>
          <PlanView model={data.plan} label={t("planLabel", { name: data.name })} title={{ name: data.name }} poiLabels={data.pois.map((p) => p.name ?? tk(p.kind))} options={{ showTables: false, showSeats: false }} />
        </>
      ) : null}
      {data.parking ? (
        <>
          <h3 className={styles.sub}>{t("parking")}</h3>
          <ParkingFacts
            view={data.parking}
            labels={{
              unknown: tc("unknown"),
              yes: tp("yes"),
              no: tp("no"),
              noneOnSite: tp("noneOnSite"),
              onSite: tp("fields.onSite"),
              spaceCount: tp("fields.spaceCount"),
              onStreet: tp("fields.onStreet"),
              paid: tp("fields.paid"),
              accessibleSpaces: tp("fields.accessibleSpaces"),
              walkingDistance: tp("fields.walkingDistanceM"),
              metres: (n) => tp("metres", { m: n }),
            }}
          />
        </>
      ) : null}
    </section>
  );
}
