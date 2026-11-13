import { getFreshAuthMethod, isFreshAuth } from "@ed/auth";
import { formatDate, formatDateTime } from "@ed/i18n/format";
import { listMcpTokens, MCP_CONSENT_DATA_CLASSES, MCP_INACTIVITY_DAYS, MCP_MAX_ACTIVE_TOKENS } from "@ed/mcp";
import { EmptyState, Page, PageHeader, Section, Stack, Table, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { acceptAssistantConsent, revokeAssistantToken } from "@/app/actions/mcp";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { requireCtx } from "@/lib/ctx";
import { FreshGate } from "../_components/fresh-gate";
import { CreateAssistant } from "./_components/create-assistant";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("mcp"))("title") };
}

/** MCP1/MCP4: personal connection tokens for the user's own AI assistant. */
export default async function AssistantsPage() {
  const ctx = await requireCtx();
  const t = await getTranslations("mcp");
  const [tokens, fresh, method] = await Promise.all([listMcpTokens(ctx), isFreshAuth(ctx), getFreshAuthMethod(ctx)]);
  const serverUrl = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "")}/mcp`;
  const atLimit = tokens.length >= MCP_MAX_ACTIVE_TOKENS;

  return (
    <Page narrow>
      <PageHeader eyebrow={<Link href="/account">{t("back")}</Link>} title={t("title")} description={t("description")} />

      <Section title={t("list.title")}>
        {tokens.length === 0 ? (
          <EmptyState title={t("list.emptyTitle")}>{t("list.emptyBody")}</EmptyState>
        ) : (
          <Stack gap={3}>
            <Table caption={t("list.caption")}>
              <thead>
                <tr>
                  <th scope="col">{t("list.name")}</th>
                  <th scope="col">{t("list.scope")}</th>
                  <th scope="col">{t("list.ending")}</th>
                  <th scope="col">{t("list.lastUsed")}</th>
                  <th scope="col">{t("list.expires")}</th>
                  <th scope="col">{t("list.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id}>
                    <td>
                      <Stack gap={2}>
                        <span>{token.name}</span>
                        {token.consentAccepted ? null : <Tag tone="attention">{t("list.consentNeeded")}</Tag>}
                      </Stack>
                    </td>
                    <td>{t(`scopes.${token.scope}`)}</td>
                    <td className="ed-num">…{token.last4}</td>
                    <td className="ed-num">{token.lastUsedAt ? formatDateTime(token.lastUsedAt, ctx.locale) : t("list.never")}</td>
                    <td className="ed-num">{formatDate(token.expiresAt, ctx.locale)}</td>
                    <td>
                      <Stack gap={2}>
                        {token.consentAccepted ? null : (
                          <ActionForm
                            action={acceptAssistantConsent}
                            hidden={{ tokenId: token.id }}
                            refreshOnSuccess
                            variant="secondary"
                            block={false}
                            submitLabel={t("list.accept")}
                            pendingLabel={t("list.accepting")}
                          />
                        )}
                        <ActionForm
                          action={revokeAssistantToken}
                          hidden={{ tokenId: token.id }}
                          refreshOnSuccess
                          variant="danger-quiet"
                          block={false}
                          submitLabel={
                            <>
                              {t("list.revoke")}
                              <span className="ed-vh"> {token.name}</span>
                            </>
                          }
                          pendingLabel={t("list.revoking")}
                        />
                      </Stack>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {tokens.some((x) => !x.consentAccepted) ? <ConsentSummary /> : null}
          </Stack>
        )}
        <p className="ed-small ed-muted">{t("list.expiryNote", { days: MCP_INACTIVITY_DAYS })}</p>
      </Section>

      <Section title={t("create.title")} id="create">
        {atLimit ? (
          <p>{t("create.limit", { max: MCP_MAX_ACTIVE_TOKENS })}</p>
        ) : fresh ? (
          <CreateAssistant serverUrl={serverUrl} dataClasses={[...MCP_CONSENT_DATA_CLASSES]} />
        ) : (
          <FreshGate method={method} />
        )}
      </Section>
    </Page>
  );
}

/** The MCP4 warning in short, beside a token that still waits for consent. */
async function ConsentSummary() {
  const t = await getTranslations("mcp.consent");
  return (
    <div className="ed-small">
      <p>{t("lead")}</p>
      <ul className="ed-prose">
        {MCP_CONSENT_DATA_CLASSES.map((c) => (
          <li key={c}>{t(`classes.${c}`)}</li>
        ))}
      </ul>
      <p>{t("transfer")}</p>
    </div>
  );
}
