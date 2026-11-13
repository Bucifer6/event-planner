import { isFreshAuth } from "@ed/core/accounts";
import { canManageRole, getBusinessView, listBusinessMembers } from "@ed/core/business";
import { DescriptionList, List, Notice, Section, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { changeBusinessMemberRole, inviteBusinessMemberAction, removeBusinessMemberAction } from "@/app/actions/business";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { orNotFound } from "@/app/(app)/occasions/_lib/load";
import { SpecForm } from "@/app/console/_components/SpecForm";
import { requireCtx } from "@/lib/ctx";
import styles from "../../business.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("business"))("tabs.team") };
}

/**
 * P18: one owner, admins and staff. The owner manages everyone; an admin manages staff only —
 * an admin cannot create or remove admins. Every change needs a fresh confirmation (S4).
 */
export default async function BusinessTeamPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("business");
  const [view, team, fresh] = await Promise.all([orNotFound(getBusinessView(ctx, businessId)), orNotFound(listBusinessMembers(ctx, businessId)), isFreshAuth(ctx)]);
  const me = view.role;
  const canInvite = me !== "staff" && view.business.status === "active";
  const inviteRoles = (["staff", "admin"] as const).filter((r) => canManageRole(me, null, r));
  const joined = team.filter((m) => !m.pending);
  const invited = team.filter((m) => m.pending);

  return (
    <div className={styles.narrow}>
      {me !== "staff" && !fresh ? (
        <Notice title={t("team.freshTitle")}>
          {t("team.freshBody")} <Link href="/account#fresh">{t("team.freshLink")}</Link>
        </Notice>
      ) : null}

      <Section title={t("team.membersTitle")} level={2}>
        <List>
          {joined.map((m) => {
            const promote = m.role === "staff" && canManageRole(me, "staff", "admin");
            const demote = m.role === "admin" && canManageRole(me, "admin", "staff");
            const remove = !m.isSelf && canManageRole(me, m.role, null);
            const leave = m.isSelf && m.role !== "owner";
            return (
              <li key={m.id} className="ed-row">
                <div className="ed-row__main">
                  <span className="ed-row__title">
                    {m.name} {m.isSelf ? <Tag plain>{t("team.you")}</Tag> : null}
                  </span>
                  <span className="ed-row__meta">{t(`roles.${m.role}`)}</span>
                </div>
                {fresh && (promote || demote || remove || leave) ? (
                  <div className={`ed-row__end ${styles.inlineForms}`}>
                    {promote || demote ? (
                      <ActionForm
                        action={changeBusinessMemberRole}
                        hidden={{ businessId, memberId: m.id, role: promote ? "admin" : "staff" }}
                        refreshOnSuccess
                        variant="secondary"
                        block={false}
                        submitLabel={promote ? t("team.makeAdmin") : t("team.makeStaff")}
                        pendingLabel={t("team.saving")}
                      />
                    ) : null}
                    {remove || leave ? (
                      <ActionForm
                        action={removeBusinessMemberAction}
                        hidden={{ businessId, memberId: m.id }}
                        refreshOnSuccess
                        variant="danger-quiet"
                        block={false}
                        submitLabel={leave ? t("team.leave") : t("team.remove")}
                        pendingLabel={t("team.removing")}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </List>
        {joined.length === 1 ? <p className="ed-muted">{t("team.alone")}</p> : null}
      </Section>

      {invited.length > 0 ? (
        <Section title={t("team.invitedTitle")} level={2}>
          <List>
            {invited.map((m) => (
              <li key={m.id} className="ed-row">
                <div className="ed-row__main">
                  <span className="ed-row__title">{m.name}</span>
                  <span className="ed-row__meta">{t(`roles.${m.role}`)}</span>
                </div>
                <div className={`ed-row__end ${styles.inlineForms}`}>
                  <Tag tone={m.inviteExpired ? "attention" : "neutral"}>{m.inviteExpired ? t("team.inviteExpired") : t("team.inviteWaiting")}</Tag>
                  {fresh && canManageRole(me, m.role, null) ? (
                    <ActionForm
                      action={removeBusinessMemberAction}
                      hidden={{ businessId, memberId: m.id }}
                      refreshOnSuccess
                      variant="danger-quiet"
                      block={false}
                      submitLabel={t("team.withdrawInvite")}
                      pendingLabel={t("team.removing")}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </List>
        </Section>
      ) : null}

      {canInvite ? (
        <Section title={t("team.inviteTitle")} level={2}>
          {fresh ? (
            <SpecForm
              action={inviteBusinessMemberAction}
              hidden={{ businessId }}
              fields={[
                { kind: "email", name: "email", label: t("team.email"), hint: t("team.emailHint"), required: true, maxLength: 320 },
                {
                  kind: "chips",
                  name: "role",
                  label: t("team.role"),
                  required: true,
                  defaultValue: "staff",
                  options: inviteRoles.map((r) => ({ value: r, label: t(`roles.${r}`) })),
                },
              ]}
              submitLabel={t("team.invite")}
              pendingLabel={t("team.inviting")}
              success={t("team.invited")}
              refreshOnSuccess
            />
          ) : (
            <p className="ed-muted">{t("team.inviteNeedsFresh")}</p>
          )}
        </Section>
      ) : null}

      <Section title={t("team.rolesTitle")} level={2}>
        <DescriptionList items={(["owner", "admin", "staff"] as const).map((r) => ({ term: t(`roles.${r}`), value: t(`roleHelp.${r}`) }))} />
      </Section>
    </div>
  );
}
