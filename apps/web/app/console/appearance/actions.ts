"use server";

import { setUiTheme } from "@ed/core/appearance";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffAction } from "../_lib";

/** Platform administrator: choose the look of the whole app. Applies at once, to everyone. */
export const saveUiTheme = staffAction(
  z.object({ theme: z.string().min(1).max(40) }),
  async (ctx, input) => {
    const theme = await setUiTheme(ctx, { theme: input.theme });
    revalidatePath("/", "layout");
    return { theme };
  },
);
