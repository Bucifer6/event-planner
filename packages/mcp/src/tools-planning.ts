import { getMember, requireMember } from "@ed/core/access";
import { listBusinessOccasions } from "@ed/core/bizoccasions";
import { proposeInvitationText } from "@ed/core/invitationtext";
import { getOccasionView, listOccasions } from "@ed/core/occasions";
import { getRsvpSummary } from "@ed/core/rsvp";
import { getSeatingRoster } from "@ed/core/seating";
import { listAssignableMembers, queryTasks } from "@ed/core/tasks";
import { MAX_PROPOSED_TASKS, proposeTaskList } from "@ed/core/tasks-proposals";
import { listPending } from "@ed/core/whatif";
import { eq, mcpTokens } from "@ed/db";
import { isAppError } from "@ed/shared/errors";
import { z } from "zod";
import { setOccasionLister } from "./builtin";
import { mcpProposal, proposalConfirmUrl, registerMcpTool, type McpCtx } from "./registry";
import { iso, whatIfText, zDayInput, zLimit, zOccasionId, zOffset } from "./tools-shared";

// Planning tools: occasions, tasks, RSVP counts, the household list (managers), pending
// proposals; proposals of task lists and invitation wording. Every handler calls @ed/core
// functions whose own membership and grant checks bound the result (MCP2, SEC15).

/** The business a token was created for (MCP7), from this package's own token table. */
async function tokenBusinessId(ctx: McpCtx): Promise<string | null> {
  const [t] = await ctx.db.select({ businessId: mcpTokens.businessId }).from(mcpTokens).where(eq(mcpTokens.id, ctx.actor.tokenId));
  return t?.businessId ?? null;
}

type OccasionRow = { id: string; title: string; kind: string; status: string; startsAt: string | null; daysLeft: number | null; role: string };

/**
 * The occasions this token can reach: the account's own memberships and, for a token created
 * for a business, the occasions that business runs. Each one is re-checked with getMember —
 * the same gate every other tool passes — so an occasion handed over to its client (MCP7)
 * is never listed.
 */
async function reachableOccasions(ctx: McpCtx): Promise<OccasionRow[]> {
  const out = new Map<string, OccasionRow>();
  for (const o of await listOccasions(ctx)) {
    out.set(o.occasion.id, { id: o.occasion.id, title: o.occasion.title, kind: o.occasion.kind, status: o.occasion.status, startsAt: iso(o.occasion.startsAt), daysLeft: o.daysLeft, role: o.role });
  }
  const businessId = await tokenBusinessId(ctx);
  if (businessId) {
    try {
      for (const o of (await listBusinessOccasions(ctx, businessId)).running) {
        if (!out.has(o.id)) out.set(o.id, { id: o.id, title: o.title, kind: o.kind, status: o.status, startsAt: iso(o.startsAt), daysLeft: o.daysLeft, role: "pm" });
      }
    } catch (e) {
      if (!isAppError(e)) throw e; // no longer on that business's team: nothing to add
    }
  }
  const visible: OccasionRow[] = [];
  for (const row of out.values()) {
    const member = await getMember(ctx, row.id);
    if (member) visible.push({ ...row, role: member.role });
  }
  return visible;
}

setOccasionLister(async (ctx) => (await reachableOccasions(ctx)).map((o) => ({ id: o.id, title: o.title })));

registerMcpTool({
  name: "list_occasions",
  version: "1",
  scope: "read",
  title: "List occasions",
  description: "The occasions this connection can see: id, title, kind, status, date (or null while undecided), days left and the user's role. Upcoming first.",
  inputSchema: z.object({}),
  handler: async (ctx) => ({ occasions: await reachableOccasions(ctx) }),
});

