import { getDb, sql } from "@ed/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const version = process.env.APP_VERSION || "dev";

// Health check for the deploy pipeline and monitoring (DEP4, LAU5).
// Reports only ok + version: no hostnames, no error text.
export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, version }, { headers });
  } catch (e) {
    console.error("[health] database check failed:", (e as Error).name);
    return Response.json({ ok: false, version }, { status: 503, headers });
  }
}
