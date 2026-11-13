import { AppError } from "@ed/shared/errors";
import sharp from "sharp";

// SEC4: the file type is decided by its first bytes (never by the name or the declared
// type); PNG/JPG are decoded and re-encoded, which drops EXIF/XMP/ICC/comments and anything
// appended to the file; PDFs are stored as they are and only ever served as downloads.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Decoded-pixel cap (decompression-bomb guard). */
export const MAX_IMAGE_PIXELS = 50_000_000;

export type SniffedType =
  | { kind: "image"; mime: "image/png"; ext: "png" }
  | { kind: "image"; mime: "image/jpeg"; ext: "jpg" }
  | { kind: "pdf"; mime: "application/pdf"; ext: "pdf" };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffType(bytes: Buffer): SniffedType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG)) {
    return { kind: "image", mime: "image/png", ext: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { kind: "pdf", mime: "application/pdf", ext: "pdf" };
  }
  return null;
}

/** Decodes and re-encodes a PNG/JPG; the output carries pixels only. */
export async function reencodeImage(bytes: Buffer, type: SniffedType): Promise<Buffer> {
  try {
    const img = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error", pages: 1 })
      .rotate(); // bake in the EXIF orientation before the metadata is dropped
    return type.mime === "image/png"
      ? await img.png({ compressionLevel: 9 }).toBuffer()
      : await img.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  } catch {
    throw new AppError("VALIDATION", "platform.upload.unreadableImage", {
      fieldErrors: { file: ["platform.upload.unreadableImage"] },
    });
  }
}

export type ProcessedFile = { type: SniffedType; bytes: Buffer };

/** Type check + (for images) re-encode. Throws AppError VALIDATION with a `file` field error. */
export async function processUpload(
  original: Buffer,
  opts: { allowPdf: boolean },
): Promise<ProcessedFile> {
  const fail = (key: string): never => {
    throw new AppError("VALIDATION", key, { fieldErrors: { file: [key] } });
  };
  if (original.length === 0) fail("platform.upload.empty");
  if (original.length > MAX_FILE_BYTES) fail("platform.upload.tooLarge");
  const type = sniffType(original);
  if (!type) return fail(opts.allowPdf ? "platform.upload.typeWithPdf" : "platform.upload.type");
  if (type.kind === "pdf") {
    if (!opts.allowPdf) fail("platform.upload.type");
    return { type, bytes: original };
  }
  const bytes = await reencodeImage(original, type);
  if (bytes.length > MAX_FILE_BYTES) fail("platform.upload.tooLarge");
  return { type, bytes };
}
