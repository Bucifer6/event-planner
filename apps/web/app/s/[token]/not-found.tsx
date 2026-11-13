import { Seal } from "@ed/ui";
import { guestTranslator } from "@/lib/guest";
import styles from "./supplier.module.css";

/**
 * One plain answer for an unknown and a revoked supplier link (SEC2: no enumeration).
 * Both languages, because here we cannot know which one the link was made in.
 */
export default function SupplierLinkNotFound() {
  const ro = guestTranslator("ro", "briefing.gone");
  const en = guestTranslator("en", "briefing.gone");
  return (
    <div className="ed-solo">
      <main className="ed-solo__main" id="main">
        <div className={styles.plain}>
          <Seal size={40} />
          <h1 className={styles.title} lang="ro">
            {ro("title")}
          </h1>
          <p className="ed-muted" lang="ro">
            {ro("body")}
          </p>
          <p className="ed-small ed-muted" lang="en">
            {en("title")} {en("body")}
          </p>
        </div>
      </main>
    </div>
  );
}
