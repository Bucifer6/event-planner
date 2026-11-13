import "server-only";
import type { Actor } from "@ed/core/context";

/**
 * SEAM — owned by the auth agent.
 *
 * Resolve who is making this request: read the session cookie, validate it against the
 * sessions table through @ed/auth, and return the actor — or null when nobody is signed in.
 * Guest-link (g/[token]) and MCP routes build their own actors and do not go through here.
 *
 * Contract: must never throw for a missing/invalid/expired session (return null); must not
 * redirect (requireCtx() in lib/ctx.ts does that).
 */
export async function resolveActor(): Promise<Actor | null> {
  return null;
}
