import Link from 'next/link';

// "For businesses" page (PRD section 11). Free phase: everything is free at launch
// (MON1); monetization is enabled later from the admin console with 60 days' notice.
export default function ForBusinesses() {
  return (
    <main className="wrap">
      <h1>Pentru firme / For businesses</h1>
      <p>
        La lansare, întreaga platformă este gratuită pentru toată lumea — planificatori, invitați și
        firme. Nu există preț, casă de marcat sau card nicăieri în produs (MON1). Când monetizarea
        va fi activată din consola de administrare, cu 60 de zile de preaviz public, doar planul
        Business și plasarea Promovat devin plătite; contul, listarea, cererile și statisticile
        rămân gratuite permanent.
      </p>
      <p>
        At launch the whole platform is free for everyone — planners, guests and businesses. There
        is no pricing, checkout or card entry anywhere in the product. When monetization is later
        enabled from the admin console with 60 days&apos; public notice, only the Business plan and
        Featured placement become paid; accounts, listings, enquiries and own statistics stay free
        permanently.
      </p>
      <Link className="cta" href="https://app.eventdesk.ro/signin">
        Listează-te gratuit / List free
      </Link>
    </main>
  );
}
