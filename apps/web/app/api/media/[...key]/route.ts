import { getDb } from "@ed/db";
import { isAppError } from "@ed/shared/errors";
import { openSignedAsset } from "@ed/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/media/<assetId>/<file name>?e=<expiry>&s=<signature> — the ONLY way an uploaded
// file is served (INF3, SEC4). The signed, expiring link is the capability: no cookie is
// read here, so this route works on the cookie-less media origin.
// - PDFs: Content-Disposition: attachment, nosniff, sandboxed CSP — never rendered inline —
//   and, in production, only on the MEDIA_URL host (never the app's origin).
// - anything wrong (bad or expired link, unscanned, infected, deleted) is one plain 404.

const notFound = () =>
  new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }): Promise<Response> {
  const { key } = await params;
  const url = new URL(request.url);
  const assetId = key[0] ?? "";
  const expires = Number(url.searchParams.get("e"));
  const signature = url.searchParams.get("s") ?? "";
  try {
    const served = await openSignedAsset({ db: getDb(), now: new Date() }, { assetId, expires, signature });
    if (served.asset.kind === "pdf" && process.env.NODE_ENV === "production") {
      const media = hostOf(process.env.MEDIA_URL);
      const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0]?.trim().toLowerCase();
      const app = hostOf(process.env.APP_URL);
      const appIsLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(app ?? "");
      // Untrusted PDFs never come from the app's origin (the local smoke-test setup excepted).
      if (media && host !== media && !appIsLocal) return notFound();
    }
    return new Response(new Uint8Array(served.bytes), { status: 200, headers: served.headers });
  } catch (e) {
    if (!isAppError(e)) console.error("[media] failed to serve asset:", (e as Error).name);
    return notFound();
  }
}
