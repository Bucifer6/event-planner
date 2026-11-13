import type { Tone } from "@ed/ui";

/** Tag tone of each booking state (always shown with its words). */
export const STATE_TONE: Record<string, Tone> = {
  enquired: "neutral",
  quoted: "accent",
  booked: "accent",
  confirmed: "success",
  delivered: "success",
  cancelled: "danger",
};

/** "2027-06-12" → "12.06.2027". */
export const dayText = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
