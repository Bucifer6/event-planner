import { listJobs, listSchedules } from "@ed/jobs";
import { registerAllJobs } from "@ed/jobs/registry";
import { describe, expect, it } from "vitest";

describe("jobs registry wiring", () => {
  it("registers the auth clean-up, account purge and MCP expiry jobs with daily schedules", () => {
    registerAllJobs();
    expect(listJobs()).toEqual(expect.arrayContaining(["auth.purge-expired", "accounts.purge-due", "mcp.expire-inactive"]));
    const schedules = listSchedules().map((s) => `${s.job}:${s.every.kind}`);
    expect(schedules).toEqual(
      expect.arrayContaining(["auth.purge-expired:daily", "accounts.purge-due:daily", "mcp.expire-inactive:daily"]),
    );
  });
});
