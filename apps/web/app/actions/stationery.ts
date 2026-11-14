"use server";

import { markStationeryProofed, previewStationery, saveStationeryVersion, setDigitalInvitation } from "@ed/core/stationery";
import { svgDataUri, STATIONERY_PIECES } from "@ed/core/stationerykit";
import { zId } from "@ed/shared/zod";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";

// Invitation and stationery designer (C-04). Every save is a new version; the print PDF is a
// GET route (stationery/pdf) that core gates on the proof mark.

const path = (occasionId: string) => `/occasions/${occasionId}/stationery`;
const text = z.object({ value: z.string().max(1000), aiOriginal: z.string().max(1000).nullish() });
const draft = {
  designKey: z.enum(["classic", "modern", "monogram", "botanical", "minimal", "nocturne", "botez", "petrecere"]),
  colourwayKey: z.string().min(1).max(40),
  locale: z.enum(["ro", "en"]),
  texts: z.record(z.string().max(40), text),
  qrOnInvitation: z.boolean().optional(),
};

/** The live proof of an unsaved draft: one piece, as a data: image. Stores nothing. */
export const previewStationeryAction = action(z.object({ ...draft, piece: z.enum(STATIONERY_PIECES) }), async (ctx, input) => {
  const { piece, ...rest } = input;
  const [p] = await previewStationery(ctx, { ...rest, pieces: [piece] });
  return { piece, src: svgDataUri(p!.svg), widthMm: p!.widthMm, heightMm: p!.heightMm, fit: p!.fit, truncated: p!.truncated };
});

export const saveStationeryAction = action(z.object({ occasionId: zId, ...draft }), async (ctx, input) => {
  const res = await saveStationeryVersion(ctx, input);
  revalidatePath(path(input.occasionId));
  return res;
});

export const markStationeryProofedAction = action(z.object({ occasionId: zId, version: z.coerce.number().int().min(1) }), async (ctx, input) => {
  const res = await markStationeryProofed(ctx, input);
  revalidatePath(path(input.occasionId));
  return { version: res.version };
});

export const setDigitalInvitationAction = action(z.object({ occasionId: zId, enabled: z.preprocess((v) => v === true || v === "true" || v === "1", z.boolean()) }), async (ctx, input) => {
  const res = await setDigitalInvitation(ctx, input);
  revalidatePath(path(input.occasionId));
  return res;
});
