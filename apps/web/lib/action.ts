import "server-only";
import type { Ctx } from "@ed/core/context";
import { getTranslations } from "next-intl/server";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { runAction, type ActionOptions, type ActionResult, type Translator } from "./action-core";
import { getCtx } from "./ctx";

export type { ActionError, ActionErrorCode, ActionOptions, ActionResult } from "./action-core";

/**
 * A wrapped Server Action. Callable two ways:
 *   await saveThing({ title })                      // direct call with an object or FormData
 *   useActionState(saveThing, null)                 // (prevState, formData) form action
 */
export type WrappedAction<I, R> = {
  (input: I | FormData): Promise<ActionResult<R>>;
  (prevState: ActionResult<R> | null | undefined, formData: FormData): Promise<ActionResult<R>>;
};

/**
 * Wraps a Server Action (apps/web/app/actions/<domain>.ts, a "use server" file):
 *
 *   export const renameTask = action(
 *     z.object({ taskId: zId, title: zText(200) }),
 *     async (ctx, input) => tasks.rename(ctx, input),     // call @ed/core, return plain data
 *   );
 *
 * - resolves the request Ctx (getCtx) and, unless { auth: "public" }, requires an account
 * - validates input (object or FormData) with the zod schema -> VALIDATION + fieldErrors
 * - maps AppError to { code, message } via its messageKey (falls back to common.errors.<CODE>)
 * - anything else is logged server-side and returned as code "UNEXPECTED" with a generic
 *   message — never a stack trace
 * - redirect()/notFound() thrown by the handler work as usual
 */
export function action<S extends z.ZodType, R>(
  schema: S,
  handler: (ctx: Ctx, input: z.output<S>) => Promise<R>,
  options?: ActionOptions,
): WrappedAction<z.input<S>, R> {
  async function wrapped(...args: unknown[]): Promise<ActionResult<R>> {
    const rawInput = args.length >= 2 && args[1] instanceof FormData ? args[1] : args[0];
    const t = await getTranslations();
    const translator: Translator = {
      t: (key, params) => t(key as never, params as never),
      has: (key) => t.has(key as never),
    };
    return runAction({
      schema,
      handler,
      rawInput,
      getCtx,
      translator,
      options,
      rethrow: unstable_rethrow,
    });
  }
  return wrapped as WrappedAction<z.input<S>, R>;
}
