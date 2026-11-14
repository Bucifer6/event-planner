import { Seal } from "@ed/ui";
import { guestTranslator } from "@/lib/guest";
import styles from "./guest.module.css";

/**
 * One plain answer for an unknown, a revoked and an expired link (SEC2: no enumeration).
 * Both languages, because here we cannot know which one the invitation was sent in.
 */
export default function GuestLinkNotFound() {
  const ro = guestTranslator("ro", "rsvp.gone");
  const en = guestTranslator("en", "rsvp.gone");
  return (
    <div className="ed-solo">
      <main className="ed-solo__main" id="main">
        <div className={styles.plain}>
          <Seal size={40} />
          <h1 className={styles.confirmTitle} lang="ro">
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
