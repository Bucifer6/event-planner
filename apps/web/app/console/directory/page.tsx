import { getDirectoryStats } from "@ed/core/directory";
import { listCategories, listCounties, listLocalities, type CategoryView, type CountyView, type LocalityView } from "@ed/core/geography";
import { LOCALITY_KINDS } from "@ed/db";
import { formatInteger } from "@ed/i18n/format";
import { buttonClassName, EmptyState, Figure, Figures, Page, PageHeader, Section, Table, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  addCategory,
  addCounty,
  addLocality,
  mergeCategoryAction,
  mergeCountyAction,
  mergeLocalityAction,
  moveCategoryAction,
  renameCategory,
  renameCounty,
  renameLocality,
  setCategoryFlag,
  setCountyFlag,
  setLocalityFlag,
} from "@/app/actions/directory";
import { ActionForm, type FormAction } from "@/app/(auth)/_components/forms";
import { NoRole } from "../_components/NoRole";
import { SpecForm } from "../_components/SpecForm";
import { requireConsole } from "../_lib";
import pageStyles from "../moderation/moderation.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("moderation"))("directory.title") };
}

const TABS = ["categories", "geography", "stats"] as const;
type Tab = (typeof TABS)[number];
type T = Awaited<ReturnType<typeof getTranslations<"moderation">>>;

function Toggle<R>({ action, hidden, on, onLabel, offLabel, t }: { action: FormAction<R>; hidden: Record<string, string>; on: boolean; onLabel: string; offLabel: string; t: T }) {
  return (
    <ActionForm
      action={action}
      hidden={{ ...hidden, value: on ? "false" : "true" }}
      refreshOnSuccess
      variant="secondary"
      block={false}
      submitLabel={on ? offLabel : onLabel}
      pendingLabel={t("directory.saving")}
    />
  );
}

function CategoryBlock({ c, index, all, t }: { c: CategoryView; index: number; all: CategoryView[]; t: T }) {
  const others = all.filter((o) => o.id !== c.id && o.active);
  return (
    <div className={pageStyles.block}>
      <div className={pageStyles.forms}>
        <span className="ed-num ed-muted">{String(index + 1).padStart(2, "0")}</span>
        <strong>{c.nameRo}</strong>
        <span className="ed-muted">{c.nameEn}</span>
        {!c.active ? <Tag tone="neutral">{t("directory.retired")}</Tag> : c.published ? <Tag tone="success">{t("directory.published")}</Tag> : <Tag tone="attention">{t("directory.unpublished")}</Tag>}
      </div>
      <details className={pageStyles.details}>
        <summary>{t("directory.manageNamed", { name: c.nameRo })}</summary>
        <div className="ed-stack" data-gap="4">
          <div className={pageStyles.forms}>
            <ActionForm action={moveCategoryAction} hidden={{ id: c.id, direction: "up" }} refreshOnSuccess variant="secondary" block={false} submitLabel={t("directory.moveUp")} pendingLabel={t("directory.saving")} />
            <ActionForm action={moveCategoryAction} hidden={{ id: c.id, direction: "down" }} refreshOnSuccess variant="secondary" block={false} submitLabel={t("directory.moveDown")} pendingLabel={t("directory.saving")} />
            {c.active ? <Toggle action={setCategoryFlag} hidden={{ id: c.id, flag: "published" }} on={c.published} onLabel={t("directory.publish")} offLabel={t("directory.unpublish")} t={t} /> : null}
            <Toggle action={setCategoryFlag} hidden={{ id: c.id, flag: "active" }} on={c.active} onLabel={t("directory.restore")} offLabel={t("directory.retire")} t={t} />
          </div>
          <SpecForm
            action={renameCategory}
            hidden={{ id: c.id }}
            fields={[
              { kind: "text", name: "nameRo", label: t("directory.nameRo"), required: true, maxLength: 80, defaultValue: c.nameRo },
              { kind: "text", name: "nameEn", label: t("directory.nameEn"), required: true, maxLength: 80, defaultValue: c.nameEn },
            ]}
            submitLabel={t("directory.rename")}
            pendingLabel={t("directory.saving")}
            variant="secondary"
            refreshOnSuccess
          />
          {c.active && others.length > 0 ? (
            <SpecForm
              action={mergeCategoryAction}
              hidden={{ fromId: c.id }}
              fields={[
                {
                  kind: "select",
                  name: "intoId",
                  label: t("directory.mergeInto"),
                  hint: t("directory.mergeCategoryHint"),
                  required: true,
                  placeholder: t("directory.choose"),
                  options: others.map((o) => ({ value: o.id, label: o.nameRo })),
                },
              ]}
              submitLabel={t("directory.merge")}
              pendingLabel={t("directory.saving")}
              variant="danger"
              refreshOnSuccess
            />
          ) : null}
        </div>
      </details>
    </div>
  );
}

