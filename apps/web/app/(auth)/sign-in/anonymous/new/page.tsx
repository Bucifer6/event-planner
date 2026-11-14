import { FORM_STAMP_FIELD, HONEYPOT_FIELD, issueFormStamp } from "@ed/core/ratelimit";
import { isSignupOpen, safeNextPath, withNext } from "@ed/auth";
import { Card, Lead, Notice, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { getCtx } from "@/lib/ctx";
import { afterSignInPath } from "@/lib/session";
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
export default async function AnonymousNewPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  const t = await getTranslations("auth.anonymous");
  const ta = await getTranslations("auth");
  // LAU1: no account can be created before the legal documents are published
  const signupOpen = await isSignupOpen(await getCtx());
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
      {signupOpen ? (
        <AnonymousSignup
          honeypot={{ name: HONEYPOT_FIELD, stampName: FORM_STAMP_FIELD, stamp: issueFormStamp() }}
          continueHref={afterSignInPath(next)}
        />
      ) : (
        <Notice title={ta("signIn.closedTitle")}>{ta("signIn.closedBody")}</Notice>
      )}
      <LegalLine />
      <p>
        <Link href={withNext("/sign-in/anonymous", next)}>{t("haveAccount")}</Link>
      </p>
    </Stack>
  );
}
