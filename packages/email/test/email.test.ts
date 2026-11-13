import { anonymousCtx, systemCtx } from "@ed/core/context";
import { emailDailyCounters, emailOutbox, emailSuppressions, eq } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, type AppError } from "@ed/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  applyEmailEvents,
  DAILY_EMAIL_CAP_PER_OCCASION,
  registerEmailProvider,
  registerTemplate,
  renderEmail,
  sendEmail,
} from "../src/index";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});
afterEach(() => {
  delete process.env.EMAIL_PROVIDER;
});

const now = new Date("2026-05-10T09:00:00.000Z");
const signIn = { code: "004217", linkUrl: "https://app.example/sign-in/link/tok", minutes: 15 };

describe("templates (L5, SEC1)", () => {
  it("sign-in email is bilingual, Romanian first, with the SEC1 wording in both languages", () => {
    const r = renderEmail("auth.signIn", signIn);
    expect(r.subject).toBe("Codul tău de intrare în EventDesk / Your EventDesk sign-in code");
    const ro = r.text.indexOf("Echipa EventDesk nu îți va cere niciodată acest cod");
    const en = r.text.indexOf("EventDesk staff will never ask you for this code");
    expect(ro).toBeGreaterThan(-1);
    expect(en).toBeGreaterThan(ro);
    expect(r.text).toContain("cineva îți încearcă adresa de email");
    expect(r.text).toContain("someone is probing your email address");
    expect(r.text.match(/004217/g)).toHaveLength(2);
    expect(r.text).toContain(signIn.linkUrl);
    expect(r.html).toContain('<div lang="ro">');
    expect(r.html).toContain('<div lang="en">');
    // no external assets, no script
    expect(r.html).not.toMatch(/<img|<script|<link|url\(/i);
    expect(r.text).not.toMatch(/emails\.[a-zA-Z]+\./);
  });

  it("escapes template values in HTML and lets other packages register templates", () => {
    registerTemplate<{ name: string }>("test.hello", (p, { locale }) => ({
      subject: locale === "ro" ? "Salut" : "Hello",
      blocks: [
        { kind: "text", text: `<b>${p.name}</b>` },
        { kind: "button", label: "Go", url: "javascript:alert(1)" },
      ],
    }));
    const r = renderEmail("test.hello", { name: "Ana & Co" });
    expect(r.html).toContain("&lt;b&gt;Ana &amp; Co&lt;/b&gt;");
    expect(r.html).not.toContain("javascript:");
    expect(renderEmail("test.hello", { name: "x" }, { locale: "en", bilingual: false }).subject).toBe("Hello");
  });
});

describe("sendEmail", () => {
  it("dev transport writes the rendered message to the outbox", async () => {
    const ctx = anonymousCtx(t.db, { now });
    const res = await sendEmail(ctx, { to: " Ana@Example.ro ", template: "auth.signIn", params: signIn, locale: "ro" });
    expect(res.status).toBe("sent");
    const [row] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, res.outboxId));
    expect(row).toMatchObject({ toEmail: "ana@example.ro", template: "auth.signIn", provider: "dev", status: "sent" });
    expect(row?.bodyText).toContain("004217");
  });

  it("a real provider gets the message and the outbox keeps no body (SEC8)", async () => {
    const sent: Array<{ to: string; text: string }> = [];
    registerEmailProvider("test-vendor", () => ({
      name: "test-vendor",
      keepsBodyInOutbox: false,
      send: async (m) => {
        sent.push(m);
        return { messageId: "m-1" };
      },
    }));
    process.env.EMAIL_PROVIDER = "test-vendor";
    const res = await sendEmail(anonymousCtx(t.db, { now }), { to: "bob@example.ro", template: "auth.signIn", params: signIn });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("004217");
    const [row] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.id, res.outboxId));
    expect(row).toMatchObject({ provider: "test-vendor", status: "sent", bodyText: null, bodyHtml: null, providerMessageId: "m-1" });
  });

  it("a hard-bounced or complained address is never sent to again", async () => {
    const sent: string[] = [];
    registerEmailProvider("spy", () => ({ name: "spy", keepsBodyInOutbox: false, send: async (m) => (sent.push(m.to), {}) }));
    process.env.EMAIL_PROVIDER = "spy";
    const sys = systemCtx(t.db, { now });
    const n = await applyEmailEvents(sys, {
      events: [
        { type: "bounce", email: "Gone@Example.ro" },
        { type: "bounce", email: "soft@example.ro", permanent: false },
        { type: "complaint", email: "angry@example.ro" },
        { type: "delivered", email: "fine@example.ro" },
        { type: "bounce", email: "gone@example.ro" },
      ],
    });
    expect(n).toBe(3);
    expect(await t.db.select().from(emailSuppressions)).toHaveLength(2);
    expect(JSON.stringify(await t.db.select().from(emailSuppressions))).not.toContain("example.ro");

    const ctx = anonymousCtx(t.db, { now });
    for (const to of ["gone@example.ro", "angry@example.ro"]) {
      const res = await sendEmail(ctx, { to, template: "auth.signIn", params: signIn });
      expect(res.status).toBe("suppressed");
    }
    expect((await sendEmail(ctx, { to: "soft@example.ro", template: "auth.signIn", params: signIn })).status).toBe("sent");
    expect(sent).toEqual(["soft@example.ro"]);
    // only the system (webhook/worker) may change the list
    await expect(applyEmailEvents(ctx, { events: [] })).rejects.toThrow();
  });

  it("Q6: the 501st email of the day for one occasion is refused before the provider", async () => {
    let sent = 0;
    registerEmailProvider("counter", () => ({ name: "counter", keepsBodyInOutbox: false, send: async () => (sent++, {}) }));
    process.env.EMAIL_PROVIDER = "counter";
    const ctx = anonymousCtx(t.db, { now });
    await t.db.insert(emailDailyCounters).values({ occasionId: "occ_cap", day: "2026-05-10", count: DAILY_EMAIL_CAP_PER_OCCASION - 1 });
    await sendEmail(ctx, { to: "g1@example.ro", template: "auth.signIn", params: signIn, occasionId: "occ_cap" });
    expect(sent).toBe(1);
    let err: unknown;
    try {
      await sendEmail(ctx, { to: "g2@example.ro", template: "auth.signIn", params: signIn, occasionId: "occ_cap" });
    } catch (e) {
      err = e;
    }
    expect(isAppError(err)).toBe(true);
    expect((err as AppError).code).toBe("LIMIT");
    expect((err as AppError).messageKey).toBe("emails.errors.dailyCap");
    expect(sent).toBe(1);
    const capped = await t.db.select().from(emailOutbox).where(eq(emailOutbox.status, "capped"));
    expect(capped).toHaveLength(1);
    // another occasion, the next Bucharest day, and non-occasion mail are unaffected
    await sendEmail(ctx, { to: "g2@example.ro", template: "auth.signIn", params: signIn, occasionId: "occ_other" });
    await sendEmail(anonymousCtx(t.db, { now: new Date("2026-05-10T21:30:00.000Z") }), {
      to: "g2@example.ro",
      template: "auth.signIn",
      params: signIn,
      occasionId: "occ_cap",
    });
    await sendEmail(ctx, { to: "g2@example.ro", template: "auth.signIn", params: signIn });
    expect(sent).toBe(4);
  });

  it("unknown provider or template fails loudly", async () => {
    const ctx = anonymousCtx(t.db, { now });
    await expect(sendEmail(ctx, { to: "a@example.ro", template: "nope", params: {} })).rejects.toThrow(/template/);
    process.env.EMAIL_PROVIDER = "some-vendor-nobody-chose";
    await expect(sendEmail(ctx, { to: "a@example.ro", template: "auth.signIn", params: signIn })).rejects.toThrow(/EMAIL_PROVIDER/);
  });
});
