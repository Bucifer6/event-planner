import { prisma } from '@eventdesk/db';
import { AppError, hashToken, newToken, now } from '@eventdesk/shared';
import {
  audit,
  createPreview,
  fitCheck,
  getListingPublic,
  getMember,
  getSpaceModel,
  listPublicCatalogues,
  requireMember,
  requireRole,
  searchDirectory,
} from '@eventdesk/core';

// MCP1-MCP8 + SEC15: personal scoped tokens (hashed, revocable, 30-day inactivity
// expiry); read tools bounded by the user's own grants (MCP2); propose tools
// bounded by write grants and return a proposal id, never apply (MCP3, SEC15);
// per-call audit (MCP1); per-token consent warning before first use (MCP4);
// external-assistant labelling (MCP5); no admin/payment/other-account tools (MCP6).

export type McpScope = 'read' | 'read_propose';

export interface McpContext {
  tokenId: string;
  accountId: string;
  scopes: string[];
}

export async function authenticateToken(rawToken: string): Promise<McpContext> {
  const token = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!token || token.revokedAt) throw new AppError('UNAUTHENTICATED', 'Invalid or revoked token.');
  if (token.lastUsedAt && now().getTime() - token.lastUsedAt.getTime() > 30 * 86_400_000) {
    throw new AppError('UNAUTHENTICATED', 'Token expired after 30 days of inactivity (MCP1).');
  }
  await prisma.mcpToken.update({ where: { id: token.id }, data: { lastUsedAt: now() } });
  return { tokenId: token.id, accountId: token.accountId, scopes: token.scopes };
}

// MCP4: the per-token consent warning must be shown before the first use of each
// token; the caller records consentShownAt on first call.
export async function ensureConsentShown(tokenId: string): Promise<boolean> {
  const token = await prisma.mcpToken.findUniqueOrThrow({ where: { id: tokenId } });
  if (token.consentShownAt) return true;
  await prisma.mcpToken.update({ where: { id: tokenId }, data: { consentShownAt: now() } });
  return false; // first use: caller must surface the plain-language warning
}

export async function logCall(
  tokenId: string,
  tool: string,
  scope: string,
  ok: boolean,
  error?: string
) {
  await prisma.mcpCallLog.create({
    data: { tokenId, tool, scope, ok, error: error?.slice(0, 500) ?? null },
  });
}

export function issueToken(
  accountId: string,
  name: string,
  scopes: McpScope[]
): { token: string; id: string } {
  const token = newToken();
  return { token, id: '' };
}

export async function createToken(
  accountId: string,
  name: string,
  scopes: McpScope[]
): Promise<{ token: string; id: string }> {
  const token = newToken();
  const row = await prisma.mcpToken.create({
    data: { accountId, name, tokenHash: hashToken(token), scopes },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'mcp_token_created',
    objectType: 'McpToken',
    objectId: row.id,
    after: { name, scopes, last4: token.slice(-4) },
  });
  return { token, id: row.id };
}

export async function revokeToken(tokenId: string, accountId: string): Promise<void> {
  await prisma.mcpToken.updateMany({
    where: { id: tokenId, accountId, revokedAt: null },
    data: { revokedAt: now() },
  });
  await audit({
    actorId: accountId,
    actorKind: 'account',
    action: 'mcp_token_revoked',
    objectType: 'McpToken',
    objectId: tokenId,
  });
}

// --- read tools (MCP2: bounded by the user's own access grants) ---

export async function toolGetOccasion(ctx: McpContext, args: { occasionId: string }) {
  const member = await getMember(args.occasionId, ctx.accountId);
  if (!member) throw new AppError('FORBIDDEN', 'No access to this occasion.');
  const occ = await prisma.occasion.findUniqueOrThrow({ where: { id: args.occasionId } });
  const guests = await prisma.household.count({ where: { occasionId: occ.id } });
  const rsvp = await prisma.rsvpResponse.aggregate({
    where: { household: { occasionId: occ.id } },
    _sum: { adults: true, childrenCount: true },
  });
  return {
    kind: occ.kind,
    title: occ.title,
    date: occ.dateStart,
    dateMode: occ.dateMode,
    pollState: occ.dateMode === 'poll' ? 'poll' : 'set',
    guestCount: (rsvp._sum.adults ?? 0) + (rsvp._sum.childrenCount ?? 0),
    households: guests,
    roles: [member.role],
  };
}

