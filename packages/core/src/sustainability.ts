import { and, asc, desc, eq, inArray, sustainabilityGoals, sustainabilityMeasurements, type SustainabilityAggregate, type SustainabilityDirection, type SustainabilityMetric } from "@ed/db";
import { SUSTAINABILITY_METRICS } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zOptionalText } from "@ed/shared/zod";
import { z } from "zod";
import { isManager, requireMember } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";

// RELEASE E (E-04): optional sustainability goals with MEASURED quantities.
//
// Entirely optional: nothing here nudges anyone; an occasion without goals shows nothing.
// A goal is a metric, a direction (at most / at least) and — optionally — a target. People
// record measurements over time; a measurement whose value is not known is recorded as
// UNKNOWN (NULL), never as 0.
//
// Status, in words (principle 5 — unknown stays unknown and never counts as meeting a goal):
//   unknown    nothing measured (or the newest reading is unknown)
//   measured   there are numbers, but no verdict can be honestly given: no target was set, or
//              part of what should add up is unknown and the known part does not settle it
//   on_track   the measured quantity meets the target
//   behind     the measured quantity misses the target

export type SustainabilityGoal = typeof sustainabilityGoals.$inferSelect;
export type SustainabilityMeasurement = typeof sustainabilityMeasurements.$inferSelect;
export type { SustainabilityAggregate, SustainabilityDirection, SustainabilityMetric };
export type GoalStatus = "unknown" | "measured" | "on_track" | "behind";

const idSchema = z.string().min(1).max(64);
type LooseInput<S extends z.ZodType> = z.input<S> extends infer T ? { [K in keyof T as unknown extends T[K] ? never : K]: T[K] } & { [K in keyof T as unknown extends T[K] ? K : never]?: T[K] } : never;

/** Unit, direction and how readings combine for the built-in metrics. */
export const METRIC_DEFAULTS: Record<Exclude<SustainabilityMetric, "custom">, { unit: string; direction: SustainabilityDirection; aggregate: SustainabilityAggregate }> = {
  food_waste_kg: { unit: "kg", direction: "at_most", aggregate: "sum" },
  single_use_items: { unit: "buc", direction: "at_most", aggregate: "sum" },
  local_suppliers_share: { unit: "%", direction: "at_least", aggregate: "latest" },
  shared_transport_share: { unit: "%", direction: "at_least", aggregate: "latest" },
};

export type GoalProgress = {
  status: GoalStatus;
  /** The measured quantity (sum of the known readings, or the newest reading). null = unknown. */
  value: number | null;
  /** Some readings were recorded as unknown: `value` is then only the known part. */
  hasUnknown: boolean;
  readings: number;
};

/**
 * Pure. Works out where a goal stands from its measurements (oldest first or any order).
 * An unknown reading is never treated as 0 and never makes a goal "on track":
 *   sum / at most   known part already over the target → behind (more can only add);
 *                   under it with unknown readings → measured (cannot be promised)
 *   sum / at least  known part already reaches the target → on_track; short of it with
 *                   unknown readings → measured
 *   latest          the newest reading decides; if it is unknown → unknown
 */
export function goalProgress(
  goal: Pick<SustainabilityGoal, "targetValue" | "direction" | "aggregate">,
  measurements: Array<Pick<SustainabilityMeasurement, "value" | "measuredAt">>,
): GoalProgress {
  const readings = measurements.length;
  if (readings === 0) return { status: "unknown", value: null, hasUnknown: false, readings };
  const known = measurements.filter((m) => m.value !== null);
  const hasUnknown = known.length < readings;
  if (goal.aggregate === "latest") {
    const newest = [...measurements].sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime())[0]!;
    if (newest.value === null) return { status: "unknown", value: null, hasUnknown: true, readings };
    if (goal.targetValue === null) return { status: "measured", value: newest.value, hasUnknown, readings };
    const ok = goal.direction === "at_most" ? newest.value <= goal.targetValue : newest.value >= goal.targetValue;
    return { status: ok ? "on_track" : "behind", value: newest.value, hasUnknown, readings };
  }
  if (known.length === 0) return { status: "unknown", value: null, hasUnknown: true, readings };
  const total = known.reduce((n, m) => n + (m.value as number), 0);
  if (goal.targetValue === null) return { status: "measured", value: total, hasUnknown, readings };
  if (goal.direction === "at_most") {
    if (total > goal.targetValue) return { status: "behind", value: total, hasUnknown, readings };
    return { status: hasUnknown ? "measured" : "on_track", value: total, hasUnknown, readings };
  }
  if (total >= goal.targetValue) return { status: "on_track", value: total, hasUnknown, readings };
  return { status: hasUnknown ? "measured" : "behind", value: total, hasUnknown, readings };
}

