import { lookup as dnsLookup } from "node:dns";
import { lookup as dnsLookupAsync } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

// SSRF guard for every server-side fetch of a user- or web-supplied URL (SEC6).
// - http/https only, no credentials in the URL, ports 80/443 unless explicitly allowed
// - private, loopback, link-local, CGNAT, multicast, reserved and documentation ranges blocked
//   for IPv4 and IPv6 (including IPv4 embedded in IPv6)
// - safeFetch validates the address the socket actually connects to (custom DNS lookup), so a
//   DNS answer that changes between check and connect (rebinding) cannot slip through
// - redirects are followed manually and re-validated; response size and total time are capped

export class SsrfError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Blocked URL: ${reason}`);
    this.name = "SsrfError";
    this.reason = reason;
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments incl. Teredo
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

function expandIpv6(addr: string): number[] | null {
  let a = addr.split("%")[0] ?? "";
  // trailing dotted IPv4 -> two hex groups
  const v4 = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const hi = ((Number(v4[2]) << 8) | Number(v4[3])).toString(16);
    const lo = ((Number(v4[4]) << 8) | Number(v4[5])).toString(16);
    a = `${v4[1]}${hi}:${lo}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff))
    return null;
  return groups;
}

function embeddedIpv4(g: number[], at: number): string {
  const hi = g[at] ?? 0;
  const lo = g[at + 1] ?? 0;
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** True when the address must never be fetched from the server. Unparseable input is blocked. */
export function isBlockedAddress(address: string): boolean {
  const addr = address.replace(/^\[|\]$/g, "");
  const family = isIP(addr);
  if (family === 4) return blocked.check(addr, "ipv4");
  if (family !== 6) return true;
  if (blocked.check(addr, "ipv6")) return true;
  const g = expandIpv6(addr);
  if (!g) return true;
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  // IPv4-mapped ::ffff:a.b.c.d and deprecated IPv4-compatible ::a.b.c.d
  if (zeros(5) && g[5] === 0xffff) return blocked.check(embeddedIpv4(g, 6), "ipv4");
  if (zeros(6)) return true;
  // NAT64 64:ff9b::/96 and 6to4 2002::/16 embed an IPv4 address
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return blocked.check(embeddedIpv4(g, 6), "ipv4");
  }
  if (g[0] === 0x2002) return blocked.check(embeddedIpv4(g, 1), "ipv4");
  return false;
}

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) => {
  const all = await dnsLookupAsync(hostname, { all: true, verbatim: true });
  return all.map((a) => a.address);
};

export type SafeUrlOptions = {
  /** Allowed destination ports. Default [80, 443]. */
  allowedPorts?: readonly number[];
  /** DNS resolver (injectable for tests). Default: system resolver, all addresses. */
  resolver?: Resolver;
};

/**
 * Validates a URL for server-side fetching and returns the parsed URL.
 * Throws SsrfError if the scheme, port, host or ANY resolved address is not allowed.
 */
export async function assertSafeUrl(input: string | URL, opts: SafeUrlOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(String(input));
  } catch {
    throw new SsrfError("not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new SsrfError("scheme not allowed");
  if (url.username !== "" || url.password !== "") throw new SsrfError("credentials in URL");
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (!(opts.allowedPorts ?? [80, 443]).includes(port)) throw new SsrfError("port not allowed");

  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (host === "") throw new SsrfError("empty host");
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) throw new SsrfError("address not allowed");
    return url;
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".")
  ) {
    throw new SsrfError("host not allowed");
  }
  let addresses: string[];
  try {
    addresses = await (opts.resolver ?? defaultResolver)(host);
  } catch {
    throw new SsrfError("host does not resolve");
  }
  if (addresses.length === 0) throw new SsrfError("host does not resolve");
  if (addresses.some(isBlockedAddress)) throw new SsrfError("address not allowed");
  return url;
}

/** DNS lookup for http(s).request that refuses blocked addresses at connect time. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(
        Object.assign(new SsrfError("address not allowed"), { code: "ESSRF" }),
        "",
        0,
      );
    }
    if (options.all) return callback(null, list as never, 0);
    const first = list[0]!;
    callback(null, first.address, first.family);
  });
};

export type SafeFetchOptions = SafeUrlOptions & {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  /** Total time budget in ms, redirects included. Default 10 000. */
  timeoutMs?: number;
  /** Maximum response body in bytes. Default 2 MiB. Larger bodies reject. */
  maxBytes?: number;
  /** Maximum redirects followed (each re-validated). Default 3. */
  maxRedirects?: number;
};

export type SafeFetchResult = {
  /** Final URL after redirects */
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

/**
 * GET/HEAD a URL with the SSRF guard, a size cap and a time cap. No cookies, no credentials,
 * redirects only to URLs that pass the same guard.
 */
export async function safeFetch(
  input: string | URL,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  const deadline = Date.now() + timeoutMs;
  let current = String(input);

  for (let hop = 0; ; hop++) {
    const url = await assertSafeUrl(current, opts);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SsrfError("timed out");
    const res = await requestOnce(url, opts, remaining, maxBytes);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) throw new SsrfError("too many redirects");
      current = new URL(location, url).toString();
      continue;
    }
    return { ...res, url: url.toString() };
  }
}

function requestOnce(
  url: URL,
  opts: SafeFetchOptions,
  timeoutMs: number,
  maxBytes: number,
): Promise<Omit<SafeFetchResult, "url">> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = lib.request(
      url,
      {
        method: opts.method ?? "GET",
        headers: { accept: "*/*", "user-agent": "EventDeskBot/1.0", ...opts.headers },
        lookup: guardedLookup,
        agent: false,
      },
      (res) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
        }
        const declared = Number(headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBytes) {
          req.destroy();
          return finish(() => reject(new SsrfError("response too large")));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            finish(() => reject(new SsrfError("response too large")));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          finish(() =>
            resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks) }),
          ),
        );
        res.on("error", (e) => finish(() => reject(e)));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(() => reject(new SsrfError("timed out")));
    }, timeoutMs);
    req.on("error", (e) => finish(() => reject(e)));
    req.end();
  });
}
