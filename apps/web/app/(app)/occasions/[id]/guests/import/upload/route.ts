import { requireMember } from "@ed/core/access";
import { IMPORT_MAX_BYTES, parseGuestFile, proposeGuestImport, suggestMapping } from "@ed/core/guestimport";
import { describeError, isAppError } from "@ed/shared/errors";
import { sameOriginOr403 } from "@/lib/csrf";
import { getCtx } from "@/lib/ctx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST multipart/form-data (file): parses the CSV/XLSX, builds the diff and stores it as a
// What-if preview — nothing is imported here. Then redirects to the import page, which shows
// the mapping and the diff. A Route Handler (not a Server Action) so a 2 MiB file fits.

function back(request: Request, id: string, query: Record<string, string>): Response {
  const url = new URL(`/occasions/${id}/guests/import`, request.url);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return Response.redirect(url, 303);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = sameOriginOr403(request);
  if (denied) return denied;
  const { id } = await params;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > IMPORT_MAX_BYTES + 64 * 1024) return back(request, id, { error: "tooBig" });

  try {
    const ctx = await getCtx();
    // Who may import is decided BEFORE the upload is read or parsed: a stranger (or a member
    // who may not manage the guest list) must not be able to make the server unpack a file.
    await requireMember(ctx, id, { manage: true });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return back(request, id, { error: "empty" });
    if (file.size > IMPORT_MAX_BYTES) return back(request, id, { error: "tooBig" });
    const table = await parseGuestFile({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    const { mapping } = suggestMapping(table.headers);
    // no recognisable column: start from "first column = name" so the planner can re-map
    const usable = mapping.name !== undefined || mapping.household !== undefined ? mapping : { ...mapping, name: 0 };
    const preview = await proposeGuestImport(ctx, {
      occasionId: id,
      fileName: file.name.slice(0, 200),
      table,
      mapping: usable,
    });
    return back(request, id, { preview: preview.id });
  } catch (e) {
    if (isAppError(e)) {
      const key = e.messageKey.startsWith("guests.import.errors.") ? e.messageKey.slice("guests.import.errors.".length) : e.code;
      return back(request, id, { error: key });
    }
    console.error("[guests.import.upload]", describeError(e, { frames: true }));
    return back(request, id, { error: "unreadable" });
  }
}
