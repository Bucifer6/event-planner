import { getAiTextStatus } from "@ed/core/aitext";
import { getStarterWordings, getStationeryEditor, stationeryColourwayName, stationeryDesignName, getWordingPreset, previewStationery, STATIONERY_FIELD_LIMITS, STATIONERY_TEXT_FIELDS, STATIONERY_WORDING_KINDS } from "@ed/core/stationery";
import { colourwaysFor, COLOURWAYS, DESIGN_KEYS, DESIGN_RANGES, designAvailableFor, STATIONERY_DESIGNS, svgDataUri } from "@ed/core/stationerykit";
import { formatDate } from "@ed/i18n/format";
import { Card, Checkbox, EmptyState, LinkButton, List, Notice, PageHeader, Row, Section, Stack, Tag } from "@ed/ui";
import { IconDownload } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";
import { StationeryDesigner, type DesignerDraft, type DesignOption } from "./Designer";
import { DigitalToggle, MarkProofed } from "./ProofActions";
import styles from "./stationery.module.css";
import { HelpLink } from "@/components/help/HelpLink";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("stationery"))("title") };
}

/**
 * Invitation and stationery designer (C-04): design + wording with a live proof, versions,
 * the proof gate ("Am verificat proba") in front of the print-ready PDF, and the switch that
 * lets the guest link wear the same design. No animated envelope, no paid packs (PRD §3, §13).
 */
