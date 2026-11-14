import { Seal } from "@ed/ui";
import { guestTranslator } from "@/lib/guest";
import styles from "../_components/event.module.css";

/**
 * One plain answer for an address that does not exist, a page that is not published and an
 * occasion that is closed (C-06) — and for an unknown manage link. Both languages, because
 * nothing here may depend on what the page would have been.
 */
export default function PublicEventNotFound() {
  const ro = guestTranslator("ro", "publicpage.public");
  const en = guestTranslator("en", "publicpage.public");
  return (
    <div className="ed-solo">
      <main className="ed-solo__main" id="main">
        <div className={styles.plain}>
          <Seal size={40} />
          <h1 className={styles.resultTitle} lang="ro">
            {ro("notFoundTitle")}
          </h1>
          <p className="ed-muted" lang="ro">
            {ro("notFoundBody")}
          </p>
          <p className="ed-small ed-muted" lang="en">
            {en("notFoundTitle")}. {en("notFoundBody")}
          </p>
        </div>
      </main>
    </div>
  );
}