export type GoalView = {
  id: string;
  metric: SustainabilityMetric;
  label: string | null;
  targetValue: number | null;
  unit: string;
  direction: SustainabilityDirection;
  aggregate: SustainabilityAggregate;
  progress: GoalProgress;
  measurements: Array<{ id: string; value: number | null; note: string | null; measuredAt: Date }>;
};

/** Goals with their measurements and status. Any member. `canManage`: owner / project manager. */
export async function getSustainability(ctx: Ctx, occasionId: string): Promise<{ goals: GoalView[]; canManage: boolean; canMeasure: boolean }> {
  const id = idSchema.parse(occasionId);
  const member = await requireMember(ctx, id);
  const goals = await ctx.db.select().from(sustainabilityGoals).where(eq(sustainabilityGoals.occasionId, id)).orderBy(asc(sustainabilityGoals.createdAt));
  const ms = goals.length
    ? await ctx.db
        .select()
        .from(sustainabilityMeasurements)
        .where(
          inArray(
            sustainabilityMeasurements.goalId,
            goals.map((g) => g.id),
          ),
        )
        .orderBy(desc(sustainabilityMeasurements.measuredAt), desc(sustainabilityMeasurements.createdAt))
    : [];
  return {
    canManage: isManager(member),
    canMeasure: true,
    goals: goals.map((g) => {
      const own = ms.filter((m) => m.goalId === g.id);
      return {
        id: g.id,
        metric: g.metric,
        label: g.label,
        targetValue: g.targetValue,
        unit: g.unit,
        direction: g.direction,
        aggregate: g.aggregate,
        progress: goalProgress(g, own),
        measurements: own.map((m) => ({ id: m.id, value: m.value, note: m.note, measuredAt: m.measuredAt })),
      };
    }),
  };
}

/** "12,5" or "12.5" → 12.5; "" → undefined (unknown). */
const zQuantity = z.preprocess(
  (v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    if (typeof v === "number") return v;
    const n = Number(String(v).trim().replace(",", "."));
    return Number.isFinite(n) ? n : Number.NaN;
  },
  z.number("operate.errors.quantity").min(0, "operate.errors.quantity").max(1_000_000_000, "operate.errors.quantity").optional(),
);

const goalInput = z
  .object({
    occasionId: idSchema,
    metric: z.enum(SUSTAINABILITY_METRICS),
    /** Required for a custom metric. */
    label: zOptionalText(80),
    /** Empty = no target yet. */
    targetValue: zQuantity,
    unit: zOptionalText(12),
    direction: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(["at_most", "at_least"]).optional()),
    aggregate: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(["sum", "latest"]).optional()),
  })
  .superRefine((v, c) => {
    if (v.metric === "custom" && !v.label) c.addIssue({ code: "custom", path: ["label"], message: "common.validation.required" });
    if (v.metric === "custom" && !v.unit) c.addIssue({ code: "custom", path: ["unit"], message: "common.validation.required" });
  });

