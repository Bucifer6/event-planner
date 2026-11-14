import { requireMember } from "@ed/core/access";
import { getSeatingSummary, getSpaceModel } from "@ed/core/seating";
import { createPreview } from "@ed/core/whatif";
import { z } from "zod";
import { mcpProposal, registerMcpTool } from "./registry";
import { iso, whatIfText, zOccasionId } from "./tools-shared";

// Space model and seating tools (V1–V11). The model is GEOMETRY in real millimetres — never
// the uploaded picture. Layout proposals use the existing What-if kinds of @ed/core/seating
// ("seating.applyLayout", "space.addCustomTable"), which fit-check the result (V6).

registerMcpTool({
  name: "get_space_model",
  version: "1",
  scope: "read",
  title: "Space model",
  description:
    "The occasion's space as geometry in millimetres: stated dimensions (null = unknown), floor areas, the venue's table types, placed tables and fixtures (with seats and places taken), points of interest, parking areas and parking facts. Never the raw drawing image.",
  inputSchema: z.object({ occasionId: zOccasionId }),
  handler: async (ctx, input) => {
    const view = await getSpaceModel(ctx, input.occasionId);
    if (!view) return { hasSpace: false };
    return {
      hasSpace: true,
      spaceModelId: view.id,
      name: view.name,
      source: view.source,
      versionNo: view.versionNo,
      effectiveAt: iso(view.effectiveAt),
      listingId: view.listingId,
      newerVenueDrawingAvailable: !!view.newerVersion,
      units: "mm",
      model: view.model,
      parking: view.parking,
    };
  },
});

registerMcpTool({
  name: "get_seating_summary",
  version: "1",
  scope: "read",
  title: "Seating summary",
  description: "Seating in numbers: each table with seats and places taken, people not seated yet (adults and children as counts), whether the plan is published to guests, and the fit check of the layout and of every meal stage. No names.",
  inputSchema: z.object({ occasionId: zOccasionId }),
  handler: async (ctx, input) => {
    const s = await getSeatingSummary(ctx, input.occasionId);
    return {
      hasSpace: s.hasSpace,
      space: s.space ? { ...s.space, effectiveAt: iso(s.space.effectiveAt) } : null,
      publishedAt: iso(s.publishedAt),
      tables: s.tables.map((t) => ({ tableItemId: t.id, label: t.label, name: t.name, source: t.source, seats: t.seats, seated: t.seated, sizeKnown: t.sizeKnown })),
      seats: s.seats,
      unseated: s.unseated,
      fit: s.fit,
    };
  },
});

const customTable = z.object({
  name: z.string().min(1).max(80),
  shape: z.enum(["round", "rect", "oval", "halfmoon"]),
  diameterMm: z.number().int().min(1).nullable().optional().describe("Round and half-moon tables."),
  widthMm: z.number().int().min(1).nullable().optional().describe("Rectangular and oval tables."),
  lengthMm: z.number().int().min(1).nullable().optional().describe("Rectangular and oval tables."),
  seats: z.number().int().min(0),
});

registerMcpTool({
  name: "propose_seating_layout",
  version: "1",
  scope: "propose",
  title: "Propose a seating layout",
  description:
    "Owner and project managers only. Proposes a full or partial layout against the space model: move existing tables (itemId), add tables from the venue's types (tableTypeId) or custom ones, and seat named adults (guestIds) or counted blocks (a household's further adults or its children). Positions are millimetres in the space model. The proposal is fit-checked; the result of the check is returned and shown to the user.",
  inputSchema: z.object({
    occasionId: zOccasionId,
    mode: z.enum(["merge", "replace"]).default("merge").describe("merge = touch only the listed tables; replace = tables not listed are removed (fixtures always stay)."),
    tables: z
      .array(
        z.object({
          itemId: z.string().min(1).max(64).optional().describe("An existing table (tableItemId). Give exactly one of itemId, tableTypeId, custom."),
          tableTypeId: z.string().min(1).max(40).optional().describe("A table type of the venue (get_space_model.model.tableTypes)."),
          custom: customTable.optional(),
          label: z.string().min(1).max(24).optional(),
          x: z.number().int(),
          y: z.number().int(),
          rotation: z.number().int().min(-3600).max(3600).default(0),
          guestIds: z.array(z.string().min(1).max(64)).max(500).default([]).describe("Named adults (guestId from list_households)."),
          groups: z
            .array(z.object({ householdId: z.string().min(1).max(64), kind: z.enum(["extra", "children"]) }))
            .max(500)
            .default([])
            .describe("Counted blocks: a household's further adults (extra) or its children."),
        }),
      )
      .min(1)
      .max(200),
  }),
  handler: async (ctx, input) => {
    // SEC15: in the app only the owner and project managers change the layout
    await requireMember(ctx, input.occasionId, { manage: true });
    const { occasionId, ...layout } = input;
    const preview = await createPreview(ctx, { kind: "seating.applyLayout", occasionId, subjectType: "occasion", subjectId: occasionId, input: layout });
    const fit = preview.delta.find((d) => d.key === "fit");
    return mcpProposal(preview, { tables: layout.tables.length, mode: layout.mode, fitCheck: fit ? whatIfText(ctx, fit.after) : null });
  },
});

registerMcpTool({
  name: "propose_custom_table",
  version: "1",
  scope: "propose",
  title: "Propose a custom table",
  description: "Owner and project managers only. Proposes adding one or more custom tables (name, shape, dimensions in millimetres, seats) to the occasion's space model.",
  inputSchema: customTable.extend({
    occasionId: zOccasionId,
    count: z.number().int().min(1).max(60).default(1),
    x: z.number().int().optional(),
    y: z.number().int().optional(),
  }),
  handler: async (ctx, input) => {
    await requireMember(ctx, input.occasionId, { manage: true });
    const { occasionId, ...table } = input;
    const preview = await createPreview(ctx, { kind: "space.addCustomTable", occasionId, subjectType: "occasion", subjectId: occasionId, input: table });
    return mcpProposal(preview, { tables: table.count, seats: table.seats * table.count });
  },
});
