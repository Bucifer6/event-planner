import { getDb } from "@ed/db";
import { handleMcpRequest } from "@ed/mcp";
import { clientIpFrom } from "@/lib/client-ip";

// The MCP endpoint (MCP8): APP_URL/mcp, Streamable HTTP, stateless.
// It authenticates ONLY with `Authorization: Bearer <personal token>` and never reads the
// session cookie — so it needs no CSRF check (see lib/csrf.ts) and a browser page of another
// origin can do nothing with it.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(request: Request): string | undefined {
  return clientIpFrom((name) => request.headers.get(name));
}

function handle(request: Request): Promise<Response> {
  return handleMcpRequest(request, { db: getDb(), ip: clientIp(request) });
}

export { handle as POST, handle as GET, handle as DELETE };
