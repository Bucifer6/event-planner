/**
 * The help centre's structure. Wording lives in the `help*` i18n namespaces (ro + en):
 *   help.json                – the chrome of /help (titles, search, contact)
 *   <section ns>.json        – one object per article, keyed by its slug:
 *       { title, summary, keywords, where, need?, body: { p… | ol… | ul… | note… | h… } }
 * This file only says which articles exist, where they are listed, what they link to and which
 * app screens they describe. `apps/web/test/help.test.ts` keeps the two in step.
 */
export type HelpSectionKey =
  | "start"
  | "plan"
  | "guests"
  | "money"
  | "suppliers"
  | "space"
  | "travel"
  | "invited"
  | "business"
  | "account"
  | "privacy"
  | "trouble"
  | "staff";

export type HelpSection = { key: HelpSectionKey; ns: string; staffOnly?: boolean };

export const helpSections: HelpSection[] = [
  { key: "start", ns: "helpStart" },
  { key: "plan", ns: "helpPlan" },
  { key: "guests", ns: "helpGuests" },
  { key: "money", ns: "helpMoney" },
  { key: "suppliers", ns: "helpSuppliers" },
  { key: "space", ns: "helpSpace" },
  { key: "travel", ns: "helpTravel" },
  { key: "invited", ns: "helpInvited" },
  { key: "business", ns: "helpBusiness" },
  { key: "account", ns: "helpAccount" },
  { key: "privacy", ns: "helpPrivacy" },
  { key: "trouble", ns: "helpTrouble" },
  { key: "staff", ns: "helpStaff", staffOnly: true },
];

export type HelpArticleDef = {
  /** URL segment (/help/<slug>) and the article's key inside its section namespace. */
  slug: string;
  section: HelpSectionKey;
  /** "Vezi și": slugs of related articles. */
  related: string[];
  /**
   * The screens the article describes, as page patterns under apps/web/app (route groups
   * left out): "/occasions/[id]/budget". The first one decides the "open in the app" link.
   */
  routes: string[];
};

const a = (section: HelpSectionKey, slug: string, routes: string[], related: string[]): HelpArticleDef => ({
  slug,
  section,
  routes,
  related,
});

const O = "/occasions/[id]";
const B = "/business/[businessId]";

