import { registerTemplate } from "./templates";

// Account emails (S1, S4, SEC1, SEC14). Wording lives in the `emails` i18n namespace.

export type SignInEmailParams = { code: string; linkUrl: string; minutes: number };

/** Sign-in: the six-digit code plus the one-tap link, with the SEC1 wording. */
registerTemplate<SignInEmailParams>("auth.signIn", (p, { t }) => ({
  subject: t("emails.signIn.subject"),
  blocks: [
    { kind: "text", text: t("emails.signIn.intro") },
    { kind: "code", code: p.code },
    { kind: "note", text: t("emails.signIn.validity", { minutes: p.minutes }) },
    { kind: "button", label: t("emails.signIn.linkLabel"), url: p.linkUrl },
    { kind: "note", text: t("emails.signIn.linkNote") },
    { kind: "note", text: t("emails.security.staffNeverAsk") },
    { kind: "note", text: t("emails.security.notRequested") },
  ],
}));

export type CodeEmailParams = { code: string; minutes: number };

/** S4: fresh code before a sensitive action. */
registerTemplate<CodeEmailParams>("auth.confirm", (p, { t }) => ({
  subject: t("emails.confirm.subject"),
  blocks: [
    { kind: "text", text: t("emails.confirm.intro") },
    { kind: "code", code: p.code },
    { kind: "note", text: t("emails.confirm.validity", { minutes: p.minutes }) },
    { kind: "note", text: t("emails.security.staffNeverAsk") },
    { kind: "note", text: t("emails.security.notRequestedAction") },
  ],
}));

/** Adding or changing the login email: the code goes to the NEW address. */
registerTemplate<CodeEmailParams>("auth.newEmail", (p, { t }) => ({
  subject: t("emails.newEmail.subject"),
  blocks: [
    { kind: "text", text: t("emails.newEmail.intro") },
    { kind: "code", code: p.code },
    { kind: "note", text: t("emails.newEmail.validity", { minutes: p.minutes }) },
    { kind: "note", text: t("emails.security.staffNeverAsk") },
    { kind: "note", text: t("emails.newEmail.notRequested") },
  ],
}));
