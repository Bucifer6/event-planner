"use server";

import { setCapacityTotal } from "@ed/core/capacity";
import { remapGuestImport, type ImportMapping, IMPORT_FIELDS } from "@ed/core/guestimport";
import { addGuest, createHousehold, removeGuest, updateHousehold } from "@ed/core/guests";
import {
  regenerateInvitation,
  revokeInvitation,
  sendInvitationEmails,
  setInvitationExpiry,
  type SendInvitationsResult,
} from "@ed/core/invitations";
import { moveRsvpQuestion, recordRsvp, removeRsvpQuestion, saveRsvpQuestion, setRsvpDeadline } from "@ed/core/rsvp";
import { createPreview } from "@ed/core/whatif";
import { zonedToUtc } from "@ed/shared/time";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deliverInvitation } from "@/app/(app)/occasions/[id]/guests/_lib/invitation-email";
import { action } from "@/lib/action";

// Planner actions for households, invitations, RSVP settings and the import (A6, A8, A13).
// Every access check lives in @ed/core; these only parse the form and refresh the pages.

const guestsPath = (occasionId: string) => `/occasions/${occasionId}/guests`;
const refresh = (occasionId: string) => revalidatePath(guestsPath(occasionId), "layout");

const text = (max: number) => z.string().max(max).optional();
const householdForm = {
  name: z.string().max(200),
  leadName: text(200),
  leadEmail: text(254),
  language: z.enum(["ro", "en"]).default("ro"),
  expectedPartySize: text(6),
  notes: text(1200),
  childDetailsAcknowledged: text(4),
};

/** Returns the link path ONCE — it cannot be read again later (only its hash is stored). */
export const createHouseholdAction = action(
  z.object({ occasionId: zId, ...householdForm, guestNames: text(4000) }),
  async (ctx, input) => {
    const res = await createHousehold(ctx, input);
    refresh(input.occasionId);
    return { householdId: res.householdId, path: res.path, name: input.name.trim() };
  },
);

export const updateHouseholdAction = action(
  z.object({ occasionId: zId, householdId: zId, ...householdForm }),
  async (ctx, input) => {
    await updateHousehold(ctx, input);
    refresh(input.occasionId);
    return { saved: true };
  },
);

export const addGuestAction = action(
  z.object({ occasionId: zId, householdId: zId, fullName: z.string().max(200) }),
  async (ctx, input) => {
    const res = await addGuest(ctx, { householdId: input.householdId, fullName: input.fullName });
    refresh(input.occasionId);
    return res;
  },
);

export const removeGuestAction = action(z.object({ occasionId: zId, guestId: zId }), async (ctx, input) => {
  await removeGuest(ctx, { guestId: input.guestId });
  refresh(input.occasionId);
  return { removed: true };
});

/** A new link for the household; the old one stops working. The path is returned once. */
export const regenerateInvitationAction = action(
  z.object({ occasionId: zId, householdId: zId }),
  async (ctx, input) => {
    const res = await regenerateInvitation(ctx, { householdId: input.householdId });
    refresh(input.occasionId);
    return { path: res.path };
  },
);

export const revokeInvitationAction = action(z.object({ occasionId: zId, householdId: zId }), async (ctx, input) => {
  await revokeInvitation(ctx, { householdId: input.householdId });
  refresh(input.occasionId);
  return { revoked: true };
});

export const setInvitationExpiryAction = action(
  z.object({ occasionId: zId, householdId: zId, mode: z.enum(["never", "rsvp_deadline", "closeout"]) }),
  async (ctx, input) => {
    await setInvitationExpiry(ctx, { householdId: input.householdId, mode: input.mode });
    refresh(input.occasionId);
    return { saved: true };
  },
);

/** Removing a household is a What-if preview: returns its id; nothing is removed yet. */
export const proposeRemoveHouseholdAction = action(
  z.object({ occasionId: zId, householdId: zId }),
  async (ctx, input) => {
    const preview = await createPreview(ctx, {
      kind: "guests.removeHousehold",
      occasionId: input.occasionId,
      subjectType: "household",
      subjectId: input.householdId,
      input: { householdId: input.householdId },
    });
    return { previewId: preview.id };
  },
);