function LocalityBlock({ l, siblings, t }: { l: LocalityView; siblings: LocalityView[]; t: T }) {
  const others = siblings.filter((o) => o.id !== l.id && o.active);
  return (
    <div className={pageStyles.block}>
      <div className={pageStyles.forms}>
        <strong>{l.nameRo}</strong>
        <span className="ed-muted">{t(`directory.kinds.${l.kind}`)}</span>
        {!l.active ? <Tag tone="neutral">{t("directory.retired")}</Tag> : l.publicPage ? <Tag tone="success">{t("directory.hasPage")}</Tag> : null}
      </div>
      <details className={pageStyles.details}>
        <summary>{t("directory.manageNamed", { name: l.nameRo })}</summary>
        <div className="ed-stack" data-gap="4">
          <div className={pageStyles.forms}>
            {l.active ? <Toggle action={setLocalityFlag} hidden={{ id: l.id, flag: "publicPage" }} on={l.publicPage} onLabel={t("directory.pageOn")} offLabel={t("directory.pageOff")} t={t} /> : null}
            <Toggle action={setLocalityFlag} hidden={{ id: l.id, flag: "active" }} on={l.active} onLabel={t("directory.restore")} offLabel={t("directory.retire")} t={t} />
          </div>
          <SpecForm
            action={renameLocality}
            hidden={{ id: l.id }}
            fields={[
              { kind: "text", name: "nameRo", label: t("directory.nameRo"), required: true, maxLength: 80, defaultValue: l.nameRo },
              { kind: "text", name: "nameEn", label: t("directory.nameEnOptional"), maxLength: 80, defaultValue: l.nameEn ?? "" },
            ]}
            submitLabel={t("directory.rename")}
            pendingLabel={t("directory.saving")}
            variant="secondary"
            refreshOnSuccess
          />
          {l.active && others.length > 0 ? (
            <SpecForm
              action={mergeLocalityAction}
              hidden={{ fromId: l.id }}
              fields={[
                {
                  kind: "select",
                  name: "intoId",
                  label: t("directory.mergeInto"),
                  hint: t("directory.mergeLocalityHint"),
                  required: true,
                  placeholder: t("directory.choose"),
                  options: others.map((o) => ({ value: o.id, label: o.nameRo })),
                },
              ]}
              submitLabel={t("directory.merge")}
              pendingLabel={t("directory.saving")}
              variant="danger"
              refreshOnSuccess
            />
          ) : null}
        </div>
      </details>
    </div>
  );
}

