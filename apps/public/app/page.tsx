import Link from 'next/link';
import { t } from '@eventdesk/i18n';

// Public landing (eventdesk.ro). No cookies, no third-party scripts (D1).
// Legal pages are operator-owned content per LAU1/LAU6/LAU9.
export default function Landing() {
  return (
    <>
      <nav className="top">
        <strong>EventDesk.ro</strong>
        <Link href="/for-businesses">For businesses / Pentru firme</Link>
        <Link href="/legal/terms">Termeni și condiții</Link>
        <Link href="/legal/privacy">Confidențialitate</Link>
        <Link href="/status">Status</Link>
        <Link href="https://app.eventdesk.ro/report">Raportează / Report</Link>
        <Link href="/?lang=en">EN</Link>
      </nav>
      <main className="wrap">
        <section className="hero">
          <h1>{t('ro', 'app.tagline')}</h1>
          <p className="lead">{t('ro', 'site.hero.lead')}</p>
          <p>
            <Link className="cta" href="https://app.eventdesk.ro/signin">
              {t('ro', 'auth.signin.title')}
            </Link>
          </p>
          <ul className="features">
            <li>{t('ro', 'site.hero.f1')}</li>
            <li>{t('ro', 'site.hero.f2')}</li>
            <li>{t('ro', 'site.hero.f3')}</li>
          </ul>
        </section>
      </main>
      <footer>EventDesk.ro — București · ANSPDCP · GDPR</footer>
    </>
  );
}
