import { newId } from "@ed/shared/ids";
import { bigint, integer, text, timestamp } from "drizzle-orm/pg-core";

// Column helpers shared by every schema file. Spread or call them inside pgTable():
//
//   export const things = pgTable("things", {
//     id: id(),
//     ownerId: ref("owner_id"),
//     priceMinor: moneyMinor("price_minor"),          // nullable: NULL = unknown, never 0
//     currency: currency(),
//     createdAt: createdAt(),
//     updatedAt: updatedAt(),
//   });

/** Primary key: text cuid2 generated in the app. */
export const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => newId());

/** Text column holding another row's id (add `.references(() => t.id)` at the call site). */
export const ref = (name: string) => text(name);

/** timestamptz helper (UTC instants, JS Date). */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const createdAt = () => timestamptz("created_at").notNull().defaultNow();

/** Set on insert and refreshed by Drizzle on every update made through the ORM. */
export const updatedAt = () =>
  timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());

/** Money in minor units (bani), JS number. Nullable by default: NULL means "unknown". */
export const moneyMinor = (name: string) => integer(name);

/** Money in minor units for totals that may exceed 2^31 (JS number, safe to 2^53). */
export const moneyMinorBig = (name: string) => bigint(name, { mode: "number" });

/** ISO currency code next to a money column. */
export const currency = (name = "currency") => text(name).notNull().default("RON");
