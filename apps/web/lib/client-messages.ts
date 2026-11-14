import { HOUSE_DESIGN_KEYS } from "@ed/core/stationerykit";

// What the browser needs of the message catalogue. Every page used to carry the whole
// catalogue (about 640 KB of Romanian) because the root provider got all of it. Server
// components translate on the server, so the browser needs only the namespaces that client
// components read (useTranslations("ns")) and the ones the What-if panel resolves at run time
// (proposal titles and rows from any domain). apps/web/test/client-messages.test.ts scans the
// client components and fails if one of them reads a namespace that is left out here.

/** Namespaces only server code reads: never sent to the browser. */
export const SERVER_ONLY_NAMESPACES = [
  "briefing", "business", "contributions", "corrections", "directory", "emails", "guestevent", "guides",
  "help", "helpAccount", "helpBusiness", "helpGuests", "helpInvited", "helpMoney", "helpPlan", "helpPrivacy",
  "helpSpace", "helpStaff", "helpStart", "helpSuppliers", "helpTravel", "helpTrouble",
  "legal", "menus", "nav", "operate", "overview", "polls", "printpack", "programme", "requests", "rsvp", "site",
] as const;

/** Parts of the stationery namespace the designer gets as ready strings from the server. */
const STATIONERY_SERVER_ONLY = ["starters", "styles", "palettes", "colourways", "presets", "defaults", "pdf"] as const;

type Messages = Record<string, unknown>;

/** The catalogue minus what only the server reads. */
export function clientMessages(all: Messages): Messages {
  const out: Messages = {};
  for (const [ns, value] of Object.entries(all)) {
    if ((SERVER_ONLY_NAMESPACES as readonly string[]).includes(ns)) continue;
    out[ns] = value;
  }
  const st = out.stationery as Record<string, unknown> | undefined;
  if (st) {
    const slim: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(st)) if (!(STATIONERY_SERVER_ONLY as readonly string[]).includes(k)) slim[k] = v;
    // the designer shows a house design's blurb; every other design name arrives as a string
    const designs = (st.designs ?? {}) as Record<string, unknown>;
    slim.designs = Object.fromEntries(HOUSE_DESIGN_KEYS.map((k) => [k, designs[k]]).filter(([, v]) => v));
    out.stationery = slim;
  }
  return out;
}
