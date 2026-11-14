import "server-only";
import type { Ctx } from "@ed/core/context";
import { getPicklists } from "@ed/core/geography";
import type { ListingPayload } from "@ed/core/listings";
import { isAppError } from "@ed/shared/errors";
import { getAssetUrl } from "@ed/storage";
import type { EditorPicklists, EditorValues } from "./ListingEditor";

/** Picklists for the editor: active entries, plus anything the listing already uses (retired since). */
export async function editorPicklists(ctx: Ctx): Promise<EditorPicklists> {
  const p = await getPicklists(ctx);
  return {
    categories: p.categories.map((c) => ({ id: c.id, name: c.name })),
    counties: p.counties.map((c) => ({ code: c.code, name: c.name })),
    localities: p.localities.map((l) => ({ id: l.id, countyCode: l.countyCode, name: l.name })),
  };
}

export async function editorValues(ctx: Ctx, payload: ListingPayload | null): Promise<EditorValues> {
  const photos: EditorValues["photos"] = [];
  for (const id of payload?.photoAssetIds ?? []) {
    try {
      photos.push({ id, url: await getAssetUrl(ctx, id, { ttlSeconds: 3600 }) });
    } catch (e) {
      if (!isAppError(e)) throw e; // a deleted photo simply drops out
    }
  }
  return {
    name: payload?.name ?? "",
    descriptionRo: payload?.descriptionRo ?? "",
    descriptionEn: payload?.descriptionEn ?? "",
    categoryIds: payload?.categoryIds ?? [],
    countyCodes: payload?.countyCodes ?? [],
    localityIds: payload?.localityIds ?? [],
    contactPhone: payload?.contactPhone ?? "",
    contactEmail: payload?.contactEmail ?? "",
    website: payload?.website ?? "",
    photos,
  };
}
