import {
  authenticateToken,
  dispatchTool,
  ensureConsentShown,
  TOOL_CATALOGUE,
  type McpContext,
} from '@eventdesk/mcp';
import { assertSameOrigin } from '../lib/csrf';

// MCP8: the MCP server is served at app.eventdesk.ro/mcp over HTTPS as a stateless
// Streamable-HTTP (JSON-RPC 2.0) endpoint. Clients authenticate with the personal
// token as a Bearer credential; the server announces its protocol version and the
// fixed, versioned tool catalogue on initialize / tools/list. Every tool declares
// its scope (read | propose); propose tools return a proposal id, never an applied
// change (MCP3/SEC15). No admin, payment or other-account tools exist (MCP6).

const PROTOCOL_VERSION = '2025-06-18';

const INPUT_SCHEMAS: Record<string, unknown> = {
  get_occasion: {
    type: 'object',
    properties: { occasionId: { type: 'string' } },
    required: ['occasionId'],
  },
  list_tasks: {
    type: 'object',
    properties: { occasionId: { type: 'string' } },
    required: ['occasionId'],
  },
  get_budget_summary: {
    type: 'object',
    properties: { occasionId: { type: 'string' } },
    required: ['occasionId'],
  },
  get_rsvp_summary: {
    type: 'object',
    properties: { occasionId: { type: 'string' } },
    required: ['occasionId'],
  },
  propose_task_list: {
    type: 'object',
    properties: {
      occasionId: { type: 'string' },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string' }, dueAt: { type: 'string' } },
          required: ['title'],
        },
      },
    },
    required: ['occasionId', 'tasks'],
  },
  propose_budget: {
    type: 'object',
    properties: {
      occasionId: { type: 'string' },
      categories: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            estimateBani: { type: 'number' },
            note: { type: 'string' },
          },
          required: ['name', 'estimateBani'],
        },
      },
    },
    required: ['occasionId', 'categories'],
  },
  propose_invitation_text: {
    type: 'object',
    properties: { occasionId: { type: 'string' }, text: { type: 'string' } },
    required: ['occasionId', 'text'],
  },
};

function jsonRpc(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } });
}

export async function POST(request: Request) {
  assertSameOrigin(request);
  const auth = request.headers.get('authorization') ?? '';
  const rawToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!rawToken) return jsonRpcError(null, -32001, 'Bearer token required (MCP8)');

  let ctx: McpContext;
  try {
    ctx = await authenticateToken(rawToken);
  } catch {
    return jsonRpcError(null, -32001, 'Invalid, revoked or expired token');
  }

  // MCP4: the per-token consent warning is returned before the first use of each
  // token, naming the data classes that can leave to the user's chosen AI provider.
  if (!(await ensureConsentShown(ctx.tokenId))) {
    return jsonRpc(null, {
      consentWarning:
        'Connecting an external AI assistant means occasion data (tasks, budget summaries if you hold finance access, RSVP counts, space model, published catalogues) is sent to the AI provider you choose. EventDesk cannot control what that provider does with the data; EventDesk remains the controller of this disclosure. Disconnect the token at any time to end access at once.',
      dataClasses: [
        'occasion',
        'tasks',
        'budget summaries (finance grant only)',
        'RSVP counts',
        'space model',
        'published catalogues',
      ],
      action:
        'Call again with the same token to proceed after showing this warning to the user (MCP4).',
    });
  }

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }
  const { id = null, method, params = {} } = body;

  switch (method) {
    case 'initialize':
      return jsonRpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'eventdesk-ro', version: '0.1.0' },
        instructions:
          'EventDesk.ro MCP server. Read tools return only what your own access grants allow (MCP2). Propose tools create What-if proposals that you confirm in the app; they never apply changes (MCP3/SEC15).',
      });
    case 'ping':
      return jsonRpc(id, {});
    case 'notifications/initialized':
      return new Response(null, { status: 202 });
    case 'tools/list':
      return jsonRpc(id, {
        tools: TOOL_CATALOGUE.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: INPUT_SCHEMAS[t.name],
          annotations:
            t.kind === 'propose'
              ? { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
              : { readOnlyHint: true },
        })),
      });
    case 'tools/call': {
      const name = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (!TOOL_CATALOGUE.some((t) => t.name === name)) {
        return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
      }
      try {
        const result = await dispatchTool(ctx, name, args);
        return jsonRpc(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 1) }],
          isError: false,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return jsonRpc(id, { content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method ?? ''}`);
  }
}

export async function GET() {
  return Response.json(
    {
      error:
        'Use POST with a Bearer token; the protocol version and tool catalogue are announced on initialize (MCP8).',
    },
    { status: 405 }
  );
}
