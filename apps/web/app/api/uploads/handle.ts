import type { Ctx } from "@ed/core/context";
import { AppError } from "@ed/shared/errors";
import { getAssetUrl, getUploadPurpose, MAX_FILE_BYTES, uploadAsset } from "@ed/storage";
import { z } from "zod";

// Shared by the upload route (POST /api/uploads) and the uploadFile server action.
// The browser names a registered PURPOSE; the owner type and whether PDFs are allowed come
// from that registration, never from the request (Q9). Access, type, scan and fair-use
// checks all happen in @ed/storage.

export const uploadSchema = z.object({
  purpose: z.string().min(1).max(100),
  ownerId: z.string().min(1).max(64),
  file: z.instanceof(File, { message: "platform.upload.missingFile" }),
});

export type UploadedFile = {
  id: string;
  name: string;
  kind: "image" | "pdf";
  bytes: number;
  /** Short-lived link for showing the file right after upload. Do not store it. */
  url: string;
};

/** Slack for multipart boundaries and the other form fields. */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;

export async function handleUpload(ctx: Ctx, input: z.output<typeof uploadSchema>): Promise<UploadedFile> {
  const purpose = getUploadPurpose(input.purpose);
  if (!purpose) throw new AppError("VALIDATION", "platform.upload.unknownPurpose");
  if (input.file.size > MAX_FILE_BYTES) {
    throw new AppError("VALIDATION", "platform.upload.tooLarge", {
      fieldErrors: { file: ["platform.upload.tooLarge"] },
    });
  }
  const asset = await uploadAsset(ctx, {
    ownerType: purpose.ownerType,
    ownerId: input.ownerId,
    file: { name: input.file.name, bytes: Buffer.from(await input.file.arrayBuffer()), mime: input.file.type },
    allowPdf: purpose.allowPdf,
  });
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    bytes: asset.bytes,
    url: await getAssetUrl(ctx, asset.id),
  };
}