/** Sets a goal (owner / project manager). */
export async function createSustainabilityGoal(ctx: Ctx, input: LooseInput<typeof goalInput>): Promise<{ goalId: string }> {
  requireWriteCapable(ctx);
  const data = goalInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  await assertOccasionWritable(ctx, data.occasionId);
  const d = data.metric === "custom" ? null : METRIC_DEFAULTS[data.metric];
  const unit = d ? d.unit : (data.unit ?? "");
  if ((unit === "%" || d?.unit === "%") && data.targetValue !== undefined && data.targetValue > 100) {
    throw new AppError("VALIDATION", "operate.errors.percent", { fieldErrors: { targetValue: ["operate.errors.percent"] } });
  }
  const [row] = await ctx.db
    .insert(sustainabilityGoals)
    .values({
      occasionId: data.occasionId,
      metric: data.metric,
      label: data.metric === "custom" ? (data.label ?? null) : null,
      targetValue: data.targetValue ?? null,
      unit,
      direction: d ? d.direction : (data.direction ?? "at_most"),
      aggregate: d ? d.aggregate : (data.aggregate ?? "sum"),
      createdAt: ctx.now,
    })
    .returning({ id: sustainabilityGoals.id });
  await audit(ctx, { action: "sustainability.goal_set", objectType: "sustainability_goal", objectId: row!.id, after: { metric: data.metric, target: data.targetValue ?? null } });
  return { goalId: row!.id };
}

export async function deleteSustainabilityGoal(ctx: Ctx, input: { goalId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const [goal] = await ctx.db.select().from(sustainabilityGoals).where(eq(sustainabilityGoals.id, idSchema.parse(input.goalId)));
  if (!goal) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireMember(ctx, goal.occasionId, { manage: true });
  await assertOccasionWritable(ctx, goal.occasionId);
  await ctx.db.delete(sustainabilityGoals).where(eq(sustainabilityGoals.id, goal.id));
  await audit(ctx, { action: "sustainability.goal_removed", objectType: "sustainability_goal", objectId: goal.id, before: { metric: goal.metric } });
}

const measureInput = z.object({ goalId: idSchema, /** Empty / absent = unknown. */ value: zQuantity, unknown: z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean()).optional(), note: zOptionalText(300) });

/**
 * Records a measurement (any member). No value → recorded as UNKNOWN: it shows that someone
 * looked and could not measure; it is never counted as 0.
 */
export async function recordMeasurement(ctx: Ctx, input: LooseInput<typeof measureInput>): Promise<{ measurementId: string; unknown: boolean }> {
  requireWriteCapable(ctx);
  const data = measureInput.parse(input);
  const [goal] = await ctx.db.select().from(sustainabilityGoals).where(eq(sustainabilityGoals.id, data.goalId));
  if (!goal) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const member = await requireMember(ctx, goal.occasionId);
  await assertOccasionWritable(ctx, goal.occasionId);
  const value = data.unknown ? null : (data.value ?? null);
  if (value === null && !data.unknown) {
    // an empty field is not silently "unknown": the person says so with the tick box
    throw new AppError("VALIDATION", "operate.errors.valueOrUnknown", { fieldErrors: { value: ["operate.errors.valueOrUnknown"] } });
  }
  if (goal.unit === "%" && value !== null && value > 100) {
    throw new AppError("VALIDATION", "operate.errors.percent", { fieldErrors: { value: ["operate.errors.percent"] } });
  }
  const [row] = await ctx.db
    .insert(sustainabilityMeasurements)
    .values({ goalId: goal.id, occasionId: goal.occasionId, value, note: data.note ?? null, measuredAt: ctx.now, byMemberId: member.viaBusiness ? null : member.id, createdAt: ctx.now })
    .returning({ id: sustainabilityMeasurements.id });
  await audit(ctx, { action: "sustainability.measured", objectType: "sustainability_goal", objectId: goal.id, after: { value } });
  return { measurementId: row!.id, unknown: value === null };
}

onOccasionPurge(async (tx, occasionId) => {
  await tx.db.delete(sustainabilityMeasurements).where(and(eq(sustainabilityMeasurements.occasionId, occasionId)));
});