export async function toolListTasks(ctx: McpContext, args: { occasionId: string }) {
  await requireMember(args.occasionId, ctx.accountId);
  const tasks = await prisma.task.findMany({
    where: { occasionId: args.occasionId },
    include: { owner: true },
    orderBy: { dueAt: 'asc' },
  });
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    dueAt: t.dueAt,
    owner: t.owner?.role ?? null,
  }));
}

// Finance grant required (D2/SEC15 mirror on reads).
export async function toolGetBudgetSummary(ctx: McpContext, args: { occasionId: string }) {
  const member = await requireMember(args.occasionId, ctx.accountId);
  if (!member.finance) throw new AppError('FORBIDDEN', 'Finance access required.');
  const cats = await prisma.budgetCategory.findMany({ where: { occasionId: args.occasionId } });
  return {
    categories: cats.map((c) => ({
      name: c.name,
      currency: c.currency,
      estimateBani: c.estimateBani,
      committedBani: c.committedBani,
      invoicedBani: c.invoicedBani,
      paidBani: c.paidBani,
      forecastBani: c.forecastBani,
    })),
  };
}

export async function toolGetRsvpSummary(ctx: McpContext, args: { occasionId: string }) {
  await requireMember(args.occasionId, ctx.accountId);
  const responses = await prisma.rsvpResponse.findMany({
    where: { household: { occasionId: args.occasionId } },
  });
  return {
    householdsResponded: responses.length,
    adults: responses.reduce((s, r) => s + r.adults, 0),
    childrenCount: responses.reduce((s, r) => s + r.childrenCount, 0), // counts only (A6)
  };
}

// --- propose tools (MCP3/SEC15: bounded by write grants; return a proposal id, never apply) ---

function requireProposeScope(ctx: McpContext) {
  if (!ctx.scopes.includes('read_propose')) {
    throw new AppError('FORBIDDEN', 'Token scope is read-only.');
  }
}

export async function toolProposeTaskList(
  ctx: McpContext,
  args: { occasionId: string; tasks: { title: string; dueAt?: string }[] }
) {
  requireProposeScope(ctx);
  const member = await requireMember(args.occasionId, ctx.accountId);
  if (!['owner', 'project_manager', 'workstream_lead', 'contributor'].includes(member.role)) {
    throw new AppError('FORBIDDEN', 'Guest/supplier roles cannot propose task lists (SEC15).');
  }
  const preview = await createPreview({
    occasionId: args.occasionId,
    subject: 'mcp_propose_task_list',
    delta: {
      tasks: args.tasks,
      label: 'creat cu un asistent extern', // MCP5 external-assistant labelling
      estimatesNote: 'proposed, not applied',
    },
    proposedByAccountId: ctx.accountId,
    proposedByTokenId: ctx.tokenId,
  });
  await audit({
    actorId: ctx.accountId,
    actorKind: 'mcp_token',
    action: 'mcp_proposal_created',
    objectType: 'WhatIfPreview',
    objectId: preview.id,
    after: { tool: 'propose_task_list', proposalId: preview.id },
  });
  return { proposalId: preview.id, state: preview.state };
}

export async function toolProposeBudget(
  ctx: McpContext,
  args: { occasionId: string; categories: { name: string; estimateBani: number; note?: string }[] }
) {
  requireProposeScope(ctx);
  const member = await requireMember(args.occasionId, ctx.accountId);
  if (!member.finance) {
    throw new AppError(
      'FORBIDDEN',
      'A contributor without finance access cannot use propose_budget (SEC15).'
    );
  }
  const preview = await createPreview({
    occasionId: args.occasionId,
    subject: 'mcp_propose_budget',
    delta: {
      categories: args.categories,
      label: 'creat cu un asistent extern',
      estimatesAreEstimates: true, // principle 5: nothing presented as a quote or fact
    },
    proposedByAccountId: ctx.accountId,
    proposedByTokenId: ctx.tokenId,
  });
  await audit({
    actorId: ctx.accountId,
    actorKind: 'mcp_token',
    action: 'mcp_proposal_created',
    objectType: 'WhatIfPreview',
    objectId: preview.id,
    after: { tool: 'propose_budget', proposalId: preview.id },
  });
  return { proposalId: preview.id, state: preview.state };
}

