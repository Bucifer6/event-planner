"use server";

import { acceptMcpConsent, createMcpToken, revokeMcpToken } from "@ed/mcp";
import { mcpScopeSchema } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zFormBoolean, zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

const PATH = "/account/assistants";

/**
 * S4 + MCP4: creates a personal MCP token. Needs fresh auth (checked in @ed/mcp) and the
 * explicit acceptance of the data warning. The token is in this result and nowhere else,
 * ever — so the page is NOT revalidated here (it must keep showing it).
 */
export const createAssistantToken = action(
  z.object({
    name: z.string().trim().min(1, "common.validation.required").max(60, "common.validation.tooLong"),
    scope: mcpScopeSchema,
    consent: zFormBoolean,
  }),
  async (ctx, input) => {
    if (!input.consent) {
      throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { consent: ["mcp.consent.checkboxRequired"] } });
    }
    const created = await createMcpToken(ctx, { name: input.name, scope: input.scope, consent: true });
    return { token: created.token, last4: created.last4, name: created.view.name, scope: created.view.scope };
  },
);

/** MCP4: accept the warning for a token that was created without it. */
export const acceptAssistantConsent = action(z.object({ tokenId: zId }), async (ctx, input) => {
  await acceptMcpConsent(ctx, input);
  revalidatePath(PATH);
  return { accepted: true };
});

/** Disconnect an assistant: the token stops working at once. */
export const revokeAssistantToken = action(z.object({ tokenId: zId }), async (ctx, input) => {
  await revokeMcpToken(ctx, input);
  revalidatePath(PATH);
  return { revoked: true };
});
