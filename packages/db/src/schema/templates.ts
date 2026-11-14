import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ref, updatedAt } from "./_helpers";
import type { OccasionKind } from "./occasions";
import type { TaskStage } from "./tasks";

// Occasion templates (A2): seeded task lists scheduled relative to the occasion date.

export const templates = pgTable(
  "templates",
  {
    id: id(),
    kind: text("kind").$type<OccasionKind>().notNull(),
    nameRo: text("name_ro").notNull(),
    nameEn: text("name_en").notNull(),
    descriptionRo: text("description_ro"),
    descriptionEn: text("description_en"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("templates_kind_uq").on(t.kind)],
);

export const templateTasks = pgTable(
  "template_tasks",
  {
    id: id(),
    templateId: ref("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    /** Stable within the template; copied to tasks.template_task_key as "<kind>:<key>". */
    key: text("key").notNull(),
    titleRo: text("title_ro").notNull(),
    titleEn: text("title_en").notNull(),
    stage: text("stage").$type<TaskStage>().notNull(),
    /** Due = occasion date − offsetMonths months + offsetDays days. */
    offsetMonths: integer("offset_months").notNull().default(0),
    offsetDays: integer("offset_days").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("template_tasks_key_uq").on(t.templateId, t.key),
    index("template_tasks_template_idx").on(t.templateId, t.position),
  ],
);
