import type { PublicListing } from "@ed/core/directory";

/**
 * SLOT — venue drawings (P-06) and flower catalogues (P-07) of a listing. Later agents render
 * their approved, public content here (each as its own <Section>); until then it renders
 * nothing. Unclaimed listings carry no uploads (P29) — keep the guard.
 */
export function ListingExtras({ listing }: { listing: PublicListing }) {
  if (!listing.claimed) return null;
  return null;
}
