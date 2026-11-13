import type { ParkingView } from "@ed/core/drawings";
import { DescriptionList, Unknown } from "@ed/ui";

export type ParkingLabels = {
  unknown: string;
  yes: string;
  no: string;
  noneOnSite: string;
  onSite: string;
  spaceCount: string;
  onStreet: string;
  paid: string;
  accessibleSpaces: string;
  walkingDistance: string;
  /** "{m} m" already formatted by the caller */
  metres: (m: number) => string;
};

/**
 * V10: the venue's parking facts — each one known or "necunoscut", never guessed; a venue
 * without parking says so in words. Shared by the public listing and the guest page.
 */
export function ParkingFacts({ view, labels }: { view: ParkingView; labels: ParkingLabels }) {
  const unknown = <Unknown label={labels.unknown} />;
  const yesNo = (v: boolean | null) => (v === null ? unknown : v ? labels.yes : labels.no);
  return (
    <DescriptionList
      cols={2}
      items={[
        { term: labels.onSite, value: view.onSite === null ? unknown : view.onSite ? labels.yes : <strong>{labels.noneOnSite}</strong> },
        ...(view.onSite === false ? [] : [{ term: labels.spaceCount, value: view.spaceCount === null ? unknown : String(view.spaceCount) }]),
        { term: labels.onStreet, value: yesNo(view.onStreet) },
        { term: labels.paid, value: yesNo(view.paid) },
        ...(view.onSite === false ? [] : [{ term: labels.accessibleSpaces, value: yesNo(view.accessibleSpaces) }]),
        { term: labels.walkingDistance, value: view.walkingDistanceM === null ? unknown : labels.metres(view.walkingDistanceM) },
      ]}
    />
  );
}
