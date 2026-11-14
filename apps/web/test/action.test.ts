import { accountCtx, anonymousCtx, type Ctx } from "@ed/core/context";
import type { Db } from "@ed/db";
import { hasMessage, translate } from "@ed/i18n/load";
import { AppError } from "@ed/shared/errors";
import { zEmail, zText } from "@ed/shared/zod";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { formDataToObject, runAction, type Translator } from "../lib/action-core";

const tr = (locale: string): Translator => ({
  t: (key, params) => translate(locale, key, params),
  has: (key) => hasMessage(locale, key),
});
const db = {} as Db; // never touched by these tests
const signedIn = async (): Promise<Ctx> => accountCtx(db, "acc_1");
const nobody = async (): Promise<Ctx> => anonymousCtx(db);

const schema = z.object({ title: zText(10), email: zEmail });

describe("runAction", () => {
  it("returns ok + data and passes parsed input to the handler", async () => {
    const res = await runAction({
      schema,
      handler: async (ctx, input) => ({ who: ctx.actor.kind, ...input }),
      rawInput: { title: "  Nuntă ", email: " ANA@Example.ro " },
      getCtx: signedIn,
      translator: tr("ro"),
    });
    expect(res).toEqual({
      ok: true,
      data: { who: "account", title: "Nuntă", email: "ana@example.ro" },
    });
  });

  it("accepts FormData and maps zod errors to translated field errors, echoing typed input", async () => {
    const fd = new FormData();
    fd.set("title", "");
    fd.set("email", "not-an-email");
    fd.set("password", "hunter2");
    const handler = vi.fn();
    const res = await runAction({
      schema,
      handler,
      rawInput: fd,
      getCtx: signedIn,
      translator: tr("ro"),
    });
    expect(handler).not.toHaveBeenCalled();
    expect(res).toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "Verifică informațiile marcate și încearcă din nou.",
        fieldErrors: {
          title: ["Completează acest câmp."],
          email: ["Scrie o adresă de email validă."],
        },
        values: { title: "", email: "not-an-email" },
      },
    });
    const en = await runAction({
      schema,
      handler,
      rawInput: { title: "far too long a title", email: "a@b.ro" },
      getCtx: signedIn,
      translator: tr("en"),
    });
    expect(en.ok === false && en.error.fieldErrors).toEqual({ title: ["This text is too long."] });
    const missing = await runAction({
      schema,
      handler,
      rawInput: {},
      getCtx: signedIn,
      translator: tr("en"),
    });
    expect(missing.ok === false && missing.error.fieldErrors).toEqual({
      title: ["Fill in this field."],
      email: ["Fill in this field."],
    });
  });

  it("requires an account unless the action is public", async () => {
    const handler = vi.fn(async () => "done");
    const res = await runAction({
      schema: z.object({}),
      handler,
      rawInput: {},
      getCtx: nobody,
      translator: tr("en"),
    });
    expect(res).toEqual({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
    });
    expect(handler).not.toHaveBeenCalled();
    const open = await runAction({
      schema: z.object({}),
      handler,
      rawInput: {},
      getCtx: nobody,
      translator: tr("en"),
      options: { auth: "public" },
    });
    expect(open).toEqual({ ok: true, data: "done" });
  });

  it("maps AppError through its messageKey, with fallback, retryAt and field errors", async () => {
    const run = (e: unknown) =>
      runAction({
        schema: z.object({}),
        handler: async () => {
          throw e;
        },
        rawInput: {},
        getCtx: signedIn,
        translator: tr("ro"),
        log: () => {},
      });
    expect(await run(new AppError("NOT_FOUND", "common.errors.NOT_FOUND"))).toMatchObject({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Nu am găsit ce căutai. Este posibil să fi fost șters sau mutat.",
      },
    });
    expect(await run(new AppError("TAKEN", "nope.missing.key"))).toMatchObject({
      error: { code: "TAKEN", message: "Este deja ocupat. Alege altceva." },
    });
    expect(
      await run(new AppError("RATE_LIMITED", undefined, { retryAt: "2026-01-01T10:00:00.000Z" })),
    ).toMatchObject({ error: { code: "RATE_LIMITED", retryAt: "2026-01-01T10:00:00.000Z" } });
    expect(
      await run(
        new AppError("VALIDATION", undefined, {
          fieldErrors: { email: ["common.validation.invalidEmail"] },
        }),
      ),
    ).toMatchObject({
      error: { code: "VALIDATION", fieldErrors: { email: ["Scrie o adresă de email validă."] } },
    });
  });

  it("never leaks unexpected errors; logs them server-side", async () => {
    const log = vi.fn();
    const res = await runAction({
      schema: z.object({}),
      handler: async () => {
        throw new Error("connection to 10.0.0.5 failed: password=hunter2");
      },
      rawInput: {},
      getCtx: signedIn,
      translator: tr("en"),
      log,
    });
    expect(res.ok).toBe(false);
    const text = JSON.stringify(res);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("10.0.0.5");
    expect(text).not.toContain("stack");
    expect(res.ok === false && res.error.code).toBe("UNEXPECTED");
    expect(log).toHaveBeenCalledOnce();
  });

  it("lets framework control-flow errors through", async () => {
    const redirectSignal = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;/x",
    });
    await expect(
      runAction({
        schema: z.object({}),
        handler: async () => {
          throw redirectSignal;
        },
        rawInput: {},
        getCtx: signedIn,
        translator: tr("en"),
        rethrow: (e) => {
          if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
        },
      }),
    ).rejects.toBe(redirectSignal);
  });
});

describe("formDataToObject", () => {
  it("collects repeated names into arrays and drops React internals", () => {
    const fd = new FormData();
    fd.append("tag", "a");
    fd.append("tag", "b");
    fd.set("name", "x");
    fd.set("$ACTION_ID_abc", "");
    expect(formDataToObject(fd)).toEqual({ tag: ["a", "b"], name: "x" });
  });
});
