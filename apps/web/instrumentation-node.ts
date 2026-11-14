import "@ed/core/directory";
import "@ed/mcp";
import "@ed/core/closeout"; // release B money + lifecycle registrations (what-if kinds, exports, upload purpose)
import "@ed/core/payments"; // registers release B supplier-side exports, digest/overview sections, purge hook
import "@ed/core/deploys"; // registers the "deploy.production" approval action (R0-14)
import "@ed/core/complianceaccess"; // registers the "compliance.access" approval action (W8)
import "@ed/core/library"; // release P: business library What-if kind + upload purposes (also loads bizoccasions)
import "@ed/core/handover"; // release P: handover What-if kind (P22)
import "@ed/core/featured"; // release P: registers the Featured provider of the directory (inactive while monetization is off)
import "@ed/core/billing"; // release P: approval actions billing.* and monetization.* (dormant)
import "@ed/core/comms"; // release P: email template of platform notices (W7)
import "@ed/core/claims"; // release P: enquiries (stats provider, upload purpose), catalogues (moderation kind), discovery, claim approval action
import "@ed/core/catalogues";
import "@ed/core/seating"; // P-06 + release C: moderation kinds drawing/parking, upload purpose business.drawing, what-if space.*/seating.*, seating export, purge hook
import "@ed/core/requests"; // release C: programme/menus/public page/private requests — exports, guest sections, lifecycle impact, purge hooks, email templates (loads registrations, publicpage, programme, menus, guestevent)
import "@ed/core/tasks-proposals"; // MCP: What-if kind tasks.proposeList
import "@ed/core/plannotes"; // MCP: What-if kinds plan.shortlistNote, budget.proposeEstimates, budget.proposeNote; purge hook
import "@ed/core/invitationtext"; // MCP: What-if kind guests.invitationText
import "@ed/core/wiring"; // enquiry counts for the business report and the free-phase dashboard; console counters enquiries/discovery/claims
import "@ed/core/guestimport"; // release A gap: What-if kinds guests.import / guests.removeHousehold must exist before the proposals page lists or confirms them
import "@ed/core/polls"; // release A gap: guest section "polls" (was loaded only through lib/guest.ts)
import "@ed/core/contributions"; // release A gap: guest section "contributions" (was loaded only through lib/guest.ts)
import "@ed/core/itinerary"; // releases D + E: what-if itinerary.import, exports (itinerary, rooming list, arrivals), purge hooks, rehearsal timeline sources
import "@ed/core/rooms";
import "@ed/core/transport";
import "@ed/core/rehearsal";
import "@ed/core/checkin";
import "@ed/core/sustainability";
import { assertBootEnv, EnvError } from "@ed/shared/env";

// The app refuses to boot with a missing or invalid environment; only variable NAMES are
// printed, never values (R0-02, SEC13).
try {
  assertBootEnv();
} catch (e) {
  if (e instanceof EnvError) {
    console.error(`[boot] ${e.message}`);
    process.exit(1);
  }
  throw e;
}
