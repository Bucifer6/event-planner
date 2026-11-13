"use client";

import { APP_COOKIES, COOKIE_NOTICE_STORAGE_KEY, COOKIE_SET_SIGNATURE } from "@ed/core/cookies";
import { Button, ExternalLink } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import styles from "./cookie-notice.module.css";

/**
 * Shown once; shown again only when the cookie set (COOKIE_SET_SIGNATURE) changes.
 * The acknowledgement lives in localStorage — it is not a fourth cookie, and nothing
 * security-relevant (SEC12). It informs; it does not gate anything: these three cookies are
 * strictly necessary, so there is nothing to accept or refuse.
 */
export function CookieNoticeClient({ cookiesUrl, privacyUrl }: { cookiesUrl: string; privacyUrl: string }) {
  const t = useTranslations("cookies");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY) !== COOKIE_SET_SIGNATURE);
    } catch {
      setOpen(true); // storage blocked: show it (it will show again next visit)
    }
  }, []);

  if (!open) return null;

  const acknowledge = () => {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_STORAGE_KEY, COOKIE_SET_SIGNATURE);
    } catch {
      // nothing to do: the notice simply returns on the next visit
    }
    setOpen(false);
  };

  return (
    <aside ref={ref} className={styles.notice} aria-labelledby="ed-cookie-title">
      <h2 id="ed-cookie-title" className={styles.title}>
        {t("title")}
      </h2>
      <p className={styles.text}>{t("intro")}</p>
      <ul className={styles.list}>
        {APP_COOKIES.map((c) => (
          <li key={c.name}>
            <span className={styles.name}>{c.name}</span> — {t(`items.${c.purpose}`)}
          </li>
        ))}
      </ul>
      <p className={styles.text}>{t("noTracking")}</p>
      <p className={styles.text}>
        <ExternalLink href={cookiesUrl}>{t("more")}</ExternalLink>
        {" · "}
        <ExternalLink href={privacyUrl}>{t("privacy")}</ExternalLink>
      </p>
      <Button variant="secondary" onClick={acknowledge}>
        {t("accept")}
      </Button>
    </aside>
  );
}
