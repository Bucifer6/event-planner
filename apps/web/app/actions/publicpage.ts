"use server";

import { JOURNEY_FACTS, saveJourney } from "@ed/core/guestevent";
import { removePublicQuestion, savePublicPage, savePublicQuestion } from "@ed/core/publicpage";
import { FORM_STAMP_FIELD, HONEYPOT_FIELD } from "@ed/core/ratelimit";
import { cancelOwnRegistration, cancelRegistration, promoteRegistration, registerForEvent, type RegisterResult } from "@ed/core/registrations";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runPublicAction } from "@/app/e/_lib/public";
import { action } from "@/lib/action";
import type { ActionResult } from "@/lib/action-core";

// Public event page, its questions, registrations and the accessible journey (C-06, C-07).

const path = (occasionId: string) => `/occasions/${occasionId}/public-page`;
const flag = z.string().max(5).optional();
const text = (max: number) => z.string().max(max).optional();

export const savePublicPageAction = action(
  z.object({
    occasionId: zId,
    slug: z.string().max(100),
    titleRo: z.string().max(400),
    titleEn: text(400),
    descriptionRo: text(4000),
    descriptionEn: text(4000),
    showDate: flag,
    showVenue: flag,
    showProgramme: flag,
    showMenu: flag,
    registrationEnabled: flag,
    opensOn: text(12),
    closesOn: text(12),
    sharesCapacity: flag,
    privacyUrl: text(600),
    published: flag,
  }),
  async (ctx, input) => {
    const res = await savePublicPage(ctx, input);
    revalidatePath(path(input.occasionId));
    revalidatePath(`/e/${res.slug}`);
    return res;
  },
);

export const savePublicQuestionAction = action(
  z.object({ occasionId: zId, questionId: z.string().max(64).optional(), kind: z.enum(["choice", "text"]), ro: z.string().max(600), en: text(600), options: text(5000), required: flag, showIf: text(140) }),
  async (ctx, input) => {
    const res = await savePublicQuestion(ctx, input);
    revalidatePath(path(input.occasionId));
    return res;
  },
);

export const removePublicQuestionAction = action(z.object({ occasionId: zId, questionId: zId }), async (ctx, input) => {
  await removePublicQuestion(ctx, input);
  revalidatePath(path(input.occasionId));
  return { removed: true };
});

export const cancelRegistrationAction = action(z.object({ occasionId: zId, registrationId: zId }), async (ctx, input) => {
  const res = await cancelRegistration(ctx, { registrationId: input.registrationId });
  revalidatePath(path(input.occasionId));
  return res;
});

export const promoteRegistrationAction = action(z.object({ occasionId: zId, registrationId: zId }), async (ctx, input) => {
  const res = await promoteRegistration(ctx, { registrationId: input.registrationId });
  revalidatePath(path(input.occasionId));
  return res;
});

/** Journey facts arrive flat: fact_<key>_state / _noteRo / _noteEn. */
export const saveJourneyAction = action(
  z.looseObject({ occasionId: zId, contactName: text(400), contactRoute: text(400), published: flag }),
  async (ctx, input) => {
    const raw = input as Record<string, unknown>;
    const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
    const facts = Object.fromEntries(
      JOURNEY_FACTS.map((key) => {
        const state = str(`fact_${key}_state`);
        return [key, { state: state === "yes" || state === "no" ? state : "unknown", noteRo: str(`fact_${key}_noteRo`), noteEn: str(`fact_${key}_noteEn`) }];
      }),
    );
    const res = await saveJourney(ctx, { occasionId: input.occasionId, facts: facts as never, contactName: input.contactName, contactRoute: input.contactRoute, published: input.published });
    revalidatePath(path(input.occasionId));
    return { published: res.published };
  },
);

/* ── Public: /e/<slug> — no account ──────────────────────────────────────── */

const registerForm = z.looseObject({
  slug: z.string().max(80),
  lang: z.enum(["ro", "en"]).optional(),
  name: z.string().max(300),
  email: z.string().max(400),
  adults: z.string().max(3).optional(),
  children: z.string().max(3).optional(),
  consent: flag,
  idempotencyKey: z.string().max(200),
  [HONEYPOT_FIELD]: z.string().max(500).optional(),
  [FORM_STAMP_FIELD]: z.string().max(200).optional(),
});

/** Registration from the public page. The bot guard (SEC11) runs inside registerForEvent. */
export async function registerPublicAction(...args: [unknown, FormData] | [unknown]): Promise<ActionResult<RegisterResult>> {
  return runPublicAction(args, {
    schema: registerForm,
    handler: async (ctx, input, locale) => {
      const raw = input as Record<string, unknown>;
      const answers: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw)) if (key.startsWith("q_")) answers[key] = value;
      return registerForEvent(ctx, {
        slug: input.slug,
        name: input.name,
        email: input.email,
        adults: input.adults ?? "1",
        children: input.children ?? "0",
        answers,
        consent: input.consent === "on",
        language: locale,
        idempotencyKey: input.idempotencyKey,
        honeypot: input[HONEYPOT_FIELD] ?? "",
        renderedAt: input[FORM_STAMP_FIELD] ?? null,
      });
    },
  });
}

/** The registrant cancels through their own manage link. */
export async function cancelOwnRegistrationAction(...args: [unknown, FormData] | [unknown]): Promise<ActionResult<{ cancelled: boolean }>> {
  return runPublicAction(args, {
    schema: z.object({ slug: z.string().max(80), token: z.string().max(128), lang: z.enum(["ro", "en"]).optional() }),
    handler: (ctx, input) => cancelOwnRegistration(ctx, { slug: input.slug, token: input.token }),
  });
}
