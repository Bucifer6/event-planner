// THE tool catalogue loader (MCP8): importing this file registers every tool of releases
// 0–P. Imported once, from ./index. A new tool means a new platform release: add it in a
// tools-*.ts file, add its line to MCP_TOOL_CATALOGUE below (the allowlist the test
// compares the registered catalogue with), its mcp.tools.<name> description in ro/en, and —
// if it returns a new class of data — the class in MCP_CONSENT_DATA_CLASSES first.
//
// `propose_arrangement_design` is registered by the arrangements domain (release C), not here.
import "./builtin";
import "./tools-planning";
import "./tools-money";
import "./tools-space";
import "./tools-directory";
import "./tools-arrangements"; // release C: propose_arrangement_design (arrangements domain)
import "./tools-stationery"; // the invitation builder

export const MCP_TOOL_CATALOGUE = [
  { name: "whoami", scope: "read" },
  { name: "list_occasions", scope: "read" },
  { name: "get_occasion", scope: "read" },
  { name: "list_tasks", scope: "read" },
  { name: "get_rsvp_summary", scope: "read" },
  { name: "list_households", scope: "read" },
  { name: "list_pending_proposals", scope: "read" },
  { name: "get_budget_summary", scope: "read" },
  { name: "list_suppliers", scope: "read" },
  { name: "get_space_model", scope: "read" },
  { name: "get_seating_summary", scope: "read" },
  { name: "list_directory_filters", scope: "read" },
  { name: "search_directory", scope: "read" },
  { name: "get_listing", scope: "read" },
  { name: "list_catalogues", scope: "read" },
  { name: "propose_task_list", scope: "propose" },
  { name: "propose_invitation_text", scope: "propose" },
  { name: "propose_budget", scope: "propose" },
  { name: "propose_budget_note", scope: "propose" },
  { name: "propose_supplier_shortlist", scope: "propose" },
  { name: "propose_seating_layout", scope: "propose" },
  { name: "propose_custom_table", scope: "propose" },
  { name: "propose_arrangement_design", scope: "propose" },
  { name: "list_invitation_designs", scope: "read" },
  { name: "get_invitation_preview", scope: "read" },
  { name: "propose_invitation_design", scope: "propose" },
] as const satisfies ReadonlyArray<{ name: string; scope: "read" | "propose" }>;
