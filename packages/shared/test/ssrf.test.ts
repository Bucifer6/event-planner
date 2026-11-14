import { describe, expect, it } from "vitest";
import { assertSafeUrl, guardedLookup, isBlockedAddress, safeFetch, SsrfError } from "../src/ssrf";

const resolvesTo =
  (...addresses: string[]) =>
  async () =>
    addresses;

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "2002:c0a8:101::1",
    "2001:db8::1",
    "::127.0.0.1",
    "[::1]",
    "not-an-ip",
  ])("blocks %s", (a) => expect(isBlockedAddress(a)).toBe(true));

  it.each([
    "1.1.1.1",
    "93.184.216.34",
    "172.32.0.1",
    "2606:4700:4700::1111",
    "::ffff:1.1.1.1",
    "2a00:1450:4001::1",
  ])("allows %s", (a) => expect(isBlockedAddress(a)).toBe(false));
});

describe("assertSafeUrl", () => {
  const pub = { resolver: resolvesTo("93.184.216.34") };

  it("allows public http/https URLs", async () => {
    await expect(assertSafeUrl("https://example.com/a?b=1", pub)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl("http://example.com", pub)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl("https://1.1.1.1/")).resolves.toBeInstanceOf(URL);
  });

  it.each([
    "ftp://example.com/x",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "gopher://example.com",
    "https://user:pw@example.com/",
    "https://example.com:8443/",
    "http://example.com:22/",
    "nonsense",
  ])("rejects %s", async (u) => {
    await expect(assertSafeUrl(u, pub)).rejects.toBeInstanceOf(SsrfError);
  });

  it.each([
    "http://127.0.0.1/",
    "http://localhost/",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://intranet/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fe80::1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://2130706433/", // decimal 127.0.0.1
    "http://0x7f.0.0.1/", // hex octet
    "http://017700000001/", // octal
    "http://127.1/",
    "http://0/",
    "http://10.0.0.5/",
    "http://192.168.0.1/",
  ])("rejects private target %s", async (u) => {
    await expect(assertSafeUrl(u, pub)).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects hosts that resolve to a private address, even alongside a public one", async () => {
    await expect(
      assertSafeUrl("https://evil.example/", { resolver: resolvesTo("10.0.0.1") }),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertSafeUrl("https://evil.example/", { resolver: resolvesTo("93.184.216.34", "::1") }),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertSafeUrl("https://nothing.example/", { resolver: resolvesTo() }),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertSafeUrl("https://broken.example/", {
        resolver: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("allows an extra port only when asked", async () => {
    await expect(
      assertSafeUrl("https://example.com:8443/", { ...pub, allowedPorts: [443, 8443] }),
    ).resolves.toBeInstanceOf(URL);
  });
});

describe("safeFetch", () => {
  it("refuses loopback and metadata targets before connecting", async () => {
    await expect(safeFetch("http://127.0.0.1:80/")).rejects.toBeInstanceOf(SsrfError);
    await expect(safeFetch("http://169.254.169.254/")).rejects.toBeInstanceOf(SsrfError);
  });

  it("refuses at connect time when DNS answers with a private address (rebinding)", async () => {
    // guardedLookup is the lookup the socket uses: whatever the pre-check saw, a name that
    // resolves to loopback at connect time is refused.
    const result = await new Promise<{ err: unknown; address: unknown }>((resolve) => {
      guardedLookup("localhost", {}, (err, address) => resolve({ err, address }));
    });
    expect(result.err).toBeInstanceOf(SsrfError);
    expect(result.address).toBe("");
  });
});
