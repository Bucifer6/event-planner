import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Malware scan before a file becomes visible (SEC4). The scanner product is an operator
// decision; this is the seam:
//
//   MALWARE_SCANNER=none|dev   development scanner: flags only the EICAR test string.
//                              REFUSED in production (uploads fail until a scanner is set).
//   MALWARE_SCANNER=command    MALWARE_SCANNER_COMMAND is run with the file path appended;
//                              exit 0 = clean, exit 1 = infected, anything else = scanner error
//   MALWARE_SCANNER=http       the bytes are POSTed (application/octet-stream) to
//                              MALWARE_SCANNER_URL; it answers JSON { "infected": boolean }
//
// A scanner error never lets a file through: the upload fails and nothing becomes visible.

export type ScanVerdict = "clean" | "infected";
export type Scanner = { name: string; scan(bytes: Buffer): Promise<ScanVerdict> };

export class ScannerUnavailableError extends Error {
  constructor(reason: string) {
    super(`Malware scanner unavailable: ${reason}`);
    this.name = "ScannerUnavailableError";
  }
}

/** The standard anti-malware test file (harmless), split so this source is not flagged. */
export const EICAR_TEST_STRING =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export const devScanner: Scanner = {
  name: "dev",
  async scan(bytes) {
    return bytes.includes(EICAR_TEST_STRING, 0, "latin1") ? "infected" : "clean";
  },
};

export function commandScanner(command: string, timeoutMs = 60_000): Scanner {
  return {
    name: "command",
    async scan(bytes) {
      const dir = await mkdtemp(join(tmpdir(), "ed-scan-"));
      const file = join(dir, "upload.bin");
      try {
        await writeFile(file, bytes, { mode: 0o600 });
        const code = await new Promise<number | null>((resolve) => {
          const child = spawn(`${command} "${file}"`, { shell: true, stdio: "ignore" });
          const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
          child.on("error", () => {
            clearTimeout(timer);
            resolve(null);
          });
          child.on("exit", (c) => {
            clearTimeout(timer);
            resolve(c);
          });
        });
        if (code === 0) return "clean";
        if (code === 1) return "infected";
        throw new ScannerUnavailableError("command failed");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

export function httpScanner(url: string, timeoutMs = 60_000): Scanner {
  return {
    name: "http",
    async scan(bytes) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: new Uint8Array(bytes),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new ScannerUnavailableError("request failed");
      }
      if (!res.ok) throw new ScannerUnavailableError(`status ${res.status}`);
      const body = (await res.json().catch(() => null)) as { infected?: unknown } | null;
      if (typeof body?.infected !== "boolean") throw new ScannerUnavailableError("bad answer");
      return body.infected ? "infected" : "clean";
    },
  };
}

function isRealProduction(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV !== "production") return false;
  try {
    const host = new URL(env.APP_URL ?? "").hostname;
    return !(host === "localhost" || host === "127.0.0.1" || host === "[::1]");
  } catch {
    return true;
  }
}

let override: Scanner | null = null;
/** Replace the scanner (tests). */
export function setScanner(scanner: Scanner | null): void {
  override = scanner;
}

export function getScanner(env: NodeJS.ProcessEnv = process.env): Scanner {
  if (override) return override;
  const kind = (env.MALWARE_SCANNER ?? "none").trim().toLowerCase();
  if (kind === "command") {
    const command = env.MALWARE_SCANNER_COMMAND?.trim();
    if (!command) throw new ScannerUnavailableError("MALWARE_SCANNER_COMMAND is not set");
    return commandScanner(command);
  }
  if (kind === "http") {
    const url = env.MALWARE_SCANNER_URL?.trim();
    if (!url) throw new ScannerUnavailableError("MALWARE_SCANNER_URL is not set");
    return httpScanner(url);
  }
  if (kind === "none" || kind === "dev" || kind === "") {
    if (isRealProduction(env)) throw new ScannerUnavailableError("MALWARE_SCANNER is not configured");
    return devScanner;
  }
  throw new ScannerUnavailableError("unknown MALWARE_SCANNER value");
}
