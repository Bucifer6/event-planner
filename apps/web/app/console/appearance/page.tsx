import { getUiTheme, UI_THEMES, type UiTheme } from "@ed/core/appearance";
import { Eyebrow, Notice, Page, PageHeader, Section, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { NoRole } from "../_components/NoRole";
import { requireConsole } from "../_lib";
import { saveUiTheme } from "./actions";
import styles from "./appearance.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("console.appearance"))("title") };
}

/**
 * Console → Appearance. A platform administrator picks one of the looks for the whole app.
 * Each option is drawn with that look's own tokens, so the miniature is the real thing.
 */
export default async function AppearancePage() {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("console.appearance");
  if (!has("platform_admin")) return <NoRole title={t("title")} roles={["platform_admin"]} />;
  const current = await getUiTheme(ctx, { fresh: true });

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <div className={styles.wrap}>
        <Section title={t("choose")}>
          <ActionForm
            action={saveUiTheme}
            refreshOnSuccess
            block={false}
            submitLabel={t("apply")}
            pendingLabel={t("applying")}
            success={t("applied")}
          >
            <fieldset className="ed-fieldset">
              <legend className="ed-vh">{t("choose")}</legend>
              <div className={styles.grid}>
                {UI_THEMES.map((theme) => (
                  <ThemeOption
                    key={theme}
                    theme={theme}
                    checked={theme === current}
                    name={t(`themes.${theme}.name`)}
                    mood={t(`themes.${theme}.mood`)}
                    about={t(`themes.${theme}.about`)}
                    currentLabel={theme === current ? t("inUse") : null}
                    sample={{
                      kicker: t("sample.kicker"),
                      action: t("sample.action"),
                      meta: t("sample.meta"),
                      unknown: t("sample.unknown"),
                    }}
                  />
                ))}
              </div>
            </fieldset>
          </ActionForm>
        </Section>
        <Notice title={t("noteTitle")}>{t("note")}</Notice>
      </div>
    </Page>
  );
}

function ThemeOption({
  theme,
  checked,
  name,
  mood,
  about,
  currentLabel,
  sample,
}: {
  theme: UiTheme;
  checked: boolean;
  name: string;
  mood: string;
  about: string;
  currentLabel: string | null;
  sample: { kicker: string; action: string; meta: string; unknown: string };
}) {
  return (
    <label className={styles.option}>
      <input type="radio" name="theme" value={theme} defaultChecked={checked} />
      <div className={styles.sample} data-ui={theme} data-theme="light">
        <Eyebrow>{sample.kicker}</Eyebrow>
        <div className={styles.plate}>
          <p className={styles.title}>
            Ioana <em>&amp;</em> Ștefan
          </p>
          <span className="ed-small ed-muted">{sample.meta}</span>
          <span className="ed-unknown ed-small">{sample.unknown}</span>
        </div>
        <div className={styles.row}>
          <span className="ed-btn ed-btn--primary ed-btn--sm" aria-hidden>
            {sample.action}
          </span>
          <span className={styles.swatches} aria-hidden>
            <span style={{ background: "var(--paper)" }} />
            <span style={{ background: "var(--ink)" }} />
            <span style={{ background: "var(--accent)" }} />
            <span style={{ background: "var(--gilt)" }} />
          </span>
        </div>
      </div>
      <span className={styles.caption}>
        <span>
          <strong>{name}</strong> — {mood}
          {currentLabel ? (
            <span className={styles.current}>
              <Tag tone="accent">{currentLabel}</Tag>
            </span>
          ) : null}
        </span>
        <span className="ed-small ed-muted">{about}</span>
      </span>
    </label>
  );
}
