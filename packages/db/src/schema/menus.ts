import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { households } from "./guests";
import { occasions } from "./occasions";
import { createdAt, id, ref, updatedAt } from "./_helpers";

// Menus, meal choices and quantity rules (C-05).
//
// INVARIANT 9: a meal choice is a COUNT per option for the household's party. Children's
// options are counted exactly the same way ("meniu copil × 2") — never a name, never an age.

export const MENU_COURSES = ["starter", "soup", "main", "dessert", "drink", "other"] as const;
export type MenuCourse = (typeof MENU_COURSES)[number];
export const menuCourseSchema = z.enum(MENU_COURSES);

/** The fixed list of diet tags (no free text: it is also how private requests are counted). */
export const DIET_TAGS = ["vegetarian", "vegan", "gluten_free", "lactose_free", "fasting", "halal", "kosher", "alcohol_free"] as const;
export type DietTag = (typeof DIET_TAGS)[number];
export const dietTagSchema = z.enum(DIET_TAGS);

export const MENU_AUDIENCES = ["adults", "children"] as const;
export type MenuAudience = (typeof MENU_AUDIENCES)[number];

/** "1 {unit} for every {perGuests} guests, every {perHours} hours" — an estimate the planner edits. */
export type DrinkRule = { id: string; label: string; unit: string; perGuests: number; perHours: number; adultsOnly: boolean };

export const menus = pgTable(
  "menus",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Optional link to a stage of the meal (seating: meal_stages.id). Plain text: the stage may go. */
    mealStageId: text("meal_stage_id"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("menus_occasion_idx").on(t.occasionId, t.position)],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: id(),
    menuId: ref("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "cascade" }),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    course: text("course").$type<MenuCourse>().notNull().default("main"),
    name: text("name").notNull(),
    description: text("description"),
    dietTags: jsonb("diet_tags").$type<DietTag[]>().notNull().default([]),
    /** true = guests choose between the options of the same menu, course and audience. */
    isChoice: boolean("is_choice").notNull().default(false),
    audience: text("audience").$type<MenuAudience>().notNull().default("adults"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("menu_items_menu_idx").on(t.menuId, t.position), index("menu_items_occasion_idx").on(t.occasionId)],
);

/** How many of the household's party take this option. Counts only. */
export const mealChoices = pgTable(
  "meal_choices",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    householdId: ref("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    menuItemId: ref("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    count: integer("count").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("meal_choices_household_item_uq").on(t.householdId, t.menuItemId),
    index("meal_choices_occasion_idx").on(t.occasionId),
    check("meal_choices_count_ck", sql`${t.count} > 0`),
  ],
);

export const menuSettings = pgTable("menu_settings", {
  occasionId: ref("occasion_id")
    .primaryKey()
    .references(() => occasions.id, { onDelete: "cascade" }),
  /** Extra portions on top of the counted ones, in percent. */
  safetyMarginPct: integer("safety_margin_pct").notNull().default(5),
  /** How long drinks are served, in hours — the base of the drink estimate. */
  serviceHours: integer("service_hours").notNull().default(6),
  drinkRules: jsonb("drink_rules").$type<DrinkRule[]>().notNull().default([]),
  updatedAt: updatedAt(),
});
