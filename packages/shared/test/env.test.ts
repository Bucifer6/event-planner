import { describe, expect, it } from "vitest";
import { assertBootEnv, EnvError } from "../src/env";

const good = {
  DATABASE_URL: "postgresql://u:supersecretpw@db.example:5432/app",
  APP_URL: "https://app.example.ro",
  PUBLIC_URL: "https://example.ro",
  MEDIA_URL: "https://media.example.ro",
  SESSION_SECRET: "s".repeat(40),
  EMAIL_PROVIDER: "someprovider",
};

function failure(env: Record<string, string | undefined>): EnvError {
  try {
    assertBootEnv(env);
  } catch (e) {
    if (e instanceof EnvError) return e;
    throw e;
  }
  throw new Error("expected EnvError");
}

describe("assertBootEnv", () => {
  it("accepts a valid env and applies defaults", () => {
    const env = assertBootEnv({ ...good, EMAIL_PROVIDER: "", S3_ENDPOINT: "" });
    expect(env.NODE_ENV).toBe("development");
    expect(env.EMAIL_PROVIDER).toBe("dev");
    expect(env.S3_ENDPOINT).toBeUndefined();
  });

  it("lists every missing name", () => {
    const e = failure({});
    expect(e.names).toEqual([
      "APP_URL",
      "DATABASE_URL",
      "MEDIA_URL",
      "PUBLIC_URL",
      "SESSION_SECRET",
    ]);
  });

  it("never includes values in the error (SEC13)", () => {
    const e = failure({
      ...good,
      DATABASE_URL: "mysql://u:supersecretpw@db/app",
      SESSION_SECRET: "tooshortsecret",
      APP_URL: "not a url with hunter2",
    });
    expect(e.names).toEqual(["APP_URL", "DATABASE_URL", "SESSION_SECRET"]);
    const text = `${e.message} ${JSON.stringify(e)} ${String(e.stack)}`;
    for (const secret of ["supersecretpw", "tooshortsecret", "hunter2"])
      expect(text).not.toContain(secret);
  });

  it("production refuses the dev email provider, non-https URLs and media on the app origin", () => {
    expect(failure({ ...good, NODE_ENV: "production", EMAIL_PROVIDER: "dev" }).names).toEqual([
      "EMAIL_PROVIDER",
    ]);
    expect(
      failure({ ...good, NODE_ENV: "production", APP_URL: "http://app.example.ro" }).names,
    ).toEqual(["APP_URL"]);
    expect(
      failure({ ...good, NODE_ENV: "production", MEDIA_URL: "https://app.example.ro/media" }).names,
    ).toEqual(["MEDIA_URL"]);
    expect(assertBootEnv({ ...good, NODE_ENV: "production" }).NODE_ENV).toBe("production");
    // a production build run locally (smoke/e2e) is allowed its http://localhost URLs
    expect(
      assertBootEnv({
        ...good,
        NODE_ENV: "production",
        APP_URL: "http://localhost:3000",
        PUBLIC_URL: "http://localhost:3001",
        MEDIA_URL: "http://localhost:3002",
        EMAIL_PROVIDER: "dev",
      }).EMAIL_PROVIDER,
    ).toBe("dev");
  });
});
