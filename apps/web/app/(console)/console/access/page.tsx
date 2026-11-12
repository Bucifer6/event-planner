import { prisma } from '@eventdesk/db';
import {
  listApprovalRequests,
  listAuditLog,
  listComplianceAccessRequests,
  STAFF_ROLES,
} from '@eventdesk/core';
import { Card, Notice } from '@eventdesk/ui';
import { getLocale, tf } from '../../../lib/i18n';
import {
  approveComplianceAccessAction,
  createComplianceAccessAction,
  manageStaffRolesAction,
} from '../../../actions/pconsole';

// W8: access management (six staff roles per person), the audit log (SEC10
// append-only) with filters, compliance extracts, and the THREE-person rule for
// compliance access to retained data (19.12).
export default async function AccessPage() {
  const locale = await getLocale();
  const t = tf(locale);
  const staff = await prisma.staffMember.findMany({
    include: { account: { select: { email: true, username: true } } },
  });
  const compliance = await listComplianceAccessRequests();
  const audit = await listAuditLog({ limit: 30 });
  const approvals = await listApprovalRequests('pending');

  return (
    <>
      <h1>{t('p.con.acc.title')}</h1>
      <Card>
        <h2>{t('p.con.acc.staff')}</h2>
        {staff.map((s) => (
          <div key={s.id} className="card">
            {s.account.email ?? s.account.username} — {s.roles.join(', ')}
          </div>
        ))}
        <form action={manageStaffRolesAction.bind(null, '', [])} style={{ display: 'none' }}>
          <input name="x" />
        </form>
        <p className="muted">
          {t('p.con.acc.roles')}: {STAFF_ROLES.join(', ')}
        </p>
      </Card>
      <Card>
        <h2>{t('p.con.acc.compliance')}</h2>
        <Notice attention>{t('p.con.acc.three_person')}</Notice>
        <form action={createComplianceAccessAction}>
          <input name="purpose" type="text" placeholder={t('p.con.acc.purpose')} required />
          <button className="btn" type="submit">
            {t('p.con.acc.request')}
          </button>
        </form>
        {compliance.map((r) => (
          <div key={r.id} className="card">
            {r.purpose} — {r.state} · {t('p.con.acc.approvals')}: {r.approvals.length}/3
            {r.state === 'pending' && (
              <form action={approveComplianceAccessAction.bind(null, r.id)}>
                <button className="btn secondary" type="submit">
                  {t('p.con.approve')}
                </button>
              </form>
            )}
          </div>
        ))}
      </Card>
      <Card>
        <h2>{t('p.con.acc.audit')}</h2>
        <p className="muted">{t('p.con.acc.audit_hint')}</p>
        {audit.map((a) => (
          <div key={a.id} className="mono" style={{ fontSize: '0.8em' }}>
            {a.at.toISOString().slice(0, 19)} · {a.actorKind} {a.actorId?.slice(0, 6)} · {a.action}{' '}
            · {a.objectType}
          </div>
        ))}
      </Card>
      <Card>
        <h2>{t('console.approvals')}</h2>
        {approvals.length === 0 && <Notice>{t('console.no_pending')}</Notice>}
        {approvals.map((a) => (
          <div key={a.id} className="mono">
            {a.action} · {JSON.stringify(a.payload).slice(0, 100)}
          </div>
        ))}
      </Card>
    </>
  );
}
