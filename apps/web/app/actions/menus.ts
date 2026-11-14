"use server";

import { DIET_TAGS, pushMenuToOrder, removeDrinkRule, removeMenu, removeMenuItem, saveDrinkRule, saveMenu, saveMenuItem, saveMenuSettings, setMealChoices } from "@ed/core/menus";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";
import type { ActionResult } from "@/lib/action-core";
import { guestFormFields, runGuestAction } from "@/lib/guest";

// Menus, meal choices and quantities (C-05). All rules live in @ed/core/menus.

const path = (occasionId: string) => `/occasions/${occasionId}/menu`;
const flag = z.string().max(5).optional();

export const saveMenuAction = action(
  z.object({ occasionId: zId, menuId: z.string().max(64).optional(), name: z.string().max(300), mealStageId: z.string().max(64).optional() }),
  async (ctx, input) => {
    const res = await saveMenu(ctx, input);
    revalidatePath(path(input.occasionId));
    return res;
  },
);

export const removeMenuAction = action(z.object({ occasionId: zId, menuId: zId }), async (ctx, input) => {
  await removeMenu(ctx, { menuId: input.menuId });
  revalidatePath(path(input.occasionId));
  return { removed: true };
});

/** Diet tags arrive as one checkbox per tag (`diet_<tag>`), so a failed submit keeps every tick. */
const dietFlags = Object.fromEntries(DIET_TAGS.map((t) => [`diet_${t}`, flag])) as Record<`diet_${(typeof DIET_TAGS)[number]}`, typeof flag>;

export const saveMenuItemAction = action(
  z.object({
    occasionId: zId,
    menuId: zId,
    itemId: z.string().max(64).optional(),
    course: z.string().max(20),
    name: z.string().max(400),
    description: z.string().max(2000).optional(),
    isChoice: flag,
    audience: z.string().max(20).optional(),
    ...dietFlags,
  }),
  async (ctx, input) => {
    const res = await saveMenuItem(ctx, {
      menuId: input.menuId,
      itemId: input.itemId,
      course: input.course as never,
      name: input.name,
      description: input.description,
      isChoice: input.isChoice,
      audience: (input.audience || "adults") as never,
      dietTags: DIET_TAGS.filter((t) => input[`diet_${t}`] === "on"),
    });
    revalidatePath(path(input.occasionId));
    return res;
  },
);

export const removeMenuItemAction = action(z.object({ occasionId: zId, itemId: zId }), async (ctx, input) => {
  await removeMenuItem(ctx, { itemId: input.itemId });
  revalidatePath(path(input.occasionId));
  return { removed: true };
});

export const saveMenuSettingsAction = action(z.object({ occasionId: zId, safetyMarginPct: z.string().max(4), serviceHours: z.string().max(4) }), async (ctx, input) => {
  const res = await saveMenuSettings(ctx, input);
  revalidatePath(path(input.occasionId));
  return res;
});

export const saveDrinkRuleAction = action(
  z.object({ occasionId: zId, ruleId: z.string().max(64).optional(), label: z.string().max(200), unit: z.string().max(100), perGuests: z.string().max(5), perHours: z.string().max(3), adultsOnly: flag }),
  async (ctx, input) => {
    const res = await saveDrinkRule(ctx, input);
    revalidatePath(path(input.occasionId));
    return res;
  },
);

export const removeDrinkRuleAction = action(z.object({ occasionId: zId, ruleId: zId }), async (ctx, input) => {
  await removeDrinkRule(ctx, input);
  revalidatePath(path(input.occasionId));
  return { removed: true };
});

export const pushMenuToOrderAction = action(z.object({ occasionId: zId, bookingId: zId, includeDrinks: flag }), async (ctx, input) => {
  const res = await pushMenuToOrder(ctx, { occasionId: input.occasionId, bookingId: input.bookingId, includeDrinks: input.includeDrinks === "on" });
  revalidatePath(path(input.occasionId));
  return res;
});

const CHOICE_PREFIX = "choice_";

/** A household sets its counts per option on its guest link (fields `choice_<itemId>`). */
export async function setMealChoicesAction(...args: [unknown, FormData] | [unknown]): Promise<ActionResult<{ saved: number }>> {
  return runGuestAction(args, {
    schema: z.looseObject(guestFormFields),
    formKey: "menu.choices",
    minSeconds: 1,
    handler: (ctx, input) => {
      const choices: Record<string, string> = {};
      for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (key.startsWith(CHOICE_PREFIX) && typeof value === "string") choices[key.slice(CHOICE_PREFIX.length)] = value;
      }
      return setMealChoices(ctx, { choices });
    },
  });
}
