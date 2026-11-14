import { describe, expect, it } from "vitest";
import { AppError, describeError } from "../src/errors";

// Security review 14 Nov 2026, F-03: what reaches a log line or jobs.last_error must say what
// failed, never the values involved.

/** The shape drizzle-orm gives a failed statement (message = SQL + parameter values). */
function queryError(): Error {
  const cause = Object.assign(new Error('duplicate key value violates unique constraint "accounts_email_key"'), {
    code: "23505",
    severity: "ERROR",
    constraint: "accounts_email_key",
    table: "accounts",
    detail: "Key (email)=(ana.popescu@example.ro) already exists.",
  });
  const query = 'insert into "accounts" ("id", "email", "display_name") values ($1, $2, $3)';
  const params = ["acc_1", "ana.popescu@example.ro", "Ana Popescu — fără gluten"];
  const e = new Error(`Failed query: ${query}\nparams: ${params}`) as Error & { query: string; params: unknown[]; cause: unknown };
  e.name = "DrizzleQueryError";
  e.query = query;
  e.params = params;
  e.cause = cause;
  return e;
}

describe("describeError", () => {
  it("reports a failed query by its SQL and PostgreSQL code — never its parameter values", () => {
    const text = describeError(queryError(), { frames: true });
    expect(text).toContain('insert into "accounts"');
    expect(text).toContain("pg 23505 constraint=accounts_email_key table=accounts");
    for (const secret of ["ana.popescu", "example.ro", "Ana Popescu", "gluten", "acc_1", "params"]) expect(text).not.toContain(secret);
    expect(text).toMatch(/\n {2}at /); // call sites are kept
  });

  it("drops a quoted value in a bare PostgreSQL error and a params tail in a wrapped message", () => {
    const pg = Object.assign(new Error('invalid input syntax for type integer: "4111 1111 1111 1111"'), { code: "22P02", severity: "ERROR" });
    expect(describeError(pg)).toBe("Error: database error — pg 22P02");
    const wrapped = new Error("job failed: Failed query: select 1 params: secret-token-value");
    expect(describeError(wrapped)).not.toContain("secret-token-value");
  });

  it("keeps ordinary messages short, names AppErrors by code and key, and survives non-errors", () => {
    expect(describeError(new TypeError("x is not a function"))).toBe("TypeError: x is not a function");
    expect(describeError(new AppError("FORBIDDEN", "common.errors.FORBIDDEN", { params: { who: "ana@example.ro" } }))).toBe("AppError: FORBIDDEN common.errors.FORBIDDEN");
    expect(describeError("a string someone threw: ana@example.ro")).toBe("Error: string");
    expect(describeError(null)).toBe("Error: object");
    expect(describeError(new Error("m".repeat(5000))).length).toBeLessThanOrEqual(500);
    expect(describeError(new Error("boom"))).not.toMatch(/\n/);
  });
});