export async function toolProposeInvitationText(
  ctx: McpContext,
  args: { occasionId: string; text: string }
) {
  requireProposeScope(ctx);
  await requireMember(args.occasionId, ctx.accountId);
  const preview = await createPreview({
    occasionId: args.occasionId,
    subject: 'mcp_propose_invitation_text',
    delta: { text: args.text, label: 'creat cu un asistent extern' }, // INF7/MCP5 labelling
    proposedByAccountId: ctx.accountId,
    proposedByTokenId: ctx.tokenId,
  });
  return { proposalId: preview.id, state: preview.state };
}

// The fixed, versioned tool catalogue (MCP8): served by the MCP server itself;
// every tool declares its scope. No payment/admin/other-account tools exist.
// --- Release P directory tools (MCP8: public factual data, read-only; the space
// model stays bounded by the user's own occasion grants, MCP2) ---

export async function toolSearchDirectory(
  ctx: McpContext,
  args: { categorySlug: string; countyCode: string; localityId?: string; limit?: number }
) {
  void ctx;
  const results = await searchDirectory({
    categorySlug: args.categorySlug,
    countyCode: args.countyCode,
    localityId: args.localityId || undefined,
    limit: args.limit,
  });
  return results.map((r) => ({
    listingId: r.listing.id,
    name: r.listing.name,
    badges: r.badges,
    unclaimed: r.unclaimed,
    stats: r.stats ?? null,
    categories: r.listing.categories.map((c) => c.category.slug),
    counties: r.listing.counties.map((c) => c.county.code),
  }));
}

export async function toolGetListing(ctx: McpContext, args: { listingId: string }) {
  void ctx;
  const r = await getListingPublic(args.listingId);
  return {
    listingId: r.listing.id,
    name: r.listing.name,
    description: r.listing.description,
    badges: r.badges,
    unclaimed: r.unclaimed,
    publicContactRoute: r.unclaimed ? (r.publicContactRoute ?? null) : null, // P29: only the published route, never a claimed business's private data
    stats: r.stats ?? null,
    categories: r.listing.categories.map((c) => ({
      slug: c.category.slug,
      name: c.category.nameRo,
    })),
    counties: r.listing.counties.map((c) => c.county.code),
    localities:
      (r.listing as { localities?: { locality: { nameRo: string } }[] }).localities?.map(
        (l) => l.locality.nameRo
      ) ?? [],
    calibratedDrawings:
      (
        r.listing as { drawings?: { id: string; spaceName: string; version: number }[] }
      ).drawings?.map((d) => ({ id: d.id, spaceName: d.spaceName, version: d.version })) ?? [],
    catalogues:
      (r.listing as { catalogues?: { id: string; name: string }[] }).catalogues?.map((c) => ({
        id: c.id,
        name: c.name,
      })) ?? [],
  };
}

export async function toolListCatalogues(ctx: McpContext, args: { categorySlug?: string }) {
  void ctx;
  const catalogues = await listPublicCatalogues(args.categorySlug ?? 'floristi');
  return catalogues.map((c) => ({
    catalogueId: c.id,
    listingId: c.listingId,
    name: c.name,
    items: c.items.map((i) => ({
      variety: i.variety,
      seasonality: i.seasonality,
      pricePerStemBani: i.pricePerStemBani,
      colours: i.colours,
    })),
  }));
}

