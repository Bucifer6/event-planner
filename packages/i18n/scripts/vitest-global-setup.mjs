// Keeps src/messages.generated.ts in step with messages/**.json before any test run that
// includes a project depending on the message map.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export default function setup() {
  execFileSync(process.execPath, [
    join(dirname(fileURLToPath(import.meta.url)), "gen-messages.mjs"),
  ]);
}
