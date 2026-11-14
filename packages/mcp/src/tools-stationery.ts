import { getInvitationBuilder, previewInvitationDraft, proposeInvitationDesign, STATIONERY_FIELD_LIMITS } from "@ed/core/stationery";
import { DESIGN_RANGES, STATIONERY_PIECES } from "@ed/core/stationerykit";
import { STATIONERY_TEXT_FIELDS } from "@ed/db";
import { z } from "zod";
import { mcpProposal, mcpWithImage, registerMcpTool } from "./registry";
import { zLimit, zOccasionId, zOffset } from "./tools-shared";

// The invitation builder (C-04 for assistants): read the designs an occasion can use, draw
// drafts to look at, then propose one. Proposing changes nothing: the planner confirms it in
// EventDesk, where it becomes a new, unproofed version of their invitation — the proof must
// still be checked before a print file is made, and the assistant's wording carries the AI label.

const zTexts = z
  .object(Object.fromEntries(STATIONERY_TEXT_FIELDS.map((f) => [f, z.string().max(1000).optional().describe(`Up to ${STATIONERY_FIELD_LIMITS[f]} characters.`)])) as Record<(typeof STATIONERY_TEXT_FIELDS)[number], z.ZodOptional<z.ZodString>>)
  .describe("The invitation's texts by field (see list_invitation_designs → fields). Plain text; new lines allowed in multi-line fields. Never include children's names or ages.");

const zDraft = {
  occasionId: zOccasionId,
  designKey: z.string().min(1).max(60).describe("A design key from list_invitation_designs."),
  colourwayKey: z.string().min(1).max(40).describe("One of that design's colourway keys."),
  locale: z.enum(["ro", "en"]).describe("Language of the texts."),
  texts: zTexts,
};

const clean = (t: Partial<Record<string, string>>) => Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === "string")) as Record<string, string>;

registerMcpTool({
  name: "list_invitation_designs",
  version: "1",
  scope: "read",
  title: "List invitation designs",
  description:
    "The invitation designs an occasion can use, by collection (default: the templates made for this kind of occasion), each with its colourways; the text fields with their limits; ten starter wordings; and the invitation saved now, if any. Start here, then get_invitation_preview, then propose_invitation_design.",
  inputSchema: z.object({ occasionId: zOccasionId, collection: z.enum(DESIGN_RANGES).optional().describe(`One of: ${DESIGN_RANGES.join(", ")}.`), limit: zLimit(100, 60), offset: zOffset }),
  handler: async (ctx, input) => getInvitationBuilder(ctx, input),
});

registerMcpTool({
  name: "get_invitation_preview",
  version: "1",
  scope: "read",
  title: "Preview an invitation",
  description:
    "Draws a draft invitation exactly as it would print and returns it as an image, with a fit report (fit below 1 = text set smaller to fit; tooLong = fields over their limit). Stores nothing. Look at the image and adjust before proposing.",
  inputSchema: z.object({ ...zDraft, piece: z.enum(STATIONERY_PIECES).optional().describe(`Which piece to draw (default invitation): ${STATIONERY_PIECES.join(", ")}.`) }),
  handler: async (ctx, input) => {
    const p = await previewInvitationDraft(ctx, { ...input, texts: clean(input.texts) });
    const { png, ...report } = p;
    return mcpWithImage({ ...report, fitsAsDesigned: p.fit >= 1 && !p.truncated && p.tooLong.length === 0 }, png);
  },
});

registerMcpTool({
  name: "propose_invitation_design",
  version: "1",
  scope: "propose",
  title: "Propose an invitation",
  description:
    "Proposes a complete invitation (design, colourway, language and texts) to the planner. Owner and project managers only. Nothing changes until they confirm it in EventDesk; it then becomes a new version, which they must still proof before printing. Texts you wrote are labelled as created with an external assistant.",
  inputSchema: z.object({ ...zDraft, qrOnInvitation: z.boolean().optional().describe("Print each household's RSVP QR code on its invitation.") }),
  handler: async (ctx, input) => {
    const preview = await proposeInvitationDesign(ctx, { ...input, texts: clean(input.texts) });
    return mcpProposal(preview, { designKey: input.designKey, colourwayKey: input.colourwayKey });
  },
});