export default async function StationeryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const t = await getTranslations("stationery");
  const all = await getTranslations();
  const locale = (await getLocale()) === "en" ? "en" : "ro";
  const ed = await orNotFound(getStationeryEditor(ctx, id));
  const ai = await getAiTextStatus(ctx);

  const current = ed.current;
  const texts = current?.texts ?? ed.defaults.texts;
  const initial: DesignerDraft = {
    designKey: current?.designKey ?? ed.defaults.designKey,
    colourwayKey: current?.colourwayKey ?? ed.defaults.colourwayKey,
    locale: current?.locale ?? ed.defaults.locale,
    texts: Object.fromEntries(STATIONERY_TEXT_FIELDS.map((f) => [f, texts[f]?.value ?? ""])) as DesignerDraft["texts"],
    aiOriginal: Object.fromEntries(STATIONERY_TEXT_FIELDS.map((f) => [f, texts[f]?.aiGenerated ? (texts[f].aiOriginal ?? texts[f].value) : null])),
    qrOnInvitation: current?.qrOnInvitation ?? false,
  };
  const kind = ed.occasion.kind;
  const [first] = await previewStationery(ctx, { designKey: initial.designKey as never, colourwayKey: initial.colourwayKey, locale: initial.locale, texts: Object.fromEntries(Object.entries(initial.texts).map(([k, v]) => [k, { value: v }])), pieces: ["invitation"], occasionKind: kind });
  // the designs this occasion can use: everything shared, plus the templates made for its kind
  const designs: DesignOption[] = DESIGN_KEYS.filter((key) => designAvailableFor(STATIONERY_DESIGNS[key]!, kind)).map((key) => {
    const d = STATIONERY_DESIGNS[key]!;
    return {
      key,
      name: stationeryDesignName(key, locale),
      range: d.range,
      thumb: `/occasions/${id}/stationery/thumb?design=${encodeURIComponent(key)}`,
      colourways: colourwaysFor(d, kind).map((c) => ({ key: c, name: stationeryColourwayName(c, locale), paper: COLOURWAYS[c]!.paper, ink: COLOURWAYS[c]!.ink, accent: COLOURWAYS[c]!.accent })),
    };
  });
  const starters = { ro: getStarterWordings(kind, "ro"), en: getStarterWordings(kind, "en") };
  const presets = Object.fromEntries((["ro", "en"] as const).map((l) => [l, Object.fromEntries(STATIONERY_WORDING_KINDS.map((k) => [k, getWordingPreset(k, l)]))])) as never;
  const blocked = typeof sp.blocked === "string" && all.has(sp.blocked as never) ? all(sp.blocked as never, { version: current?.version ?? 0 } as never) : null;
  const pdf = (kind: "proof" | "print", version: number) => `/occasions/${id}/stationery/pdf?kind=${kind}&version=${version}`;

  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description")} />
      <HelpLink topic="stationery" />
      {blocked ? <Notice tone="attention">{blocked}</Notice> : null}
      {ed.fontFamily === "fallback" ? <Notice tone="attention">{t("proof.fallbackFonts")}</Notice> : null}
      <Section>
        <StationeryDesigner
          occasionId={id}
          occasionKind={ed.occasion.kind}
          canManage={ed.canManage}
          designs={designs}
          ranges={[...DESIGN_RANGES]}
          starters={starters}
          limits={STATIONERY_FIELD_LIMITS}
          presets={presets}
          initial={initial}
          initialProof={{ src: svgDataUri(first!.svg), widthMm: first!.widthMm, heightMm: first!.heightMm, fit: first!.fit, truncated: first!.truncated }}
          savedVersion={current?.version ?? null}
          ai={{ enabled: ai.enabled, remaining: ai.remaining, limit: ai.limit, resetsOn: formatDate(ai.resetsAt, locale) }}
        />
      </Section>

      <Section title={t("versions.title")} level={3}>
        <p className="ed-muted" style={{ maxWidth: "var(--measure)" }}>{t("versions.body")}</p>
        {!current ? (
          <EmptyState title={t("versions.empty")}>{t("versions.emptyBody")}</EmptyState>
        ) : (
          <>
            <Card>
              <Stack>
                <div className={styles.versionHead}>
                  <strong>{t("versions.version", { version: current.version })}</strong>
                  <Tag tone={current.proofedAt ? "success" : "attention"}>{current.proofedAt ? t("versions.proofed") : t("versions.notProofed")}</Tag>
                </div>
                <p className="ed-small ed-muted">{t("versions.meta", { design: stationeryDesignName(current.designKey, locale), date: formatDate(current.createdAt, locale) })}</p>
                <div className={styles.inline}>
                  <LinkButton href={pdf("proof", current.version)} download>
                    <IconDownload size={18} />
                    {t("proof.download")}
                  </LinkButton>
                  {!current.proofedAt && ed.canManage ? <MarkProofed occasionId={id} version={current.version} label={t("proof.mark")} pendingLabel={t("proof.marking")} /> : null}
                </div>
                {!current.proofedAt ? <p className="ed-small ed-muted">{ed.canManage ? t("proof.markHint") : t("proof.needManager")}</p> : null}
                {current.proofedAt && ed.canManage ? (
                  <form method="get" action={`/occasions/${id}/stationery/pdf`} className="ed-form">
                    <input type="hidden" name="kind" value="print" />
                    <input type="hidden" name="version" value={current.version} />
                    <Checkbox name="marks" label={t("proof.cropMarks")} defaultChecked />
                    <div>
                      <button type="submit" className="ed-btn">
                        <IconDownload size={18} />
                        {t("proof.print")}
                      </button>
                    </div>
                    <p className="ed-small ed-muted">{t("proof.printHint")}</p>
                  </form>
                ) : null}
              </Stack>
            </Card>
            {ed.versions.length > 1 ? (
              <div style={{ marginTop: "var(--s-4)" }}>
                <Section title={t("versions.older")} level={3}>
                  <List>
                    {ed.versions.slice(1).map((v) => (
                      <Row
                        key={v.version}
                        title={t("versions.version", { version: v.version })}
                        meta={t("versions.meta", { design: stationeryDesignName(v.designKey, locale), date: formatDate(v.createdAt, locale) })}
                        end={
                          <span className={styles.inline}>
                            <Tag tone={v.proofedAt ? "success" : "neutral"}>{v.proofedAt ? t("versions.proofed") : t("versions.notProofed")}</Tag>
                            <LinkButton size="sm" href={pdf(v.proofedAt && ed.canManage ? "print" : "proof", v.version)} download>
                              <IconDownload size={18} />
                              {v.proofedAt && ed.canManage ? t("proof.print") : t("proof.download")}
                            </LinkButton>
                          </span>
                        }
                      />
                    ))}
                  </List>
                </Section>
              </div>
            ) : null}
          </>
        )}
      </Section>

      {current ? (
        <Section title={t("digital.title")} level={3}>
          <p className="ed-muted" style={{ maxWidth: "var(--measure)" }}>{t("digital.body")}</p>
          <p>{ed.digitalVersion ? t("digital.on", { version: ed.digitalVersion }) : t("digital.off")}</p>
          {ed.canManage ? <DigitalToggle occasionId={id} enabled={!!ed.digitalVersion} label={ed.digitalVersion ? t("digital.disable") : t("digital.enable")} pendingLabel={t("digital.working")} /> : null}
        </Section>
      ) : null}
    </>
  );
}
