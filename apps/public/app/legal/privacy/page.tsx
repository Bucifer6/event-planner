// LAU1/LAU2: privacy policy shell; ANSPDCP is the Romanian supervisory authority.
export default function Privacy() {
  return (
    <main className="wrap">
      <h1>Politica de confidențialitate / Privacy policy</h1>
      <p>
        Operatorul este responsabil de date (controller) conform GDPR, cu ANSPDCP drept autoritate
        de supraveghere. Datele sunt găzduite în UE (INF9). Nu folosim cookie-uri de urmărire și
        nici scripturi terțe pe site-ul public (D1); în aplicație folosim exact trei cookie-uri
        (sesiune, cookie de rată-limită pentru dispozitiv, preferință de limbă), niciunul pentru
        tracking sau publicitate (LAU1). Păstrarea datelor urmează tabelul de retenție INF6;
        ștergerea contului are o fereastră de anulare de 7 zile (D6).
      </p>
      <p>
        The operator is the data controller under GDPR; ANSPDCP is the supervisory authority. Data
        is hosted in the EU. No tracking cookies and no third-party scripts on the public site; the
        app uses exactly three cookies (session, device rate-limit, language preference). Retention
        follows the INF6 table; account deletion has a 7-day undo window.
      </p>
    </main>
  );
}