function CountyPanel({ county, counties, localities, t }: { county: CountyView; counties: CountyView[]; localities: LocalityView[]; t: T }) {
  const others = counties.filter((o) => o.code !== county.code && o.active);
  return (
    <>
      <Section title={t("directory.countyTitle", { name: county.nameRo, code: county.code })}>
        <div className={pageStyles.forms}>
          {!county.active ? <Tag tone="neutral">{t("directory.retired")}</Tag> : county.published ? <Tag tone="success">{t("directory.published")}</Tag> : <Tag tone="attention">{t("directory.unpublished")}</Tag>}
          {county.launchArea ? <Tag tone="accent">{t("directory.launch")}</Tag> : null}
        </div>
        <div className={pageStyles.forms}>
          {county.active ? <Toggle action={setCountyFlag} hidden={{ code: county.code, flag: "published" }} on={county.published} onLabel={t("directory.publish")} offLabel={t("directory.unpublish")} t={t} /> : null}
          {county.active ? <Toggle action={setCountyFlag} hidden={{ code: county.code, flag: "launchArea" }} on={county.launchArea} onLabel={t("directory.launchOn")} offLabel={t("directory.launchOff")} t={t} /> : null}
          <Toggle action={setCountyFlag} hidden={{ code: county.code, flag: "active" }} on={county.active} onLabel={t("directory.restore")} offLabel={t("directory.retire")} t={t} />
        </div>
        <details className={pageStyles.details}>
          <summary>{t("directory.renameOrMerge")}</summary>
          <div className="ed-stack" data-gap="4">
            <SpecForm
              action={renameCounty}
              hidden={{ code: county.code }}
              fields={[
                { kind: "text", name: "nameRo", label: t("directory.nameRo"), required: true, maxLength: 80, defaultValue: county.nameRo },
                { kind: "text", name: "nameEn", label: t("directory.nameEn"), required: true, maxLength: 80, defaultValue: county.nameEn },
              ]}
              submitLabel={t("directory.rename")}
              pendingLabel={t("directory.saving")}
              variant="secondary"
              refreshOnSuccess
            />
            {county.active ? (
              <SpecForm
                action={mergeCountyAction}
                hidden={{ fromCode: county.code }}
                fields={[
                  {
                    kind: "select",
                    name: "intoCode",
                    label: t("directory.mergeInto"),
                    hint: t("directory.mergeCountyHint"),
                    required: true,
                    placeholder: t("directory.choose"),
                    options: others.map((o) => ({ value: o.code, label: o.nameRo })),
                  },
                ]}
                submitLabel={t("directory.merge")}
                pendingLabel={t("directory.saving")}
                variant="danger"
                refreshOnSuccess
              />
            ) : null}
          </div>
        </details>
      </Section>

      <Section title={t("directory.localitiesTitle", { count: localities.length })}>
        <p className="ed-muted">{t("directory.localitiesBody")}</p>
        {localities.length === 0 ? <EmptyState title={t("directory.noLocalities")} /> : localities.map((l) => <LocalityBlock key={l.id} l={l} siblings={localities} t={t} />)}
        <details className={pageStyles.details}>
          <summary>{t("directory.addLocality")}</summary>
          <SpecForm
            action={addLocality}
            hidden={{ countyCode: county.code }}
            fields={[
              { kind: "text", name: "nameRo", label: t("directory.nameRo"), required: true, maxLength: 80 },
              { kind: "text", name: "nameEn", label: t("directory.nameEnOptional"), maxLength: 80 },
              { kind: "select", name: "kind", label: t("directory.kind"), defaultValue: "oras", options: LOCALITY_KINDS.map((k) => ({ value: k, label: t(`directory.kinds.${k}`) })) },
            ]}
            submitLabel={t("directory.addLocality")}
            pendingLabel={t("directory.saving")}
            variant="secondary"
            refreshOnSuccess
          />
        </details>
      </Section>
    </>
  );
}

/**
 * W4: directory management — categories (create, rename, reorder, publish, retire, merge),
 * counties and localities (create, rename, retire, merge, launch area, locality pages), and
 * the per category × county statistics (daily totals; no visitor identifier exists, D4).
 */