export const helpArticles: HelpArticleDef[] = [
  // Începe aici
  a("start", "how-eventdesk-works", ["/occasions"], ["create-occasion", "preview-changes", "private-by-default"]),
  a("start", "sign-in-with-code", ["/sign-in"], ["code-not-arrived", "anonymous-account", "two-step"]),
  a("start", "create-occasion", ["/occasions/new"], ["occasion-overview", "tasks", "add-guests"]),

  // Planifică o ocazie
  a("plan", "occasion-overview", [O], ["tasks", "preview-changes", "team-and-roles"]),
  a("plan", "tasks", [`${O}/tasks`, `${O}/tasks/new`, `${O}/tasks/[taskId]`], ["team-and-roles", "occasion-overview", "event-day"]),
  a("plan", "team-and-roles", [`${O}/team`, `${O}/team/[memberId]`, "/invite/[token]"], ["private-by-default", "tasks", "budget"]),
  a("plan", "preview-changes", [`${O}/proposals`, `${O}/settings`], ["date-poll", "facts-and-corrections", "assistants"]),
  a("plan", "date-poll", [`${O}/polls`], ["preview-changes", "guest-links", "answer-an-invitation"]),
  a("plan", "close-cancel-delete", [`${O}/settings`, `${O}/settings/closeout`], ["preview-changes", "delete-account", "expenses"]),

  // Invitați și răspunsuri
  a("guests", "add-guests", [`${O}/guests`, `${O}/guests/import`, `${O}/guests/[householdId]`], ["guest-links", "children-count-only", "rsvp-settings"]),
  a("guests", "guest-links", [`${O}/guests/[householdId]`, `${O}/guests`], ["what-is-a-guest-link", "link-expired", "stationery"]),
  a("guests", "rsvp-settings", [`${O}/guests/settings`, `${O}/guests/[householdId]`], ["add-guests", "last-place-taken", "public-event-page"]),
  a("guests", "contributions", [`${O}/contributions`], ["guest-links", "shared-costs"]),
  a("guests", "private-requests", [`${O}/requests`], ["private-by-default", "team-and-roles", "supplier-briefing"]),
  a("guests", "public-event-page", [`${O}/public-page`, "/e/[slug]"], ["rsvp-settings", "last-place-taken", "guest-privacy"]),

  // Bani
  a("money", "budget", [`${O}/budget`], ["expenses", "team-and-roles", "suppliers"]),
  a("money", "expenses", [`${O}/budget`, `${O}/budget/expenses/[expenseId]`], ["budget", "facts-and-corrections", "upload-refused"]),
  a("money", "shared-costs", [`${O}/ledger`], ["budget", "trip-groups-rooms", "team-and-roles"]),

  // Furnizori și ziua evenimentului
  a("suppliers", "suppliers", [`${O}/suppliers`, `${O}/suppliers/[supplierId]`], ["enquiries-and-quotes", "supplier-briefing", "budget"]),
  a("suppliers", "enquiries-and-quotes", ["/directory", "/directory/listing/[id]", "/directory/listing/[id]/enquire", `${O}/suppliers/enquiries`], ["honest-directory", "suppliers", "business-enquiries"]),
  a("suppliers", "supplier-briefing", [`${O}/suppliers/[supplierId]`, "/s/[token]"], ["suppliers", "deliveries", "private-requests"]),
  a("suppliers", "deliveries", [`${O}/deliveries`], ["facts-and-corrections", "supplier-briefing", "event-day"]),
  a("suppliers", "event-day", [`${O}/day`], ["check-in", "tasks", "deliveries"]),
  a("suppliers", "check-in", [`${O}/operate`, `${O}/operate/checkin`, `${O}/operate/rehearsal`, `${O}/operate/checklist`], ["offline-check-in", "facts-and-corrections", "event-day"]),

  // Sala, mesele și papetăria
  a("space", "room-plan", [`${O}/space`], ["seating", "business-drawings", "how-eventdesk-works"]),
  a("space", "seating", [`${O}/seating`], ["room-plan", "preview-changes", "add-guests"]),
  a("space", "stationery", [`${O}/stationery`], ["guest-links", "check-in", "upload-refused"]),

  // Călătorii
  a("travel", "itinerary", [`${O}/travel`, `${O}/travel/itinerary`, `${O}/travel/itinerary/import`], ["trip-groups-rooms", "preview-changes"]),
  a("travel", "trip-groups-rooms", [`${O}/travel/groups`, `${O}/travel/packing`, `${O}/travel/transport`, `${O}/travel/rooms`, `${O}/travel/settlement`], ["itinerary", "shared-costs", "tasks"]),

  // Pentru invitați
  a("invited", "what-is-a-guest-link", ["/g/[token]"], ["answer-an-invitation", "guest-privacy", "link-expired"]),
  a("invited", "answer-an-invitation", ["/g/[token]"], ["what-is-a-guest-link", "last-place-taken", "guest-privacy"]),
  a("invited", "guest-privacy", ["/g/[token]", "/e/[slug]"], ["children-count-only", "private-by-default", "report-content"]),

  // Pentru firme
  a("business", "business-account", ["/business"], ["business-listings", "business-team", "honest-directory"]),
  a("business", "business-listings", [`${B}`, `${B}/listings/new`, `${B}/listings/[listingId]`], ["business-moderation", "business-drawings", "upload-refused"]),
  a("business", "business-moderation", [`${B}/listings/[listingId]`, `${B}/settings`], ["business-listings", "honest-directory", "report-content"]),
  a("business", "business-enquiries", [`${B}/enquiries`, `${B}/enquiries/[enquiryId]`], ["enquiries-and-quotes", "business-catalogues", "business-team"]),
  a("business", "business-drawings", [`${B}/listings/[listingId]/spaces`, `${B}/listings/[listingId]/spaces/[spaceId]`], ["room-plan", "business-moderation", "upload-refused"]),
  a("business", "business-catalogues", [`${B}/catalogues`, `${B}/catalogues/[catalogueId]`], ["business-moderation", "business-enquiries"]),
  a("business", "claim-listing", ["/claim/[listingId]", "/claim/[listingId]/remove"], ["business-account", "report-content", "honest-directory"]),
  a("business", "business-team", [`${B}/team`, "/business/invite/[token]"], ["business-account", "business-occasions", "two-step"]),
  a("business", "business-occasions", [`${B}/occasions`, `${B}/occasions/[occasionId]`, `${B}/library`, `${B}/branding`], ["business-team", "team-and-roles", "private-by-default"]),

  // Cont și siguranță
  a("account", "anonymous-account", ["/sign-in/anonymous", "/sign-in/anonymous/new", "/sign-in/anonymous/recover"], ["sign-in-with-code", "two-step", "account-settings"]),
  a("account", "two-step", ["/account/security", "/sign-in/two-step"], ["sign-in-with-code", "account-settings", "anonymous-account"]),
  a("account", "account-settings", ["/account", "/account/email"], ["two-step", "delete-account", "assistants"]),
  a("account", "delete-account", ["/account/delete", "/account"], ["close-cancel-delete", "account-settings", "private-by-default"]),
  a("account", "assistants", ["/account/assistants"], ["preview-changes", "account-settings", "private-by-default"]),

  // Confidențialitate și reguli
  a("privacy", "private-by-default", [`${O}/team`], ["team-and-roles", "guest-privacy", "children-count-only"]),
  a("privacy", "children-count-only", [`${O}/guests`], ["add-guests", "guest-privacy", "private-requests"]),
  a("privacy", "facts-and-corrections", [`${O}/budget`, `${O}/deliveries`, `${O}/operate/checkin`], ["expenses", "deliveries", "check-in"]),
  a("privacy", "honest-directory", ["/directory"], ["enquiries-and-quotes", "business-moderation", "report-content"]),
  a("privacy", "report-content", ["/report"], ["honest-directory", "claim-listing", "guest-privacy"]),

  // Depanare
  a("trouble", "code-not-arrived", ["/sign-in"], ["sign-in-with-code", "anonymous-account", "two-step"]),
  a("trouble", "link-expired", ["/sign-in", "/g/[token]"], ["guest-links", "sign-in-with-code", "what-is-a-guest-link"]),
  a("trouble", "last-place-taken", ["/g/[token]", "/e/[slug]"], ["rsvp-settings", "public-event-page", "answer-an-invitation"]),
  a("trouble", "upload-refused", [`${O}/budget`], ["expenses", "business-listings", "stationery"]),
  a("trouble", "offline-check-in", [`${O}/operate/offline`, `${O}/operate/checkin`, "/offline"], ["check-in", "facts-and-corrections", "event-day"]),

  // Pentru echipa EventDesk (listed to staff only)
  a("staff", "staff-console-access", ["/console", "/console/setup", "/console/access"], ["two-step", "staff-approvals"]),
  a("staff", "staff-approvals", ["/console/approvals", "/console/compliance"], ["staff-console-access", "staff-incidents-deploys"]),
  a("staff", "staff-moderation", ["/console/moderation", "/console/moderation/[id]", "/console/reports", "/console/businesses"], ["business-moderation", "report-content", "staff-approvals"]),
  a("staff", "staff-incidents-deploys", ["/console/incidents", "/console/deploys"], ["staff-approvals", "staff-console-access"]),
];

