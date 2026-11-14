import { getFreshAuthMethod } from "@ed/auth";
import { isManager } from "@ed/core/access";
import { isFreshAuth } from "@ed/core/accounts";
import { listMembers, suggestedLabelKeys } from "@ed/core/members";
import { getOccasionView } from "@ed/core/occasions";
import { Notice, PageHeader, Section, Stack } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FreshGate } from "@/app/(app)/account/_components/fresh-gate";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";
import { MemberAccessForm, MemberLabelForm, RemoveMember, TransferOwnership } from "../TeamForms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("team"))("member.title") };
}

/**
 * One member: label, role, the two grants, removal, ownership. Everything that changes access
 * is a sensitive action (S4): it appears only after a fresh confirmation, asked for right here.
 */
export default async function MemberPage({ params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("team");
  const [{ occasion, member: me }, team, fresh, method] = await Promise.all([
    orNotFound(getOccasionView(ctx, id)),
    orNotFound(listMembers(ctx, id)),
    isFreshAuth(ctx),
    getFreshAuthMethod(ctx),
  ]);
  const target = team.find((m) => m.id === memberId);
  if (!target || !isManager(me)) notFound();
  const iAmOwner = me.role === "owner";
  if (target.role === "owner" && !iAmOwner) notFound();
  const suggestions = suggestedLabelKeys(occasion.kind).map((k) => t(`labels.${k}`));
  const canChangeAccess = iAmOwner && target.role !== "owner";
  const canRemove = target.role !== "owner" && (iAmOwner || target.role !== "pm");
  const sensitive = canChangeAccess || (canRemove && !target.pending);

  return (
    <div style={{ maxWidth: "var(--page-narrow)" }}>
      <PageHeader
        level={2}
        eyebrow={<Link href={`/occasions/${id}/team`}>{t("member.back")}</Link>}
        title={target.name}
        description={
          target.pending
            ? t("member.pending", { role: t(`roles.${target.role}`) })
            : target.customLabel
              ? `${t(`roles.${target.role}`)} · ${target.customLabel}`
              : t(`roles.${target.role}`)
        }
      />

      <Section title={t("label.title")} level={3}>
        <MemberLabelForm occasionId={id} memberId={target.id} label={target.customLabel ?? ""} suggestions={suggestions} />
      </Section>

      {sensitive && !fresh ? (
        <Section title={t("access.title")} level={3}>
          <Stack gap={4}>
            <Notice title={t("fresh.title")}>
              {t("fresh.body")} <Link href="/account#fresh">{t("fresh.link")}</Link>
            </Notice>
            <FreshGate method={method} />
          </Stack>
        </Section>
      ) : null}

      {canChangeAccess && fresh ? (
        <Section title={t("access.title")} level={3}>
          <MemberAccessForm
            occasionId={id}
            memberId={target.id}
            role={target.role}
            label={target.customLabel ?? ""}
            finance={target.grants.finance}
            privateRequests={target.grants.privateRequests}
          />
        </Section>
      ) : null}

      {iAmOwner && target.role !== "owner" && !target.pending && fresh ? (
        <Section title={t("transfer.sectionTitle")} level={3}>
          <p style={{ maxWidth: "var(--measure)" }}>{t("transfer.intro")}</p>
          <div>
            <TransferOwnership occasionId={id} memberId={target.id} name={target.name} />
          </div>
        </Section>
      ) : null}

      {canRemove && (fresh || target.pending) ? (
        <Section title={target.pending ? t("remove.sectionTitleInvite") : t("remove.sectionTitle")} level={3}>
          <p style={{ maxWidth: "var(--measure)" }}>{target.pending ? t("remove.introInvite") : t("remove.intro")}</p>
          <div>
            <RemoveMember occasionId={id} memberId={target.id} name={target.name} pending={target.pending} />
          </div>
        </Section>
      ) : null}
    </div>
  );
}
