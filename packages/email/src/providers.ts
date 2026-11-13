// Email providers (INF2). Which vendor delivers production mail is an OPERATOR DECISION
// (docs/build/10-operator-decisions.md): EMAIL_PROVIDER names it. Nothing here guesses one.
//
//   EMAIL_PROVIDER=dev   (default) nothing leaves the machine; sendEmail keeps the rendered
//                        message in the email_outbox table, where a developer reads the code.
//   EMAIL_PROVIDER=http  PLACEHOLDER seam: a generic JSON POST to EMAIL_PROVIDER_URL with
//                        "Authorization: Bearer EMAIL_PROVIDER_API_KEY". Once the operator
//                        picks a vendor (EU delivery), either point this at a small adapter
//                        or register a real provider with registerEmailProvider().

export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Template name, for provider-side tagging. Never contains personal data. */
  template: string;
};

export type EmailProvider = {
  name: string;
  /** True only for the dev transport: sendEmail then stores the body in email_outbox. */
  keepsBodyInOutbox: boolean;
  send: (message: EmailMessage) => Promise<{ messageId?: string }>;
};

export type EmailProviderFactory = (env: Record<string, string | undefined>) => EmailProvider;

const globalRegistry = globalThis as unknown as {
  __edEmailProviders?: Map<string, EmailProviderFactory>;
};
const factories = (globalRegistry.__edEmailProviders ??= new Map());

export function registerEmailProvider(name: string, factory: EmailProviderFactory): void {
  factories.set(name, factory);
}

const devProvider: EmailProviderFactory = () => ({
  name: "dev",
  keepsBodyInOutbox: true,
  send: async () => ({}),
});

const httpProvider: EmailProviderFactory = (env) => {
  const url = env.EMAIL_PROVIDER_URL;
  const key = env.EMAIL_PROVIDER_API_KEY;
  return {
    name: "http",
    keepsBodyInOutbox: false,
    async send(message) {
      if (!url || !key) {
        throw new Error("Email provider is not configured: EMAIL_PROVIDER_URL, EMAIL_PROVIDER_API_KEY");
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Email provider answered ${res.status}`);
      const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
      return { messageId: typeof body?.id === "string" ? body.id : undefined };
    },
  };
};

if (!factories.has("dev")) registerEmailProvider("dev", devProvider);
if (!factories.has("http")) registerEmailProvider("http", httpProvider);

/** The provider named by EMAIL_PROVIDER (default "dev"). Throws for an unregistered name. */
export function getEmailProvider(
  env: Record<string, string | undefined> = process.env,
): EmailProvider {
  const name = env.EMAIL_PROVIDER || "dev";
  const factory = factories.get(name);
  if (!factory) throw new Error(`Unknown EMAIL_PROVIDER "${name}"`);
  return factory(env);
}

export function emailFrom(env: Record<string, string | undefined> = process.env): string {
  return env.EMAIL_FROM || "EventDesk <no-reply@localhost>";
}
