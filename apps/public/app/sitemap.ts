import { defaultLocale, locales } from "@ed/i18n/config";
import type { MetadataRoute } from "next";
import { SITE_URL, allPaths, href } from "@/lib/site";

export const dynamic = "force-static";

// Static sitemap.xml: every page in both languages, with hreflang alternates.
export default function sitemap(): MetadataRoute.Sitemap {
  return allPaths.flatMap((path) =>
    locales.map((locale) => ({
      url: `${SITE_URL}${href(locale, path)}`,
      alternates: {
        languages: {
          ...Object.fromEntries(locales.map((l) => [l, `${SITE_URL}${href(l, path)}`])),
          "x-default": `${SITE_URL}${href(defaultLocale, path)}`,
        },
      },
    })),
  );
}
