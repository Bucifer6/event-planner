/**
 * Link to a page of the public site (PUBLIC_URL), whose routes are /<locale><path> with a
 * trailing slash — e.g. publicUrl("ro", "/stare/").
 */
export function publicUrl(locale: string, path: string): string {
  const base = (process.env.PUBLIC_URL ?? "https://eventdesk.ro").replace(/\/+$/, "");
  return `${base}/${locale === "en" ? "en" : "ro"}${path}`;
}