const bySlug = new Map(helpArticles.map((x) => [x.slug, x]));

export function getHelpArticleDef(slug: string): HelpArticleDef | undefined {
  return bySlug.get(slug);
}

export function sectionOf(key: HelpSectionKey): HelpSection {
  return helpSections.find((s) => s.key === key)!;
}

/** Contextual help: the article a screen's `<HelpLink topic>` opens. */
export const helpTopics = {
  overview: "occasion-overview",
  tasks: "tasks",
  guests: "add-guests",
  budget: "budget",
  ledger: "shared-costs",
  suppliers: "suppliers",
  day: "event-day",
  seating: "seating",
  stationery: "stationery",
  travel: "itinerary",
  operate: "check-in",
  business: "business-account",
  account: "account-settings",
  assistants: "assistants",
} as const satisfies Record<string, string>;

export type HelpTopic = keyof typeof helpTopics;

/**
 * Where an article's "open in the app" link goes: the route itself when it has no dynamic
 * segment, otherwise the list the person picks from. Guest, supplier and claim links have no
 * such place (the link itself is the way in), so they get no button.
 */
const OPENERS: Array<{ prefix: string; href: string; key: string; signedIn: boolean }> = [
  { prefix: "/occasions", href: "/occasions", key: "occasions", signedIn: true },
  { prefix: "/business", href: "/business", key: "business", signedIn: true },
  { prefix: "/account", href: "/account", key: "account", signedIn: true },
  { prefix: "/console", href: "/console", key: "console", signedIn: true },
  { prefix: "/directory", href: "/directory", key: "directory", signedIn: false },
  { prefix: "/report", href: "/report", key: "report", signedIn: false },
  { prefix: "/sign-in", href: "/sign-in", key: "signIn", signedIn: false },
];

export type HelpOpener = { href: string; key: string; signedIn: boolean };

export function openerFor(route: string): HelpOpener | null {
  const hit = OPENERS.find((o) => route === o.prefix || route.startsWith(`${o.prefix}/`));
  if (!hit) return null;
  // A fully static route can be opened directly; a dynamic one opens its list.
  const href = route.includes("[") ? hit.href : route;
  return { href, key: hit.key, signedIn: hit.signedIn };
}
