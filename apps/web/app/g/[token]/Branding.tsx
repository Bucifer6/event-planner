import type { OccasionBranding } from "@ed/core/bizoccasions";
import type { CSSProperties, ReactNode } from "react";
import styles from "./branding.module.css";

// RELEASE P (P20): the business's name, logo and ONE accent on the guest-facing pages of an
// occasion it runs — until handover (P22), when getOccasionBranding returns null.
//
// The accent is applied as it was chosen: the app never comments on the business's colour.
// Our own build rule keeps the page readable whatever the colour is — the accent fills the
// primary button with text in ink or ivory chosen from its luminance (`onAccent`), and
// elsewhere it is only ever a line (rule, link underline), never the colour of body text.
// CSP: `style-src-attr 'unsafe-inline'` allows this style attribute; no <style> tag is needed.

/** Props for the element that wraps the whole guest page (sets the scoped custom properties). */
export function brandScope(branding: OccasionBranding | null): { className?: string; style?: CSSProperties } {
  if (!branding?.accent || !branding.onAccent) return {};
  return { className: styles.scope, style: { "--brand": branding.accent, "--brand-on": branding.onAccent } as CSSProperties };
}

/** "Organizat de …" with the logo, shown at the top of the guest page. */
export function BrandBlock({ branding, label }: { branding: OccasionBranding; label: ReactNode }) {
  return (
    <div className={styles.block}>
      {branding.logoUrl ? <img className={styles.logo} src={branding.logoUrl} alt="" /> : null}
      <p className={styles.line}>
        <span className="ed-label">{label}</span>
        <span className={styles.name}>{branding.name}</span>
      </p>
    </div>
  );
}
