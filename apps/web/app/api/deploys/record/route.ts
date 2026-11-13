import { systemCtx } from "@ed/core/context";
import { recordDeployInput, recordDeployStage, verifyDeployRecordToken } from "@ed/core/deploys";
import { getDb } from "@ed/db";
import { isAppError } from "@ed/shared/errors";

// The deploy pipeline reports here (scripts/record-deploy.mjs → DEP4, DEP6).
//
// It authenticates ONLY with `Authorization: Bearer <DEPLOY_RECORD_TOKEN>` (compared as
// hashes) and never reads the session cookie — like a webhook, so it needs no CSRF check and
// a browser page can do nothing with it. The answer carries the deploy's state and nothing
// else; "start" answered with 409 tells the workflow to stop before touching production.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

function reply(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  if (!verifyDeployRecordToken(token)) return reply(401, { ok: false, error: { code: "UNAUTHENTICATED" } });

  let raw: unknown;
  try {
    raw = JSON.parse((await request.text()).slice(0, 10_000));
  } catch {
    return reply(400, { ok: false, error: { code: "VALIDATION" } });
  }
  const parsed = recordDeployInput.safeParse(raw);
  if (!parsed.success) return reply(400, { ok: false, error: { code: "VALIDATION" } });

  try {
    const row = await recordDeployStage(systemCtx(getDb()), parsed.data);
    return reply(200, {
      ok: true,
      deploy: { id: row.id, kind: row.kind, tag: row.tag, state: row.state, stage: row.stage, previousTag: row.previousTag, emergency: row.emergency },
    });
  } catch (e) {
    if (isAppError(e)) {
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "CONFLICT" ? 409 : 400;
      return reply(status, { ok: false, error: { code: e.code, key: e.messageKey } });
    }
    console.error("[deploys] record failed:", (e as Error).name);
    return reply(500, { ok: false, error: { code: "UNEXPECTED" } });
  }
}
