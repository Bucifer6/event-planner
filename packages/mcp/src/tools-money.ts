import { getBudget } from "@ed/core/budget";
import { listPlanNotes, proposeBudgetEstimates, proposeBudgetNote } from "@ed/core/plannotes";
import { listSuppliers } from "@ed/core/suppliers";
import { z } from "zod";
import { EXTERNAL_ASSISTANT_LABEL, mcpProposal, registerMcpTool } from "./registry";
import { iso, money, zOccasionId } from "./tools-shared";

// Budget and supplier tools. Money is visible only with the finance grant (D2): the budget
// tools fail outright without it (requireFinance inside core), and list_suppliers leaves the
// amounts out. No tool here records, moves or confirms a payment (MCP6).

registerMcpTool({
  name: "get_budget_summary",
  version: "1",
  scope: "read",
  title: "Budget summary",
  description:
    "Finance access required. Per category: estimate, forecast, committed, invoiced and paid (five separate amounts; null = unknown, never 0), totals per currency, and the notes kept on budget categories. Estimates are estimates, never quotes.",
  inputSchema: z.object({ occasionId: zOccasionId }),
  handler: async (ctx, input) => {
    const budget = await getBudget(ctx, input.occasionId); // throws without the finance grant
    const notes = await listPlanNotes(ctx, input.occasionId, { kind: "budget_note" });
    return {
      occasionId: budget.occasionId,
      categories: budget.rows.map((r) => ({
        categoryId: r.categoryId,
        name: r.name,
        estimate: money(r.estimateMinor, r.currency),
        forecast: money(r.forecastMinor, r.currency),
        committed: money(r.committedMinor, r.currency),
        invoiced: money(r.invoicedMinor, r.currency),
        paid: money(r.paidMinor, r.currency),
        overrun: money(r.overrunMinor, r.currency),
        expenseCount: r.expenseCount,
      })),
      totals: budget.totals.map((t) => ({
        currency: t.currency,
        estimate: money(t.estimateMinor, t.currency),
        categoriesWithoutEstimate: t.estimateUnknown,
        forecast: money(t.forecastMinor, t.currency),
        categoriesWithoutForecast: t.forecastUnknown,
        committed: money(t.committedMinor, t.currency),
        invoiced: money(t.invoicedMinor, t.currency),
        paid: money(t.paidMinor, t.currency),
      })),
      notes: notes.map((n) => ({
        noteId: n.id,
        categoryId: n.budgetCategoryId,
        text: n.body,
        label: n.source === "external_assistant" ? EXTERNAL_ASSISTANT_LABEL : null,
        createdAt: iso(n.createdAt),
      })),
    };
  },
});

registerMcpTool({
  name: "list_suppliers",
  version: "1",
  scope: "read",
  title: "List the plan's suppliers",
  description:
    "Suppliers in the occasion's plan with their booking state (enquired, quoted, booked …), the directory listing they came from, briefing and final-order status. Agreed amounts and the next deadline appear only with finance access; without it they are left out. No contact details.",
  inputSchema: z.object({ occasionId: zOccasionId }),
  handler: async (ctx, input) => {
    const list = await listSuppliers(ctx, input.occasionId);
    return {
      moneyVisible: list.canSeeMoney,
      suppliers: list.items.map((s) => ({
        supplierId: s.id,
        name: s.name,
        category: s.categoryLabel,
        listingId: s.listingId,
        booking: {
          bookingId: s.booking.id,
          state: s.booking.state,
          hasQuote: s.booking.hasQuote,
          ...(list.canSeeMoney ? { agreed: money(s.booking.agreedMinor, s.booking.currency) } : {}),
        },
        ...(list.canSeeMoney
          ? { nextDeadline: s.nextPayment ? { dueOn: s.nextPayment.dueOn, amount: money(s.nextPayment.amountMinor, s.nextPayment.currency), overdue: s.nextPayment.overdue } : null }
          : {}),
        briefing: s.briefing,
        hasFinalOrder: s.hasFinalOrder,
      })),
    };
  },
});

registerMcpTool({
  name: "propose_budget",
  version: "1",
  scope: "propose",
  title: "Propose budget estimates",
  description:
    "Finance access required. Proposes estimates for budget categories — existing ones (by categoryId or exact name) or new ones (by name) — each with an optional note. Every amount is shown to the user as an estimate, never as a quote or a fact.",
  inputSchema: z.object({
    occasionId: zOccasionId,
    categories: z
      .array(
        z.object({
          categoryId: z.string().min(1).max(64).optional().describe("An existing category (from get_budget_summary). Give this or name."),
          name: z.string().min(1).max(80).optional().describe("Category name: an existing name is updated, a new one is added."),
          estimateMinor: z.number().int().min(0).describe("The estimate in minor units (bani)."),
          currency: z.string().length(3).optional().describe("New categories only (default RON)."),
          note: z.string().max(1000).optional(),
        }),
      )
      .min(1)
      .max(60),
  }),
  handler: async (ctx, input) => {
    const preview = await proposeBudgetEstimates(ctx, { occasionId: input.occasionId, categories: input.categories });
    return mcpProposal(preview, { categories: input.categories.length, amountsAre: "estimates" });
  },
});

registerMcpTool({
  name: "propose_budget_note",
  version: "1",
  scope: "propose",
  title: "Propose a budget note",
  description: "Finance access required. Proposes a planner-side note on one budget category (or on the budget as a whole when categoryId is omitted). A note changes no amount.",
  inputSchema: z.object({
    occasionId: zOccasionId,
    categoryId: z.string().min(1).max(64).optional(),
    text: z.string().min(1).max(1000),
  }),
  handler: async (ctx, input) => {
    const preview = await proposeBudgetNote(ctx, { occasionId: input.occasionId, categoryId: input.categoryId, text: input.text });
    return mcpProposal(preview, { characters: input.text.trim().length });
  },
});
