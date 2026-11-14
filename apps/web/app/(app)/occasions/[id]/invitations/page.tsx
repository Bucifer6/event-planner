import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { canManage, getOccasionForMember, listInvitationDesigns } from '@eventdesk/core';
import { invitationDesignAction, invitationProofAction } from '../../../../actions/releasec';
import { InvitationCard } from '../../../../../components/InvitationCard';
import { InvitationDesigner } from '../../../../../components/InvitationDesigner';
import { findInvitationTemplate, invitationKind } from '../../../../lib/invitation-templates';
import { invitationDetail } from '../../../../lib/invitation-detail';

// C-04: invitation/stationery designer — versioned designs, proof step before send,
// print-ready PDF per approved version (rendered from the same records).
export default async function InvitationsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const [{ occasion, member }, designs] = await Promise.all([
    getOccasionForMember(id, user.accountId),
    listInvitationDesigns(id, user.accountId),
  ]);
  const canApprove = member.role === 'owner' || member.role === 'project_manager';

  return (
    <>
      <h2>{t('c.inv.title')}</h2>
      {canManage(member) && (
        <InvitationDesigner
          action={invitationDesignAction.bind(null, id)}
          kind={invitationKind(occasion.kind)}
          locale={locale}
          title={occasion.title}
          detail={invitationDetail(occasion, locale)}
        />
      )}
      {designs.map((design) => {
        const content = design.content;
        const fields =
          content && typeof content === 'object' && !Array.isArray(content) ? content : {};
        const template =
          typeof fields.templateId === 'string'
            ? findInvitationTemplate(fields.templateId)
            : undefined;
        const text = typeof fields.text === 'string' ? fields.text : JSON.stringify(content);
        return (
          <article key={design.id} className="card invitation-history">
            <strong>v{design.version}</strong>
            {design.proofApprovedAt && <> · {t('c.inv.proof_status')}</>}
            {design.pdfAssetId && <> · {t('c.inv.pdf_status')}</>}
            {template ? (
              <InvitationCard
                template={template}
                title={typeof fields.title === 'string' ? fields.title : occasion.title}
                detail={typeof fields.detail === 'string' ? fields.detail : undefined}
                text={text}
              />
            ) : (
              <pre>{text}</pre>
            )}
            {canApprove && !design.proofApprovedAt && (
              <form action={invitationProofAction.bind(null, id, design.id)}>
                <button className="btn" type="submit">
                  {t('c.inv.approve_proof')}
                </button>
              </form>
            )}
          </article>
        );
      })}
    </>
  );
}
