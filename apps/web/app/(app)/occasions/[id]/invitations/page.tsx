import { requireUser } from '../../../../lib/session';
import { getLocale, tf } from '../../../../lib/i18n';
import { listInvitationDesigns } from '@eventdesk/core';
import { invitationDesignAction, invitationProofAction } from '../../../../actions/releasec';

// C-04: invitation/stationery designer — versioned designs, proof step before send,
// print-ready PDF per approved version (rendered from the same records).
export default async function InvitationsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const locale = await getLocale();
  const t = tf(locale);
  const designs = await listInvitationDesigns(id, user.accountId);

  return (
    <>
      <h2>{t('c.inv.title')}</h2>
      <form action={invitationDesignAction.bind(null, id)}>
        <label htmlFor="text">{t('c.inv.text')}</label>
        <textarea id="text" name="text" rows={4} required />
        <label htmlFor="layout">{t('c.inv.layout')}</label>
        <select id="layout" name="layout" defaultValue="classic">
          <option value="classic">{t('c.inv.layout.classic')}</option>
          <option value="minimal">{t('c.inv.layout.minimal')}</option>
        </select>
        <div className="actions">
          <button className="btn" type="submit">
            {t('c.inv.new_version')}
          </button>
        </div>
      </form>
      {designs.map((d) => (
        <div key={d.id} className="card">
          <strong>v{d.version}</strong> {d.proofApprovedAt ? '· proof ✓' : ''}{' '}
          {d.pdfAssetId ? '· PDF ✓' : ''}
          <pre className="mono">{JSON.stringify(d.content).slice(0, 200)}</pre>
          {!d.proofApprovedAt && (
            <form action={invitationProofAction.bind(null, id, d.id)}>
              <button className="btn" type="submit">
                {t('c.inv.approve_proof')}
              </button>
            </form>
          )}
        </div>
      ))}
    </>
  );
}
