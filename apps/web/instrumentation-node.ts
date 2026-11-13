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
