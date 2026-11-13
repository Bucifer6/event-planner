"use server";

import { deleteAsset } from "@ed/storage";
import { z } from "zod";
import { action } from "@/lib/action";
import { handleUpload, uploadSchema } from "@/app/api/uploads/handle";

// Upload actions. Access is checked in @ed/storage through the owner type's access rule.

/**
 * Upload through a Server Action (same pipeline as POST /api/uploads). Server Actions have a
 * small request-body limit (Next default 1 MB), so forms that accept files up to the 10 MiB
 * limit should use <FileField>, which posts to /api/uploads instead.
 */
export const uploadFile = action(uploadSchema, handleUpload);

/**
 * Deletes an uploaded file. Call it only after the person confirmed ("Șterge fișierul …" /
 * "Păstrează") — nothing is ever deleted without confirmation (Q9). Idempotent.
 */
export const deleteUpload = action(z.object({ assetId: z.string().min(1).max(64) }), async (ctx, { assetId }) => {
  await deleteAsset(ctx, assetId);
  return { assetId };
});