export async function toolGetSpaceModel(ctx: McpContext, args: { occasionId: string }) {
  const model = await getSpaceModel(args.occasionId, ctx.accountId); // MCP2: own grants only
  if (!model) return null;
  return {
    occasionId: args.occasionId,
    version: model.version,
    effectiveAt: model.effectiveAt,
    drawing: {
      id: model.drawing.id,
      spaceName: model.drawing.spaceName,
      pixelsPerMeter: model.drawing.pixelsPerMeter,
      tables: model.drawing.tables,
      fixtures: model.drawing.fixtures,
      pois: model.drawing.pois,
      parking: model.drawing.parking,
    },
    customTables: model.customTables,
  };
}

// --- Release P propose tools (MCP3/SEC15: propose-only, bounded by write grants) ---

export async function toolProposeSupplierShortlist(
  ctx: McpContext,
  args: { occasionId: string; listingIds: string[]; rationale: string }
) {
  requireProposeScope(ctx);
  await requireMember(args.occasionId, ctx.accountId);
  // P-15: a shortlist is a planner-side note only — it notifies nobody, and the
  // planner still sends any enquiry personally (P8). Labelling state is carried
  // over verbatim from the directory (D3).
  const items = [] as {
    listingId: string;
    name: string;
    badges: string[];
    unclaimed: boolean;
    featuredLabel: string | null;
  }[];
  for (const id of args.listingIds) {
    try {
      const r = await getListingPublic(id);
      items.push({
        listingId: id,
        name: r.listing.name,
        badges: r.badges,
        unclaimed: r.unclaimed,
        featuredLabel: null, // MON5: while OFF there is no Featured; when ON the label is copied verbatim by the caller UI
      });
    } catch {
      throw new AppError('NOT_FOUND', `Listing ${id} is not live.`);
    }
  }
  const preview = await createPreview({
    occasionId: args.occasionId,
    subject: 'mcp_propose_supplier_shortlist',
    delta: {
      items,
      rationale: args.rationale,
      label: 'creat cu un asistent extern',
      notifiesNobody: true,
    },
    proposedByAccountId: ctx.accountId,
    proposedByTokenId: ctx.tokenId,
  });
  await audit({
    actorId: ctx.accountId,
    actorKind: 'mcp_token',
    action: 'mcp_proposal_created',
    objectType: 'WhatIfPreview',
    objectId: preview.id,
    after: { tool: 'propose_supplier_shortlist', proposalId: preview.id },
  });
  return { proposalId: preview.id, state: preview.state };
}

export async function toolProposeSeatingLayout(
  ctx: McpContext,
  args: {
    occasionId: string;
    assignments: { householdId: string; tableId: string; seat?: string }[];
  }
) {
  requireProposeScope(ctx);
  await requireRole(args.occasionId, ctx.accountId, [
    'owner',
    'project_manager',
    'workstream_lead',
  ]);
  const model = await getSpaceModel(args.occasionId, ctx.accountId); // V6 fit check against the space model
  if (!model) throw new AppError('NOT_FOUND', 'No space model on this occasion.');
  const fit = fitCheck({
    tables: [
      ...model.drawing.tables.map((t) => ({ widthM: t.widthM, heightM: t.heightM })),
      ...model.customTables.map((t) => ({ widthM: t.widthM, heightM: t.heightM })),
    ],
  });
  const preview = await createPreview({
    occasionId: args.occasionId,
    subject: 'mcp_propose_seating_layout',
    delta: {
      assignments: args.assignments,
      fitCheck: fit, // V6: unknown dims excluded and reported
      label: 'creat cu un asistent extern',
    },
    proposedByAccountId: ctx.accountId,
    proposedByTokenId: ctx.tokenId,
  });
  await audit({
    actorId: ctx.accountId,
    actorKind: 'mcp_token',
    action: 'mcp_proposal_created',
    objectType: 'WhatIfPreview',
    objectId: preview.id,
    after: { tool: 'propose_seating_layout', proposalId: preview.id },
  });
  return { proposalId: preview.id, state: preview.state, fitCheck: fit };
}

