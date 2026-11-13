import { FORM_STAMP_FIELD, HONEYPOT_FIELD, issueFormStamp } from "@ed/core/ratelimit";
import { Card, Lead, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AFTER_SIGN_IN_PATH } from "@/lib/session";
import { AnonymousSignup } from "../../../_components/anonymous-signup";
import { LegalLine } from "../../../_components/legal";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.anonymous"))("newTitle") };
}

/**
 * S7: create an account with no email, phone or name. Says plainly what that means before
 * anything is created. (No redirect for signed-in visitors: right after creation this page
 * is still showing the one-time recovery codes.)
 */
export default async function AnonymousNewPage() {
  const t = await getTranslations("auth.anonymous");
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <h1 className="ed-display">{t("newTitle")}</h1>
        <Lead>{t("newLead")}</Lead>
      </Stack>
      <Card>
        <Stack gap={2}>
          <h2 className="ed-label">{t("meansTitle")}</h2>
          <ul className="ed-prose">
            <li>{t("meansNoEmail")}</li>
            <li>{t("meansInApp")}</li>
            <li>{t("meansNoRecovery")}</li>
            <li>{t("meansEqual")}</li>
          </ul>
        </Stack>
      </Card>
      <AnonymousSignup
        honeypot={{ name: HONEYPOT_FIELD, stampName: FORM_STAMP_FIELD, stamp: issueFormStamp() }}
        continueHref={AFTER_SIGN_IN_PATH}
      />
      <LegalLine />
      <p>
        <Link href="/sign-in/anonymous">{t("haveAccount")}</Link>
      </p>
    </Stack>
  );
}
