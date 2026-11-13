import "@ed/core/directory";
import "@ed/mcp";
import "@ed/core/closeout"; // release B money + lifecycle registrations (what-if kinds, exports, upload purpose)
import "@ed/core/payments"; // registers release B supplier-side exports, digest/overview sections, purge hook
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