/** A manager notes an answer received by phone or in person. */
export const recordRsvpAction = action(
  z.object({
    occasionId: zId,
    householdId: zId,
    attending: z.enum(["yes", "no", "maybe"]),
    adultsCount: text(4),
    childrenCount: text(4),
  }),
  async (ctx, input) => {
    const res = await recordRsvp(ctx, {
      householdId: input.householdId,
      attending: input.attending,
      adultsCount: Number(input.adultsCount ?? 0),
      childrenCount: Number(input.childrenCount ?? 0),
    });
    refresh(input.occasionId);
    return res;
  },
);

/** Deadline as a calendar day (Europe/Bucharest): answers are accepted until the end of it. */
export const setRsvpDeadlineAction = action(
  z.object({ occasionId: zId, rsvpDeadline: z.string().max(10).optional() }),
  async (ctx, input) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.rsvpDeadline ?? "");
    const deadline = m
      ? zonedToUtc({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: 23, minute: 59, second: 59 })
      : null;
    await setRsvpDeadline(ctx, { occasionId: input.occasionId, rsvpDeadline: deadline });
    refresh(input.occasionId);
    return { saved: true };
  },
);

/** Total places shared by invited and public guests; empty = unlimited. */
export const setCapacityAction = action(
  z.object({ occasionId: zId, total: z.string().max(6).optional() }),
  async (ctx, input) => {
    const raw = (input.total ?? "").trim();
    const total = raw === "" ? null : Number(raw);
    await setCapacityTotal(ctx, { occasionId: input.occasionId, total });
    refresh(input.occasionId);
    return { saved: true };
  },
);

export const saveRsvpQuestionAction = action(
  z.object({
    occasionId: zId,
    questionId: text(64),
    kind: z.enum(["menu_choice", "allergies", "accommodation", "transport", "free_text", "single_choice"]),
    textRo: z.string().max(300),
    textEn: text(300),
    optionsRo: text(2000),
    optionsEn: text(2000),
    required: text(4),
  }),
  async (ctx, input) => {
    const res = await saveRsvpQuestion(ctx, input);
    refresh(input.occasionId);
    return res;
  },
);

export const removeRsvpQuestionAction = action(z.object({ occasionId: zId, questionId: zId }), async (ctx, input) => {
  await removeRsvpQuestion(ctx, { questionId: input.questionId });
  refresh(input.occasionId);
  return { removed: true };
});

export const moveRsvpQuestionAction = action(
  z.object({ occasionId: zId, questionId: zId, direction: z.enum(["up", "down"]) }),
  async (ctx, input) => {
    await moveRsvpQuestion(ctx, { questionId: input.questionId, direction: input.direction });
    refresh(input.occasionId);
    return { moved: true };
  },
);

/** "Trimite invitațiile pe e-mail": households with an address, not yet emailed, not answered. */
export const sendInvitationEmailsAction = action(
  z.object({ occasionId: zId, householdId: text(64) }),
  async (ctx, input): Promise<SendInvitationsResult> => {
    const res = await sendInvitationEmails(
      ctx,
      { occasionId: input.occasionId, householdIds: input.householdId ? [input.householdId] : undefined },
      deliverInvitation,
    );
    refresh(input.occasionId);
    return res;
  },
);

const mapField = z.string().max(3).optional();

/** Re-plans the stored upload with another column mapping (the old preview is dropped). */
export const remapGuestImportAction = action(
  z.object({
    occasionId: zId,
    previewId: zId,
    map_household: mapField,
    map_name: mapField,
    map_email: mapField,
    map_language: mapField,
    map_partySize: mapField,
    map_notes: mapField,
  }),
  async (ctx, input) => {
    const mapping: ImportMapping = {};
    for (const field of IMPORT_FIELDS) {
      const raw = input[`map_${field}` as const];
      if (raw !== undefined && raw !== "" && Number.isInteger(Number(raw))) mapping[field] = Number(raw);
    }
    const preview = await remapGuestImport(ctx, { previewId: input.previewId, mapping });
    return { previewId: preview.id };
  },
);
