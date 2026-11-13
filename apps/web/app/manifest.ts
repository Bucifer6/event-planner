import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

// Installable PWA (B11, Q1). Ivory paper as theme and background; the seal as icon.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("platform.manifest");
  return {
    name: "EventDesk",
    short_name: "EventDesk",
    description: t("description"),
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    lang: "ro",
    background_color: "#f5f2ec",
    theme_color: "#f5f2ec",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
