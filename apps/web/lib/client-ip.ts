import { isIP } from "node:net";

// The client address used for per-IP rate limits and the security log (SEC11, SEC16).
//
// It can only come from a header written by OUR ingress — never from one the client chose.
//   TRUSTED_IP_HEADER   the header the ingress sets (default x-forwarded-for). An empty value
//                       means "the default", not "a header with no name".
//   TRUSTED_PROXY_HOPS  for x-forwarded-for only: how many proxies WE run in front of the app
//                       (default 1). Each of them appends the address it saw, so the client is
//                       the entry that many places from the RIGHT. Anything further left was
//                       sent by the client itself and is never used: a visitor who types their
//                       own X-Forwarded-For cannot pick the address they are counted under.
// A value that is not an IP address is ignored (the request then has no IP axis).

const HEADER_NAME_RE = /^[a-z0-9-]{1,64}$/;
const DEFAULT_HEADER = "x-forwarded-for";

function cleanAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let v = value.trim();
  if (v.length === 0 || v.length > 64) return undefined;
  // "[2001:db8::1]:443" and "203.0.113.7:51234" (some proxies add the port)
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracketed) v = bracketed[1]!;
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  return isIP(v) ? v.toLowerCase() : undefined;
}

/** The client IP from the trusted header, or undefined. `get` reads one request header. */
export function clientIpFrom(
  get: (name: string) => string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const configured = (env.TRUSTED_IP_HEADER ?? "").trim().toLowerCase();
  const name = HEADER_NAME_RE.test(configured) ? configured : DEFAULT_HEADER;
  const raw = get(name);
  if (!raw) return undefined;
  const parts = raw.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) return undefined;
  if (name !== DEFAULT_HEADER) return cleanAddress(parts[parts.length - 1]);
  const configuredHops = Number(env.TRUSTED_PROXY_HOPS);
  const hops = Number.isInteger(configuredHops) && configuredHops >= 1 && configuredHops <= 10 ? configuredHops : 1;
  return cleanAddress(parts[Math.max(0, parts.length - hops)]);
}
