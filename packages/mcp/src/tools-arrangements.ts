import { ARRANGEMENT_FORMS, indicativeCostText, proposeArrangementDesign } from "@ed/core/arrangements";
import { z } from "zod";
import { mcpProposal, registerMcpTool } from "./registry";
import { zOccasionId } from "./tools-shared";

// Flower arrangement designer (F3, MCP3, MCP5) — release C. One propose tool: it stores a
// What-if preview ("arrangement.applyDesign") that a person confirms in the app; nothing is
// saved, sent or ordered by the assistant. Catalogue prices stay INDICATIVE — the summary says
// so in words and never calls the figure a quote. There is no tool that sends a quote request
// (MCP6): asking a florist is the planner's own act, in the app.

registerMcpTool({
  name: "propose_arrangement_design",
  version: "1",
  scope: "propose",
  title: "Propose a flower arrangement design",
  description:
    "Owner and project managers only. Proposes an arrangement design: a base form and catalogue items (ids from list_catalogues) with stem counts, optionally as a new version of an existing design. Returns the indicative cost built from published prices per stem — indicative only, never a quote; items without a published price are reported as unpriced, not as zero. The person reviews and confirms it in the app.",
  inputSchema: z.object({
    occasionId: zOccasionId,
    designId: z.string().min(1).max(64).optional().describe("An existing design to add a version to. Omit for a new design."),
    name: z.string().trim().min(1).max(80).optional().describe("Name of the design (new designs)."),
    form: z.enum(ARRANGEMENT_FORMS).describe("Base form."),
    items: z
      .array(
        z.object({
          catalogueItemId: z.string().min(1).max(64).describe("Catalogue item id from list_catalogues."),
          stems: z.number().int().min(1).max(500).describe("Number of stems."),
          colour: z.string().max(24).optional().describe("One of the item's published colours."),
        }),
      )
      .min(1)
      .max(24),
    note: z.string().trim().max(600).optional().describe("Note for the florist (style, size, what to avoid)."),
  }),
  handler: async (ctx, input) => {
    const { occasionId, ...design } = input;
    const { preview, cost, stems } = await proposeArrangementDesign(ctx, { occasionId, ...design });
    return mcpProposal(preview, {
      stems,
      indicativeCost: {
        label: ctx.locale === "ro" ? "cost orientativ — nu este o ofertă" : "indicative cost — not a quote",
        text: indicativeCostText(cost, ctx.locale),
        known: cost.known.map((k) => ({ amountMinor: k.minor, currency: k.currency })),
        unpricedItems: cost.unpricedLines,
        isQuote: false,
      },
    });
  },
});
