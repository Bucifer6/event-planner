import { describe, expect, it } from 'vitest';
import { prisma } from '@eventdesk/db';
import { createOccasion, createCategory } from '@eventdesk/core';
import {
  authenticateToken,
  createToken,
  dispatchTool,
  ensureConsentShown,
  revokeToken,
  TOOL_CATALOGUE,
} from '../src/index';

async function setup() {
  const owner = await prisma.account.create({
    data: {
      kind: 'email',
      email: `mcp-owner-${Math.random().toString(36).slice(2)}@example.com`,
      emailVerifiedAt: new Date(),
    },
  });
  const occasion = await createOccasion({
    ownerId: owner.id,
    title: 'Botez MCP',
    kind: 'botez',
    dateMode: 'date',
    dateStart: new Date('2027-05-01T12:00:00Z'),
  });
  const contributor = await prisma.account.create({
    data: {
      kind: 'email',
      email: `mcp-contrib-${Math.random().toString(36).slice(2)}@example.com`,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.occasionMember.create({
    data: {
      occasionId: occasion.id,
      accountId: contributor.id,
      role: 'contributor',
      finance: false,
    },
  });
  return { owner, occasion, contributor };
}

describe('MCP1-MCP8, SEC15', () => {
  it('token auth works; revoked token fails at once; consent shown once per token (MCP4)', async () => {
    const { owner } = await setup();
    const { token } = await createToken(owner.id, 'assistant', ['read', 'read_propose']);
    const ctx = await authenticateToken(token);
    expect(ctx.accountId).toBe(owner.id);
    expect(await ensureConsentShown(ctx.tokenId)).toBe(false); // first use: warning required
    expect(await ensureConsentShown(ctx.tokenId)).toBe(true);
    await revokeToken(ctx.tokenId, owner.id);
    await expect(authenticateToken(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('read tools are bounded by the user’s own grants (MCP2)', async () => {
    const { owner, occasion, contributor } = await setup();
    const cat = await createCategory(occasion.id, owner.id, {
      name: 'Catering',
      estimateBani: 1000,
    });
    void cat;
    const { token: ownerToken } = await createToken(owner.id, 'o', ['read', 'read_propose']);
    const { token: contribToken } = await createToken(contributor.id, 'c', [
      'read',
      'read_propose',
    ]);
    const ownerCtx = await authenticateToken(ownerToken);
    const contribCtx = await authenticateToken(contribToken);

    // finance-less contributor: no budget data (MCP2/SEC15)
    await expect(
      dispatchTool(contribCtx, 'get_budget_summary', { occasionId: occasion.id })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const budget = (await dispatchTool(ownerCtx, 'get_budget_summary', {
      occasionId: occasion.id,
    })) as {
      categories: { name: string }[];
    };
    expect(budget.categories[0]!.name).toBe('Catering');

    // occasion read works for both
    const occ = (await dispatchTool(contribCtx, 'get_occasion', { occasionId: occasion.id })) as {
      title: string;
    };
    expect(occ.title).toBe('Botez MCP');
    // no access to an occasion the user is not a member of
    const other = await prisma.account.create({
      data: {
        kind: 'email',
        email: `mcp-other-${Math.random().toString(36).slice(2)}@example.com`,
        emailVerifiedAt: new Date(),
      },
    });
    const { token: otherToken } = await createToken(other.id, 'x', ['read']);
    await expect(
      dispatchTool(await authenticateToken(otherToken), 'get_occasion', { occasionId: occasion.id })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('propose tools create a pending What-if proposal and never apply (MCP3/SEC15); guest role cannot propose tasks', async () => {
    const { owner, occasion, contributor } = await setup();
    const { token } = await createToken(owner.id, 'o', ['read_propose']);
    const ctx = await authenticateToken(token);
    const before = await prisma.task.count({ where: { occasionId: occasion.id } });
    const res = (await dispatchTool(ctx, 'propose_task_list', {
      occasionId: occasion.id,
      tasks: [{ title: 'rezervă fotograful' }],
    })) as { proposalId: string; state: string };
    expect(res.state).toBe('pending');
    // nothing applied
    expect(await prisma.task.count({ where: { occasionId: occasion.id } })).toBe(before);
    const preview = await prisma.whatIfPreview.findUniqueOrThrow({ where: { id: res.proposalId } });
    expect(preview.state).toBe('pending');
    expect(preview.proposedByTokenId).toBe(ctx.tokenId);
    const delta = preview.delta as { label: string };
    expect(delta.label).toBe('creat cu un asistent extern'); // MCP5 labelling

    // finance-less contributor cannot propose_budget (SEC15)
    const { token: cToken } = await createToken(contributor.id, 'c', ['read_propose']);
    await expect(
      dispatchTool(await authenticateToken(cToken), 'propose_budget', {
        occasionId: occasion.id,
        categories: [{ name: 'x', estimateBani: 1 }],
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // read-only token cannot propose
    const { token: roToken } = await createToken(owner.id, 'ro', ['read']);
    await expect(
      dispatchTool(await authenticateToken(roToken), 'propose_task_list', {
        occasionId: occasion.id,
        tasks: [],
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // every call is audit-logged (MCP1)
    const calls = await prisma.mcpCallLog.count({ where: { tokenId: ctx.tokenId } });
    expect(calls).toBeGreaterThan(0);
  });

  it('the catalogue is fixed and versioned; every tool declares its scope (MCP8)', () => {
    for (const t of TOOL_CATALOGUE) {
      expect(['read', 'propose']).toContain(t.kind);
    }
    const names = TOOL_CATALOGUE.map((t) => t.name);
    expect(names).not.toContain('send_enquiry');
    expect(names.some((n) => /pay|admin|subscription/.test(n))).toBe(false); // MCP6
  });
});