export async function toolProposeCustomTable(
  ctx: McpContext,
  args: { occasionId: string; name: string; widthM?: number; heightM?: number }
) {
  requireProposeScope(ctx);
  await requireRole(args.occasionId, ctx.accountId, [
    'owner',
    'project_manager',
    'workstream_lead',
  ]);
  const preview = await createPreview({
    occasionId: args.occasionId,
    subject: 'mcp_propose_custom_table',
    delta: {
      name: args.name,
      widthM: args.widthM ?? null,
      heightM: args.heightM ?? null,
      custom: true,
      label: 'creat cu un asistent extern',
    }, // V5
    proposedByAccountId: ctx.accountId,
    proposedByTokenId: ctx.tokenId,
  });
  await audit({
    actorId: ctx.accountId,
    actorKind: 'mcp_token',
    action: 'mcp_proposal_created',
    objectType: 'WhatIfPreview',
    objectId: preview.id,
    after: { tool: 'propose_custom_table', proposalId: preview.id },
  });
  return { proposalId: preview.id, state: preview.state };
}

export async function toolProposeArrangementDesign(
  ctx: McpContext,
  args: {
    occasionId: string;
    baseForm: string;
    items: { catalogueItemId: string; stems: number }[];
    note?: string;
  }
) {
  requireProposeScope(ctx);
  await requireMember(args.occasionId, ctx.accountId);
  // F3: running indicative cost from published prices, labelled indicative, never a quote
  let indicativeBani = 0;
  for (const it of args.items) {
    const item = await prisma.catalogueItem.findUnique({
      where: { id: it.catalogueItemId },
      select: { pricePerStemBani: true },
    });
    if (!item) throw new AppError('NOT_FOUND', `Catalogue item ${it.catalogueItemId} not found.`);
    if (item.pricePerStemBani != null) indicativeBani += item.pricePerStemBani * it.stems;
  }
  const preview = await createPreview({
    occasionId: args.occasionId,
    subject: 'mcp_propose_arrangement_design',
    delta: {
      baseForm: args.baseForm,
      items: args.items,
      note: args.note ?? null,
      indicativeCostBani: indicativeBani,
      indicativeNotQuote: true, // F3
      label: 'creat cu un asistent extern',
    },
    proposedByAccountId: ctx.accountId,
    proposedByTokenId: ctx.tokenId,
  });
  await audit({
    actorId: ctx.accountId,
    actorKind: 'mcp_token',
    action: 'mcp_proposal_created',
    objectType: 'WhatIfPreview',
    objectId: preview.id,
    after: { tool: 'propose_arrangement_design', proposalId: preview.id },
  });
  return { proposalId: preview.id, state: preview.state, indicativeCostBani: indicativeBani };
}

export async function toolProposeBudgetNote(
  ctx: McpContext,
  args: { occasionId: string; note: string; categoryId?: string; estimateDeltaBani?: number }
) {
  requireProposeScope(ctx);
  const member = await requireMember(args.occasionId, ctx.accountId);
  if (!member.finance) {
    throw new AppError('FORBIDDEN', 'Finance access required for budget notes (SEC15).');
  }
  const preview = await createPreview({
    occasionId: args.occasionId,
    subject: 'mcp_propose_budget_note',
    delta: {
      note: args.note,
      categoryId: args.categoryId ?? null,
      estimateDeltaBani: args.estimateDeltaBani ?? null,
      estimatesAreEstimates: true,
      label: 'creat cu un asistent extern',
    },
    proposedByAccountId: ctx.accountId,
    proposedByTokenId: ctx.tokenId,
  });
  await audit({
    actorId: ctx.accountId,
    actorKind: 'mcp_token',
    action: 'mcp_proposal_created',
    objectType: 'WhatIfPreview',
    objectId: preview.id,
    after: { tool: 'propose_budget_note', proposalId: preview.id },
  });
  return { proposalId: preview.id, state: preview.state };
}