registerMcpTool({
  name: "get_occasion",
  version: "1",
  scope: "read",
  title: "Get an occasion",
  description:
    "One occasion: kind, status, date or date-poll state, days left, venue, the brief (purpose and priorities), the user's role and grants, the team members a task can be offered to, guest counts (when the user may read the guest list) and how many proposals wait for a decision.",
  inputSchema: z.object({ occasionId: zOccasionId }),
  handler: async (ctx, input) => {
    const view = await getOccasionView(ctx, input.occasionId);
    const o = view.occasion;
    const [team, pending, rsvp] = await Promise.all([
      listAssignableMembers(ctx, o.id),
      listPending(ctx, o.id),
      // counts only, and only for roles that may read the guest list; otherwise null
      getRsvpSummary(ctx, o.id).catch((e) => {
        if (isAppError(e) && e.code === "FORBIDDEN") return null;
        throw e;
      }),
    ]);
    return {
      id: o.id,
      title: o.title,
      kind: o.kind,
      status: o.status,
      dateMode: o.dateMode,
      startsAt: iso(o.startsAt),
      endsAt: iso(o.endsAt),
      timezone: o.timezone,
      daysLeft: view.daysLeft,
      venue: { name: o.venueName, address: o.venueAddress },
      brief: { purpose: o.purpose, priorities: o.priorities },
      language: o.locale,
      member: { id: view.member.id, role: view.member.role, grants: view.member.grants, viaBusiness: !!view.member.viaBusiness },
      team: team.map((m) => ({ memberId: m.id, name: m.name, role: m.role, label: m.customLabel, isSelf: m.isSelf })),
      guestCounts: rsvp ? { households: rsvp.households, attending: rsvp.attending, invited: rsvp.invited } : null,
      pendingProposals: pending.length,
    };
  },
});

registerMcpTool({
  name: "list_tasks",
  version: "1",
  scope: "read",
  title: "List tasks",
  description: "Tasks of one occasion with owner, due day and status, ordered by due date (undated last). Filter by status, due range or to the user's own tasks; paginated.",
  inputSchema: z.object({
    occasionId: zOccasionId,
    status: z.array(z.enum(["todo", "doing", "waiting", "done"])).max(4).optional().describe("Only these statuses."),
    dueFrom: zDayInput.optional(),
    dueTo: zDayInput.optional(),
    mine: z.boolean().default(false).describe("Only tasks the user is accountable for."),
    limit: zLimit(100, 50),
    offset: zOffset,
  }),
  handler: async (ctx, input) => {
    const member = await requireMember(ctx, input.occasionId);
    const page = await queryTasks(ctx, input.occasionId, {
      statuses: input.status,
      dueFrom: input.dueFrom,
      dueTo: input.dueTo,
      ownerMemberId: input.mine ? member.id : undefined,
      limit: input.limit,
      offset: input.offset,
    });
    return {
      total: page.total,
      offset: input.offset,
      hasMore: page.hasMore,
      tasks: page.rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        dueOn: t.dueDay,
        stage: t.stage,
        overdue: t.overdue,
        owner: t.ownerMemberId ? { memberId: t.ownerMemberId, name: t.ownerName, isSelf: t.ownerMemberId === member.id } : null,
        parentId: t.parentId,
        priorityIndex: t.priorityIndex,
        checklist: t.checklist,
        subtasks: t.children,
        blockedBy: t.blockedBy,
        completedAt: iso(t.completedAt),
      })),
    };
  },
});

registerMcpTool({
  name: "get_rsvp_summary",
  version: "1",
  scope: "read",
  title: "RSVP summary",
  description: "Response counts for one occasion: households by answer, people attending (adults and children as numbers), people invited (null = unknown), capacity and the RSVP deadline. Counts only — no names.",
  inputSchema: z.object({ occasionId: zOccasionId }),
  handler: async (ctx, input) => {
    const s = await getRsvpSummary(ctx, input.occasionId);
    return {
      occasionId: s.occasionId,
      households: s.households,
      attending: s.attending,
      maybe: s.maybe,
      invited: s.invited,
      capacity: { total: s.capacity.total, taken: s.capacity.taken, left: s.capacity.left },
      rsvpDeadline: iso(s.rsvpDeadline),
    };
  },
});

