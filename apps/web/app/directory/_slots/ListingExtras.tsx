import type { PublicListing } from "@ed/core/directory";
import { ListingCatalogues } from "./ListingCatalogues";
import { ListingDrawings } from "./ListingDrawings";

/**
 * Venue drawings (P-06) and flower catalogues (P-07) of a listing, each as its own <Section>.
 * Unclaimed listings carry no uploads (P29) — keep the guard.
 */
export function ListingExtras({ listing }: { listing: PublicListing }) {
  if (!listing.claimed) return null;
  return (
    <>
      <ListingDrawings listing={listing} />
      <ListingCatalogues listing={listing} />
    </>
  );
}
