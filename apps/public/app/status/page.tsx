// LAU5: guest-facing status gets a plain-language message, never a stack trace.
export default function Status() {
  return (
    <main className="wrap">
      <h1>Status / Stare</h1>
      <p>Toate sistemele funcționează. / All systems operational.</p>
      <p>
        Dacă vezi „ceva nu funcționează", încearcă din nou în câteva minute — dacă problema
        persistă, contactează operatorul. / If you see „something is not working", retry in a few
        minutes.
      </p>
    </main>
  );
}
