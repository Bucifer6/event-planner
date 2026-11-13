import { isManager } from "@ed/core/access";
import { isFreshAuth } from "@ed/core/accounts";
import { listMembers, suggestedLabelKeys } from "@ed/core/members";
import { getOccasionView } from "@ed/core/occasions";
import { buttonClassName, DescriptionList, List, PageHeader, Row, Section, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { InviteMember } from "./TeamForms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("team"))("title") };
}

const ROLES = ["owner", "pm", "workstream_lead", "contributor", "supplier", "guest"] as const;

/** A5: who is on the team, in which role, and who holds the two separate grants (D2). */
export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("team");
  const [{ occasion, member }, team, fresh] = await Promise.all([
    orNotFound(getOccasionView(ctx, id)),
    orNotFound(listMembers(ctx, id)),
    isFreshAuth(ctx),
  ]);
  const manager = isManager(member);
  const suggestions = suggestedLabelKeys(occasion.kind).map((k) => t(`labels.${k}`));
  const joined = team.filter((m) => !m.pending);
  const invited = team.filter((m) => m.pending);

  return (
    <>
      <PageHeader
        level={2}
        title={t("title")}
        description={t("description")}
        actions={manager ? <InviteMember occasionId={id} isOwner={member.role === "owner"} fresh={fresh} suggestions={suggestions} /> : undefined}
      />

      <Section title={t("members.title")} level={3}>
        <List>
          {joined.map((m) => (
            <Row
              key={m.id}
              title={
                <>
                  {m.name} {m.isSelf ? <Tag plain>{t("you")}</Tag> : null}
                </>
              }
              meta={m.customLabel ? `${t(`roles.${m.role}`)} · ${m.customLabel}` : t(`roles.${m.role}`)}
              end={
                <>
                  {m.role !== "owner" && m.grants.finance ? <Tag tone="accent">{t("grants.financeShort")}</Tag> : null}
                  {m.role !== "owner" && m.grants.privateRequests ? <Tag tone="accent">{t("grants.privateRequestsShort")}</Tag> : null}
                  {manager && (m.role !== "owner" || member.role === "owner") ? (
                    <Link href={`/occasions/${id}/team/${m.id}`} className={buttonClassName({ size: "sm" })} aria-label={t("members.editFor", { name: m.name })}>
                      {t("members.edit")}
                    </Link>
                  ) : null}
                </>
              }
            />
          ))}
        </List>
        {joined.length === 1 && manager ? <p className="ed-muted">{t("members.alone")}</p> : null}
      </Section>

      {manager ? (
        <Section title={t("invited.title")} level={3}>
          {invited.length > 0 ? (
            <List>
              {invited.map((m) => (
                <Row
                  key={m.id}
                  title={m.name}
                  meta={m.customLabel ? `${t(`roles.${m.role}`)} · ${m.customLabel}` : t(`roles.${m.role}`)}
                  end={
                    <>
                      <Tag tone={m.inviteExpired ? "attention" : "neutral"}>{m.inviteExpired ? t("invited.expired") : t("invited.waiting")}</Tag>
                      <Link href={`/occasions/${id}/team/${m.id}`} className={buttonClassName({ size: "sm" })} aria-label={t("members.editFor", { name: m.name })}>
                        {t("members.edit")}
                      </Link>
                    </>
                  }
                />
              ))}
            </List>
          ) : (
            <p className="ed-muted">{t("invited.empty")}</p>
          )}
        </Section>
      ) : null}

      <Section title={t("rolesGuide.title")} level={3}>
        <DescriptionList cols={2} items={ROLES.map((r) => ({ term: t(`roles.${r}`), value: t(`roleHelp.${r}`) }))} />
        <p className="ed-small ed-muted" style={{ maxWidth: "var(--measure)" }}>
          {t("rolesGuide.grantsNote")}
        </p>
      </Section>
    </>
  );
}
