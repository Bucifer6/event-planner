"use client";

import { Button, LinkButton, Notice, Page, Stack } from "@ed/ui";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

// Unhandled error inside the app frame (LAU5): plain words, a way to retry, never a stack.
// `error.message` is deliberately not rendered; only Next's opaque digest is shown as a
// reference the person can quote to support.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("platform.error");
  useEffect(() => {
    console.error("[app] render error", error.digest ?? "");
  }, [error]);
  return (
    <Page narrow>
      <Stack gap={4}>
        <Notice tone="danger" title={t("title")}>
          <p>{t("body")}</p>
          {error.digest ? <p className="ed-small ed-muted">{t("reference", { ref: error.digest })}</p> : null}
        </Notice>
        <div className="ed-cluster">
          <Button variant="primary" onClick={() => reset()}>
            {t("retry")}
          </Button>
          <LinkButton href="/">{t("home")}</LinkButton>
        </div>
      </Stack>
    </Page>
  );
}
