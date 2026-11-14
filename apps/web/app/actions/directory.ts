"use server";

import { dismissDirectoryLink, restoreDirectoryLink } from "@ed/core/directory";
import {
  createCategory,
  createCounty,
  createLocality,
  mergeCategory,
  mergeCounty,
  mergeLocality,
  moveCategory,
  updateCategory,
  updateCounty,
  updateLocality,
} from "@ed/core/geography";
import { LOCALITY_KINDS } from "@ed/db";
import { zFormBoolean, zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffAction } from "@/app/console/_lib";
import { action } from "@/lib/action";

// P7 link preferences (planner side) and W4 directory management (console side).

/* ── P7 ─────────────────────────────────────────────────────────────────── */

const linkScope = z.object({ scope: z.enum(["account", "occasion"]), occasionId: z.string().max(64).optional(), returnTo: z.string().max(300).optional() });

function scopeOf(input: z.output<typeof linkScope>) {
  return input.scope === "occasion" ? ({ scope: "occasion", occasionId: input.occasionId ?? "" } as const) : ({ scope: "account" } as const);
}

export const hideDirectoryLink = action(linkScope, async (ctx, input) => {
  await dismissDirectoryLink(ctx, scopeOf(input));
  if (input.occasionId) revalidatePath(`/occasions/${input.occasionId}`, "layout");
  return { hidden: true };
});

export const showDirectoryLink = action(linkScope, async (ctx, input) => {
  await restoreDirectoryLink(ctx, scopeOf(input));
  if (input.occasionId) revalidatePath(`/occasions/${input.occasionId}`, "layout");
  return { hidden: false };
});

/* ── W4 ─────────────────────────────────────────────────────────────────── */

const zName = z.string().trim().min(2, "common.validation.required").max(80, "common.validation.tooLong");
const refresh = () => revalidatePath("/console/directory");

export const addCategory = staffAction(z.object({ nameRo: zName, nameEn: zName }), async (ctx, input) => {
  await createCategory(ctx, input);
  refresh();
  return { saved: true };
});

export const renameCategory = staffAction(z.object({ id: zId, nameRo: zName, nameEn: zName }), async (ctx, input) => {
  await updateCategory(ctx, input);
  refresh();
  return { saved: true };
});

export const setCategoryFlag = staffAction(z.object({ id: zId, flag: z.enum(["active", "published"]), value: zFormBoolean }), async (ctx, input) => {
  await updateCategory(ctx, { id: input.id, [input.flag]: input.value });
  refresh();
  return { saved: true };
});

export const moveCategoryAction = staffAction(z.object({ id: zId, direction: z.enum(["up", "down"]) }), async (ctx, input) => {
  await moveCategory(ctx, input);
  refresh();
  return { saved: true };
});

export const mergeCategoryAction = staffAction(z.object({ fromId: zId, intoId: z.string().min(1, "common.validation.required").max(64) }), async (ctx, input) => {
  await mergeCategory(ctx, input);
  refresh();
  return { saved: true };
});

export const addCounty = staffAction(z.object({ code: z.string().trim().min(1, "common.validation.required").max(3), nameRo: zName, nameEn: z.string().max(80).optional() }), async (ctx, input) => {
  await createCounty(ctx, input);
  refresh();
  return { saved: true };
});

export const renameCounty = staffAction(z.object({ code: z.string().min(1).max(3), nameRo: zName, nameEn: zName }), async (ctx, input) => {
  await updateCounty(ctx, input);
  refresh();
  return { saved: true };
});

export const setCountyFlag = staffAction(
  z.object({ code: z.string().min(1).max(3), flag: z.enum(["active", "published", "launchArea"]), value: zFormBoolean }),
  async (ctx, input) => {
    await updateCounty(ctx, { code: input.code, [input.flag]: input.value });
    refresh();
    return { saved: true };
  },
);

export const mergeCountyAction = staffAction(z.object({ fromCode: z.string().min(1).max(3), intoCode: z.string().min(1, "common.validation.required").max(3) }), async (ctx, input) => {
  await mergeCounty(ctx, input);
  refresh();
  return { saved: true };
});

export const addLocality = staffAction(
  z.object({ countyCode: z.string().min(1).max(3), nameRo: zName, nameEn: z.string().max(80).optional(), kind: z.enum(LOCALITY_KINDS).default("oras") }),
  async (ctx, input) => {
    await createLocality(ctx, input);
    refresh();
    return { saved: true };
  },
);

export const renameLocality = staffAction(z.object({ id: zId, nameRo: zName, nameEn: z.string().trim().max(80).optional() }), async (ctx, input) => {
  await updateLocality(ctx, { id: input.id, nameRo: input.nameRo, nameEn: input.nameEn ? input.nameEn : null });
  refresh();
  return { saved: true };
});

export const setLocalityFlag = staffAction(z.object({ id: zId, flag: z.enum(["active", "publicPage"]), value: zFormBoolean }), async (ctx, input) => {
  await updateLocality(ctx, { id: input.id, [input.flag]: input.value });
  refresh();
  return { saved: true };
});

export const mergeLocalityAction = staffAction(z.object({ fromId: zId, intoId: z.string().min(1, "common.validation.required").max(64) }), async (ctx, input) => {
  const res = await mergeLocality(ctx, input);
  refresh();
  return res;
});
