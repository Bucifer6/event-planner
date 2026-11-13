import { defaultLocale, locales, type Locale } from "@ed/i18n/config";
import type { Metadata } from "next";

/** Where the planning app lives. Operator knob: NEXT_PUBLIC_APP_URL. */
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.eventdesk.ro").replace(/\/+$/, "");
/** Canonical origin of this site (hreflang, sitemap). Operator knob: NEXT_PUBLIC_SITE_URL. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://eventdesk.ro").replace(/\/+$/, "");

export const appLinks = {
  signIn: `${APP_URL}/sign-in`,
  report: `${APP_URL}/report`,
} as const;

/**
 * One slug set for both languages: /ro/pentru-firme/ and /en/pentru-firme/ are the same page.
 * Paths are locale-less and always end with a slash (static export uses trailingSlash).
 */
export const paths = {
  home: "/",
  how: "/cum-functioneaza/",
  business: "/pentru-firme/",
  guides: "/ghiduri/",
  terms: "/termeni/",
  privacy: "/confidentialitate/",
  cookies: "/cookies/",
  accessibility: "/accesibilitate/",
  moderation: "/reguli-moderare/",
  status: "/stare/",
} as const;
export type PathKey = keyof typeof paths;

export const guideSlugs = [
  "calendar-nunta",
  "lista-botez",
  "brief-locatie",
  "eticheta-rsvp",
  "buget-categorii-uitate",
  "calatorie-de-grup",
] as const;
export type GuideSlug = (typeof guideSlugs)[number];

export const guidePath = (slug: string) => `${paths.guides}${slug}/`;

/** Every public path, for the sitemap. */
export const allPaths: string[] = [...Object.values(paths), ...guideSlugs.map(guidePath)];

export function href(locale: Locale | string, path: string): string {
  return `/${locale}${path}`;
}

/** Title, description, canonical and hreflang alternates for one page. */
export function pageMetadata(locale: Locale, path: string, title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: {
      canonical: `${SITE_URL}${href(locale, path)}`,
      languages: {
        ...Object.fromEntries(locales.map((l) => [l, `${SITE_URL}${href(l, path)}`])),
        "x-default": `${SITE_URL}${href(defaultLocale, path)}`,
      },
    },
    openGraph: {
      type: "website",
      title,
      description,
      url: `${SITE_URL}${href(locale, path)}`,
      locale: locale === "ro" ? "ro_RO" : "en_GB",
    },
  };
}