export const TOOL_CATALOGUE = [
  {
    name: 'get_occasion',
    kind: 'read',
    description: 'Occasion kind, date/poll state, guest count summary, roles the user holds',
  },
  {
    name: 'list_tasks',
    kind: 'read',
    description: 'Tasks with owner, due date, status (own scope only)',
  },
  {
    name: 'get_budget_summary',
    kind: 'read',
    description:
      'Category totals: estimate, committed, invoiced, paid, forecast (finance access required)',
  },
  {
    name: 'get_rsvp_summary',
    kind: 'read',
    description:
      'Response counts and household attendance, never individual identities without guest-list access',
  },
  {
    name: 'propose_task_list',
    kind: 'propose',
    description: 'New tasks as a What-if proposal; returns a proposal id, never applies',
  },
  {
    name: 'propose_budget',
    kind: 'propose',
    description:
      'Budget structure as a proposal (finance write access required); estimates labelled as estimates',
  },
  {
    name: 'propose_invitation_text',
    kind: 'propose',
    description: 'Invitation wording drafts labelled as AI-generated',
  },
  {
    name: 'search_directory',
    kind: 'read',
    description:
      'Public directory search: live listings per category x county, daily-rotated organic order, factual badges only',
  },
  {
    name: 'get_listing',
    kind: 'read',
    description:
      'Public listing page data; unclaimed listings expose only the published contact route (P29)',
  },
  {
    name: 'list_catalogues',
    kind: 'read',
    description: 'Published flower/styling catalogues with indicative prices (never quotes)',
  },
  {
    name: 'get_space_model',
    kind: 'read',
    description:
      'Occasion space model (venue drawing version, tables, fixtures, POIs, parking) - own occasions only',
  },
  {
    name: 'propose_supplier_shortlist',
    kind: 'propose',
    description:
      'Directory shortlist as a plan note only; notifies nobody; Featured/labelling carried verbatim',
  },
  {
    name: 'propose_seating_layout',
    kind: 'propose',
    description:
      'Seating plan as a fit-checked (V6) proposal against the space model; applied only on explicit confirm',
  },
  {
    name: 'propose_custom_table',
    kind: 'propose',
    description: 'A custom table (marked custom, V5) as a proposal',
  },
  {
    name: 'propose_arrangement_design',
    kind: 'propose',
    description:
      'Arrangement design from catalogue items with running indicative cost labelled indicative (F3), never a quote',
  },
  {
    name: 'propose_budget_note',
    kind: 'propose',
    description: 'Budget note/estimate adjustment as a proposal (finance access required, SEC15)',
  },
] as const;

export async function dispatchTool(
  ctx: McpContext,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const scope = TOOL_CATALOGUE.find((t) => t.name === name)?.kind ?? 'read';
  try {
    let result: unknown;
    switch (name) {
      case 'get_occasion':
        result = await toolGetOccasion(ctx, args as never);
        break;
      case 'list_tasks':
        result = await toolListTasks(ctx, args as never);
        break;
      case 'get_budget_summary':
        result = await toolGetBudgetSummary(ctx, args as never);
        break;
      case 'get_rsvp_summary':
        result = await toolGetRsvpSummary(ctx, args as never);
        break;
      case 'propose_task_list':
        result = await toolProposeTaskList(ctx, args as never);
        break;
      case 'propose_budget':
        result = await toolProposeBudget(ctx, args as never);
        break;
      case 'propose_invitation_text':
        result = await toolProposeInvitationText(ctx, args as never);
        break;
      case 'search_directory':
        result = await toolSearchDirectory(ctx, args as never);
        break;
      case 'get_listing':
        result = await toolGetListing(ctx, args as never);
        break;
      case 'list_catalogues':
        result = await toolListCatalogues(ctx, args as never);
        break;
      case 'get_space_model':
        result = await toolGetSpaceModel(ctx, args as never);
        break;
      case 'propose_supplier_shortlist':
        result = await toolProposeSupplierShortlist(ctx, args as never);
        break;
      case 'propose_seating_layout':
        result = await toolProposeSeatingLayout(ctx, args as never);
        break;
      case 'propose_custom_table':
        result = await toolProposeCustomTable(ctx, args as never);
        break;
      case 'propose_arrangement_design':
        result = await toolProposeArrangementDesign(ctx, args as never);
        break;
      case 'propose_budget_note':
        result = await toolProposeBudgetNote(ctx, args as never);
        break;
      default:
        throw new AppError('NOT_FOUND', `Unknown tool: ${name}`);
    }
    await logCall(ctx.tokenId, name, scope, true);
    return result;
  } catch (e) {
    await logCall(ctx.tokenId, name, scope, false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