export default async function ConsoleDirectoryPage({ searchParams }: { searchParams: Promise<{ tab?: string; county?: string; days?: string }> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("moderation");
  if (!has("listing_moderator", "platform_admin")) return <NoRole title={t("directory.title")} roles={["listing_moderator", "platform_admin"]} />;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "categories";
  const n = (v: number) => formatInteger(v, ctx.locale);

  let body;
  if (tab === "categories") {
    const cats = await listCategories(ctx, { includeInactive: true });
    body = (
      <>
        <Section title={t("directory.categoriesTitle", { count: cats.filter((c) => c.active).length })}>
          <p className="ed-muted">{t("directory.categoriesBody")}</p>
          {cats.map((c, i) => (
            <CategoryBlock key={c.id} c={c} index={i} all={cats} t={t} />
          ))}
        </Section>
        <Section title={t("directory.addCategory")}>
          <SpecForm
            action={addCategory}
            fields={[
              { kind: "text", name: "nameRo", label: t("directory.nameRo"), required: true, maxLength: 80 },
              { kind: "text", name: "nameEn", label: t("directory.nameEn"), required: true, maxLength: 80 },
            ]}
            submitLabel={t("directory.addCategory")}
            pendingLabel={t("directory.saving")}
            variant="secondary"
            refreshOnSuccess
          />
        </Section>
      </>
    );
  } else if (tab === "geography") {
    const counties = await listCounties(ctx, { includeInactive: true });
    const selected = counties.find((c) => c.code === (sp.county ?? "").toUpperCase());
    const all = await listLocalities(ctx, { includeInactive: true });
    body = (
      <>
        {selected ? (
          <>
            <p>
              <Link href="/console/directory?tab=geography">{t("directory.backToCounties")}</Link>
            </p>
            <CountyPanel county={selected} counties={counties} localities={all.filter((l) => l.countyCode === selected.code)} t={t} />
          </>
        ) : (
          <>
            <Section title={t("directory.countiesTitle", { count: counties.filter((c) => c.active).length })}>
              <Table caption={t("directory.countiesTitle", { count: counties.length })}>
                <thead>
                  <tr>
                    <th scope="col">{t("directory.county")}</th>
                    <th scope="col">{t("directory.code")}</th>
                    <th scope="col">{t("directory.state")}</th>
                    <th scope="col" data-num>
                      {t("directory.localities")}
                    </th>
                    <th scope="col" data-num>
                      {t("directory.pages")}
                    </th>
                    <th scope="col" aria-label={t("open")} />
                  </tr>
                </thead>
                <tbody>
                  {counties.map((c) => {
                    const mine = all.filter((l) => l.countyCode === c.code && l.active);
                    return (
                      <tr key={c.code}>
                        <td>
                          <strong>{c.nameRo}</strong>
                        </td>
                        <td>{c.code}</td>
                        <td>
                          <div className={pageStyles.forms}>
                            {!c.active ? <Tag tone="neutral">{t("directory.retired")}</Tag> : c.published ? <Tag tone="success">{t("directory.published")}</Tag> : <Tag tone="attention">{t("directory.unpublished")}</Tag>}
                            {c.launchArea ? <Tag tone="accent">{t("directory.launch")}</Tag> : null}
                          </div>
                        </td>
                        <td className="ed-num">{n(mine.length)}</td>
                        <td className="ed-num">{n(mine.filter((l) => l.publicPage).length)}</td>
                        <td>
                          <Link href={`/console/directory?tab=geography&county=${c.code}`} className={buttonClassName({ size: "sm" })} aria-label={t("openNamed", { title: c.nameRo })}>
                            {t("open")}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Section>
            <Section title={t("directory.addCounty")}>
              <SpecForm
                action={addCounty}
                fields={[
                  { kind: "text", name: "code", label: t("directory.code"), hint: t("directory.codeHint"), required: true, maxLength: 3 },
                  { kind: "text", name: "nameRo", label: t("directory.nameRo"), required: true, maxLength: 80 },
                  { kind: "text", name: "nameEn", label: t("directory.nameEnOptional"), maxLength: 80 },
                ]}
                submitLabel={t("directory.addCounty")}
                pendingLabel={t("directory.saving")}
                variant="secondary"
                refreshOnSuccess
              />
            </Section>
          </>
        )}
      </>
    );
  } else {
    const days = [7, 14, 30].includes(Number(sp.days)) ? Number(sp.days) : 14;
    const stats = await getDirectoryStats(ctx, { days });
    const showDays = days <= 14;
    body = (
      <>
        <nav aria-label={t("directory.period")}>
          <ul className="ed-tabs">
            {[7, 14, 30].map((d) => (
              <li key={d}>
                <Link className="ed-tab" href={`/console/directory?tab=stats&days=${d}`} aria-current={d === days ? "page" : undefined}>
                  {t("directory.lastDays", { count: d })}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Figures>
          <Figure size="hero" label={t("directory.searchesLabel", { count: days })} value={n(stats.totalSearches)} note={t("directory.searchesNote")} />
        </Figures>
        <Section title={t("directory.statsTitle")}>
          <p className="ed-muted">{t("directory.statsBody")}</p>
          {stats.rows.length === 0 ? (
            <EmptyState title={t("directory.statsEmpty")} />
          ) : (
            <Table caption={t("directory.statsTitle")}>
              <thead>
                <tr>
                  <th scope="col">{t("directory.category")}</th>
                  <th scope="col">{t("directory.county")}</th>
                  <th scope="col" data-num>
                    {t("directory.liveListings")}
                  </th>
                  <th scope="col" data-num>
                    {t("directory.searches")}
                  </th>
                  {showDays
                    ? stats.days.map((d) => (
                        <th key={d} scope="col" data-num>
                          {d.slice(8)}.{d.slice(5, 7)}
                        </th>
                      ))
                    : null}
                </tr>
              </thead>
              <tbody>
                {stats.rows.map((r) => (
                  <tr key={`${r.categorySlug}|${r.countyCode}`}>
                    <td>{r.categoryName}</td>
                    <td>{r.countyName}</td>
                    <td className="ed-num">{n(r.liveListings)}</td>
                    <td className="ed-num">
                      <strong>{n(r.searches)}</strong>
                    </td>
                    {showDays
                      ? stats.days.map((d) => (
                          <td key={d} className="ed-num">
                            {r.searchesByDay[d] ? n(r.searchesByDay[d]) : <span className="ed-muted">0</span>}
                          </td>
                        ))
                      : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      </>
    );
  }

  return (
    <Page>
      <PageHeader title={t("directory.title")} description={t("directory.description")} />
      <nav aria-label={t("directory.tabsLabel")}>
        <ul className="ed-tabs">
          {TABS.map((x) => (
            <li key={x}>
              <Link className="ed-tab" href={x === "categories" ? "/console/directory" : `/console/directory?tab=${x}`} aria-current={x === tab ? "page" : undefined}>
                {t(`directory.tabs.${x}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {body}
    </Page>
  );
}
