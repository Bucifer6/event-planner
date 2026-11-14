import { getTwoStepStatus, listSessions } from "@ed/auth";
import { getOwnAccount } from "@ed/core/accounts";
import { formatDateTime } from "@ed/i18n/format";
import { buttonClassName, DescriptionList, List, Notice, Page, PageHeader, Row, Section, Stack, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { signOutEverywhereAction, signOutSession, undoDeleteAccount } from "@/app/actions/account";
import { saveDisplayName } from "@/app/actions/integration";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { requireCtx } from "@/lib/ctx";
import { LanguageForm } from "./_components/language-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("account"))("title") };
}

export default async function AccountPage() {
  const ctx = await requireCtx();
  const t = await getTranslations("account");
  const tMcp = await getTranslations("mcp.accountLink");
  const [account, sessions, twoStep] = await Promise.all([
    getOwnAccount(ctx),
    listSessions(ctx),
    getTwoStepStatus(ctx),
  ]);
  const deviceLabel = (type: string) => t(`sessions.device.${type as "phone" | "tablet" | "desktop" | "unknown"}`);

  return (
    <Page narrow>
      <PageHeader title={t("title")} description={t("description")} />

      {account.deletion ? (
        <Notice tone="attention" title={t("delete.pendingTitle")}>
          <Stack gap={3}>
            <span>{t("delete.pendingBody", { date: formatDateTime(account.deletion.undoUntil, ctx.locale) })}</span>
            <ActionForm
              action={undoDeleteAccount}
              refreshOnSuccess
              variant="secondary"
              block={false}
              submitLabel={t("delete.undo")}
              pendingLabel={t("delete.undoing")}
            />
          </Stack>
        </Notice>
      ) : null}

      <Section title={t("profile.title")}>
        <Stack gap={4}>
          <DescriptionList
            items={[
              account.kind === "email"
                ? { term: t("profile.email"), value: account.email }
                : { term: t("profile.username"), value: <span className="ed-num">{account.username}</span> },
              {
                term: t("profile.kind"),
                value: account.kind === "email" ? t("profile.kindEmail") : t("profile.kindAnonymous"),
              },
            ]}
          />
          {account.kind === "anonymous" ? <p className="ed-small ed-muted">{t("profile.anonymousNote")}</p> : null}
          <ActionForm
            action={saveDisplayName}
            fields={[
              {
                name: "displayName",
                label: t("profile.displayName"),
                hint: t("profile.displayNameHint"),
                autoComplete: "name",
                maxLength: 60,
                required: false,
                defaultValue: account.displayName ?? "",
              },
            ]}
            variant="secondary"
            block={false}
            submitLabel={t("profile.saveDisplayName")}
            pendingLabel={t("profile.savingDisplayName")}
            success={t("profile.displayNameSaved")}
          />
          <LanguageForm locale={account.locale} />
        </Stack>
      </Section>

      <Section title={t("sessions.title")}>
        <Stack gap={4}>
          <p>{t("sessions.body")}</p>
          <List>
            {sessions.map((s) => (
              <Row
                key={s.id}
                title={s.userAgent ? `${s.userAgent} · ${deviceLabel(s.deviceType)}` : deviceLabel(s.deviceType)}
                meta={t("sessions.lastSeen", { time: formatDateTime(s.lastSeenAt, ctx.locale) })}
                end={
                  s.current ? (
                    <Tag tone="accent">{t("sessions.thisDevice")}</Tag>
                  ) : (
                    <ActionForm
                      action={signOutSession}
                      hidden={{ sessionId: s.id }}
                      refreshOnSuccess
                      variant="secondary"
                      block={false}
                      submitLabel={t("sessions.signOutOne")}
                      pendingLabel={t("sessions.signingOut")}
                    />
                  )
                }
              />
            ))}
          </List>
          <p className="ed-small ed-muted">{t("sessions.everywhereNote")}</p>
          <ActionForm
            action={signOutEverywhereAction}
            variant="danger-quiet"
            block={false}
            submitLabel={t("sessions.signOutEverywhere")}
            pendingLabel={t("sessions.signingOut")}
          />
        </Stack>
      </Section>

      <Section title={t("security.title")}>
        <List>
          <Row
            title={t("security.loginEmail")}
            meta={account.kind === "email" ? account.email : t("security.loginEmailNone")}
            end={
              <Link href="/account/email" className={buttonClassName({ size: "sm" })}>
                {account.kind === "email" ? t("security.changeEmail") : t("security.addEmail")}
              </Link>
            }
          />
          <Row
            title={t("security.twoStep")}
            meta={twoStep.totpEnabled ? t("security.twoStepOn") : t("security.twoStepOff")}
            end={
              <Link href="/account/security" className={buttonClassName({ size: "sm" })}>
                {t("security.manageTwoStep")}
              </Link>
            }
          />
          <Row
            title={tMcp("title")}
            meta={tMcp("meta")}
            end={
              <Link href="/account/assistants" className={buttonClassName({ size: "sm" })}>
                {tMcp("action")}
              </Link>
            }
          />
          <Row
            title={t("security.signOut")}
            meta={t("security.signOutMeta")}
            end={
              <Link href="/sign-out" className={buttonClassName({ size: "sm" })}>
                {t("security.signOutLink")}
              </Link>
            }
          />
          <Row
            title={t("security.deleteAccount")}
            meta={t("security.deleteMeta")}
            end={
              <Link href="/account/delete" className={buttonClassName({ size: "sm", variant: "danger-quiet" })}>
                {t("security.deleteLink")}
              </Link>
            }
          />
        </List>
      </Section>
    </Page>
  );
}
