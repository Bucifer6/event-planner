"use client";

import "@ed/ui/styles.css";
import en from "../../../packages/i18n/messages/en/platform.json";
import ro from "../../../packages/i18n/messages/ro/platform.json";
import { Button, LinkButton, Notice, Page, Stack } from "@ed/ui";
import { useEffect, useState } from "react";

// Last-resort error page: the root layout itself failed, so there is no i18n provider here.
// The texts still come from the i18n files; the language follows the ed_lang cookie.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [locale, setLocale] = useState<"ro" | "en">("ro");
  useEffect(() => {
    if (/(?:^|;\s*)ed_lang=en(?:;|$)/.test(document.cookie)) setLocale("en");
    console.error("[app] root error", error.digest ?? "");
  }, [error]);
  const t = (locale === "en" ? en : ro).error;
  return (
    <html lang={locale}>
      <body>
        <Page narrow>
          <Stack gap={4}>
            <Notice tone="danger" title={t.title}>
              <p>{t.body}</p>
              {error.digest ? <p className="ed-small ed-muted">{t.reference.replace("{ref}", error.digest)}</p> : null}
            </Notice>
            <div className="ed-cluster">
              <Button variant="primary" onClick={() => reset()}>
                {t.retry}
              </Button>
              <LinkButton href="/">{t.home}</LinkButton>
            </div>
          </Stack>
        </Page>
      </body>
    </html>
  );
}
