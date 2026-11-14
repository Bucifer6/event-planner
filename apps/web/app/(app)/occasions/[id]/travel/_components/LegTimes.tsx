import { BUCHAREST } from "@ed/core/itinerary";
import { formatInZone } from "@ed/i18n/format";
import styles from "./travel.module.css";

type L = "ro" | "en";

/** "14.07.2027, 09:40" in the zone of that end of the leg, with the Bucharest time beside it when it differs (INF8). */
export function ZonedTime({ at, tz, locale, bucharestLabel }: { at: Date; tz: string; locale: L; bucharestLabel: string }) {
  const local = formatInZone(at, tz, locale);
  const home = formatInZone(at, BUCHAREST, locale);
  return (
    <>
      <strong>{local}</strong> <span className={styles.zone}>{tz}</span>
      {tz !== BUCHAREST ? (
        <>
          <br />
          <span className={styles.zone}>
            {bucharestLabel} {local.slice(0, 10) === home.slice(0, 10) ? home.slice(12) : home}
          </span>
        </>
      ) : null}
    </>
  );
}

/** 215 → "3 h 35 min". */
export function duration(minutes: number | null): string | null {
  if (minutes === null || minutes < 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}