registerMcpTool({
  name: "list_households",
  version: "1",
  scope: "read",
  title: "List invited households",
  description:
    "Owner and project managers only. Invited households with their answer, the named adults (with ids, for seating proposals), the number of further adults and the number of children, and the table each sits at. Children are counts, never persons. No contact details.",
  inputSchema: z.object({
    occasionId: zOccasionId,
    status: z.enum(["all", "yes", "maybe", "no", "pending"]).default("all"),
    limit: zLimit(200, 100),
    offset: zOffset,
  }),
  handler: async (ctx, input) => {
    // identities need guest-list MANAGEMENT access; everyone else has get_rsvp_summary
    await requireMember(ctx, input.occasionId, { manage: true });
    const roster = await getSeatingRoster(ctx, input.occasionId);
    const all = roster.filter((h) => input.status === "all" || (h.attending ?? "pending") === input.status);
    return {
      total: all.length,
      offset: input.offset,
      hasMore: input.offset + input.limit < all.length,
      households: all.slice(input.offset, input.offset + input.limit).map((h) => ({
        householdId: h.householdId,
        name: h.name,
        answer: h.attending ?? "pending",
        adults: h.adults.map((a) => ({ guestId: a.guestId, name: a.name, tableItemId: a.tableItemId, seatNo: a.seatNo })),
        extraAdults: h.extra ? { count: h.extra.count, tableItemId: h.extra.tableItemId } : null,
        children: h.children ? { count: h.children.count, tableItemId: h.children.tableItemId } : null,
      })),
    };
  },
});

registerMcpTool({
  name: "list_pending_proposals",
  version: "1",
  scope: "read",
  title: "List pending proposals",
  description: "Proposals of one occasion that wait for the user's decision in EventDesk (What if?), newest first: what each would change, who proposed it and when it expires. Nothing listed here has been applied.",
  inputSchema: z.object({ occasionId: zOccasionId }),
  handler: async (ctx, input, call) => {
    await requireMember(ctx, input.occasionId);
    const rows = await listPending(ctx, input.occasionId);
    return {
      confirmUrl: proposalConfirmUrl(call.appUrl, { occasionId: input.occasionId }),
      proposals: rows.map((p) => ({
        proposalId: p.id,
        kind: p.kind,
        title: p.titleKey ? whatIfText(ctx, { key: p.titleKey, params: p.titleParams ?? undefined }) : null,
        proposedBy: p.proposedByKind === "mcp" ? "external_assistant" : p.proposedByKind,
        mine: p.proposedByKind === "mcp" && p.proposedById === ctx.actor.tokenId,
        createdAt: iso(p.createdAt),
        expiresAt: iso(p.expiresAt),
        changes: p.delta.slice(0, 50).map((d) => ({ what: whatIfText(ctx, d.what), before: whatIfText(ctx, d.before), after: whatIfText(ctx, d.after) })),
        changesTotal: p.delta.length,
      })),
    };
  },
});

/* ── Proposals ──────────────────────────────────────────────────────────── */

registerMcpTool({
  name: "propose_task_list",
  version: "1",
  scope: "propose",
  title: "Propose a task list",
  description:
    "Proposes new tasks for an occasion: title, optional due day, notes and an owner (a memberId from get_occasion.team; that person is asked, never assigned silently). The user must be allowed to add tasks.",
  inputSchema: z.object({
    occasionId: zOccasionId,
    tasks: z
      .array(
        z.object({
          title: z.string().min(1).max(200),
          dueOn: zDayInput.optional(),
          notes: z.string().max(4000).optional(),
          ownerMemberId: z.string().min(1).max(64).optional().describe("memberId from get_occasion.team."),
        }),
      )
      .min(1)
      .max(MAX_PROPOSED_TASKS),
  }),
  handler: async (ctx, input) => {
    const preview = await proposeTaskList(ctx, { occasionId: input.occasionId, tasks: input.tasks });
    return mcpProposal(preview, { tasks: input.tasks.length });
  },
});

registerMcpTool({
  name: "propose_invitation_text",
  version: "1",
  scope: "propose",
  title: "Propose invitation wording",
  description:
    "Proposes the wording shown to guests on their invitation / RSVP page, as a text draft. Owner and project managers only. Once confirmed it is shown labelled as created with an external assistant until the user edits it. Never include details about children.",
  inputSchema: z.object({ occasionId: zOccasionId, text: z.string().min(1).max(1200).describe("The wording, plain text, in the occasion's language.") }),
  handler: async (ctx, input) => {
    const preview = await proposeInvitationText(ctx, { occasionId: input.occasionId, text: input.text });
    return mcpProposal(preview, { characters: input.text.trim().length });
  },
});
