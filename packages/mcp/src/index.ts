// @ed/mcp — MCP server (Streamable HTTP, stateless) and the versioned tool catalogue (MCP1–MCP8).
//
//   web route      apps/web/app/mcp/route.ts → handleMcpRequest(request, { db, ip })
//   tokens         createMcpToken / acceptMcpConsent / listMcpTokens / revokeMcpToken
//   new tools      registerMcpTool({ name, version, scope, title, description, inputSchema, handler })
//   jobs           registerJobs()  ("mcp.expire-inactive", call-log retention)
//
// Importing this package registers the account hooks: "sign out everywhere" revokes the
// account's tokens, purging an account deletes them.
export * from "./registry";
export * from "./tokens";
export * from "./builtin";
export * from "./server";
export * from "./tools";
