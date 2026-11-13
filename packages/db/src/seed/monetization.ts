import { monetizationSwitch, MONETIZATION_SWITCH_ID } from "../schema/billing";
import type { Seed } from "./index";

/** MON2: the monetization switch exists from day one and is OFF. Never changes an existing row. */
export const monetizationSeed: Seed = {
  name: "monetization",
  run: async (db) => {
    await db.insert(monetizationSwitch).values({ id: MONETIZATION_SWITCH_ID, state: "off" }).onConflictDoNothing();
  },
};
