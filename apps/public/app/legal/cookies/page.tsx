// LAU1: cookie notice — exactly three cookies, none for tracking or advertising,
// re-shown only when the cookie set changes (shown in-app).
export default function Cookies() {
  return (
    <main className="wrap">
      <h1>Avis privind cookie-urile / Cookie notice</h1>
      <ul>
        <li>
          <code>ed_session</code> — sesiunea de autentificare (HttpOnly, Secure, SameSite=Lax)
        </li>
        <li>
          <code>ed_device</code> — cookie simplu, divulgat, pentru limitarea de rată pe dispozitiv
          (SEC16); nu este un tracker
        </li>
        <li>
          <code>ed_lang</code> — preferința de limbă
        </li>
      </ul>
      <p>Niciunul dintre aceste cookie-uri nu este folosit pentru tracking sau publicitate (D1).</p>
      <p>
        None of these cookies is used for tracking or advertising. English: the app uses exactly
        three cookies — session, disclosed device rate-limit cookie, language preference.
      </p>
    </main>
  );
}
