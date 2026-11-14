export const appearances = [
  { id: 'atelier', name: 'Atelier' },
  { id: 'nocturne', name: 'Nocturne' },
  { id: 'riviera', name: 'Riviera' },
  { id: 'folio', name: 'Folio' },
  { id: 'herbarium', name: 'Herbarium' },
  { id: 'prism', name: 'Prism' },
  { id: 'salon', name: 'Salon' },
  { id: 'dune', name: 'Dune' },
  { id: 'ledger', name: 'Ledger' },
  { id: 'muse', name: 'Muse' },
] as const;

export type Appearance = (typeof appearances)[number]['id'];
export const appearanceKey = 'planner-appearance';

export function isAppearance(value: unknown): value is Appearance {
  return appearances.some(({ id }) => id === value);
}
