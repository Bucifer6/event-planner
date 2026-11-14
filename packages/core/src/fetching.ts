import { safeFetch, SsrfError, type SafeFetchResult } from "@ed/shared/ssrf";

// robots.txt for background fetches (SEC6, discovery BD1). Use together with the SSRF guard:
//
//   if (!(await fetchRobotsAllowed(url, DISCOVERY_USER_AGENT))) return;   // honour robots.txt
//   const page = await safeFetch(url, { headers: { "user-agent": DISCOVERY_USER_AGENT } });
//
// Rules follow RFC 9309: the most specific user-agent group applies, the longest matching
// Allow/Disallow path wins (Allow on a tie), `*` and `$` are understood. robots.txt missing
// (4xx) = allowed; unreachable, 5xx, 429 or blocked by the SSRF guard = NOT allowed.

export const DISCOVERY_USER_AGENT = "EventDeskBot/1.0";

export type RobotsFetcher = (
  url: string,
) => Promise<Pick<SafeFetchResult, "status" | "body"> | { status: number; body: Buffer | string }>;

export type RobotsOptions = {
  /** Injectable for tests. Default: safeFetch (SSRF-guarded, 256 KiB, 5 s). */
  fetcher?: RobotsFetcher;
};

type Rule = { allow: boolean; path: string };
type Group = { agents: string[]; rules: Rule[] };

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/).slice(0, 5000)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      lastWasAgent = false;
      if (current && value !== "") current.rules.push({ allow: field === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function productToken(userAgent: string): string {
  return (/^[A-Za-z_-]+/.exec(userAgent.trim())?.[0] ?? "").toLowerCase();
}

function pathMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${re}${anchored ? "$" : ""}`).test(path);
}

/** Pure decision from robots.txt text. */
export function isAllowedByRobots(robotsTxt: string, url: string | URL, userAgent: string): boolean {
  const u = new URL(String(url));
  const path = `${u.pathname}${u.search}`;
  if (u.pathname === "/robots.txt") return true;
  const token = productToken(userAgent);
  const groups = parseRobots(robotsTxt);
  // all groups naming our token are merged; otherwise the "*" groups apply
  let chosen = groups.filter((g) => token !== "" && g.agents.some((a) => a !== "*" && a === token));
  if (chosen.length === 0) chosen = groups.filter((g) => g.agents.includes("*"));
  let best: Rule | null = null;
  for (const rule of chosen.flatMap((g) => g.rules)) {
    if (!pathMatches(rule.path, path)) continue;
    if (
      !best ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

const defaultFetcher: RobotsFetcher = (url) =>
  safeFetch(url, {
    timeoutMs: 5000,
    maxBytes: 256 * 1024,
    headers: { "user-agent": DISCOVERY_USER_AGENT },
  });

/**
 * Fetches the site's robots.txt and says whether `userAgent` may fetch `url`.
 * Never throws: anything unexpected means "not allowed".
 */
export async function fetchRobotsAllowed(
  url: string | URL,
  userAgent: string = DISCOVERY_USER_AGENT,
  opts: RobotsOptions = {},
): Promise<boolean> {
  let target: URL;
  try {
    target = new URL(String(url));
  } catch {
    return false;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return false;
  try {
    const res = await (opts.fetcher ?? defaultFetcher)(`${target.origin}/robots.txt`);
    if (res.status === 429 || res.status >= 500) return false;
    if (res.status >= 400) return true;
    if (res.status < 200 || res.status >= 300) return false;
    const text = typeof res.body === "string" ? res.body : res.body.toString("utf8");
    return isAllowedByRobots(text, target, userAgent);
  } catch (e) {
    if (e instanceof SsrfError) return false;
    return false;
  }
}
