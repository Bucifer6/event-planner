import type { PublicListing } from "@ed/core/directory";

/**
 * SLOT — "Trimite o cerere" (P8–P11). The enquiries agent (P-05) implements this component;
 * until then it renders nothing: no disabled button, no placeholder text.
 *
 * Contract for the implementer:
 *  - it is rendered on the listing page ONLY for claimed listings (`listing.acceptsEnquiries`);
 *    an unclaimed listing never shows it (P29) — keep the guard below;
 *  - it is the page's one primary action; a signed-out visitor should be sent to sign in first;
 *  - `occasionId` is set when the visitor arrived from an occasion ("Găsește firme").
 */
export function EnquiryCta({ listing }: { listing: PublicListing; occasionId?: string | null }) {
  if (!listing.acceptsEnquiries) return null;
  return null;
}
