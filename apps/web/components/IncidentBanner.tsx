import Link from 'next/link';
import { getActiveIncident } from '@eventdesk/core';

// LAU5: while an incident is active, guest-facing pages show a plain-language status
// message — never a raw stack trace — with a link to the public status page.
export default async function IncidentBanner() {
  const inc = await getActiveIncident();
  if (!inc) return null;
  const site = process.env.PUBLIC_SITE_URL ?? 'https://eventdesk.ro';
  return (
    <div className="notice" role="status">
      {inc.impact}{' '}
      <Link href={`${site}/status`} rel="noopener noreferrer">
        Status
      </Link>
    </div>
  );
}
