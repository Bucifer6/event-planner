import { DISCOVERY_SOURCE_KINDS, type DiscoverySourceKind } from "@ed/core/discovery";
import { listCategories } from "@ed/core/geography";
import { List, Page, PageHeader } from "@ed/ui";
import { IconArrowLeft } from "@ed/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { NoRole } from "../../../_components/NoRole";
import { requireConsole } from "../../../_lib";
import { SourceForm } from "../../_components/SourceForm";
import styles from "../../discovery.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("discovery"))("sourceForm.newTitle") };
}

/** W5: add a discovery source — first its kind, then its settings. A new source starts paused. */
export default async function NewSourcePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { ctx, has } = await requireConsole();
  const t = await getTranslations("discovery");
  if (!has("listing_moderator", "platform_admin")) return <NoRole title={t("title")} roles={["listing_moderator", "platform_admin"]} />;
  const sp = await searchParams;
  const kind = (DISCOVERY_SOURCE_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as DiscoverySourceKind) : null;
  const categories = await listCategories(ctx);
  return (
    <Page narrow>
      <Link href={kind ? "/console/discovery/sources/new" : "/console/discovery"} className={styles.back}>
        <IconArrowLeft size={16} />
        {t("sourceForm.back")}
      </Link>
      <PageHeader title={t("sourceForm.newTitle")} description={kind ? t(`kinds.${kind}`) : t("sourceForm.kind")} />
      {kind ? (
        <SourceForm
          values={{ kind, name: "", termsReference: "", rateLimitPerHour: "60", format: "csv", url: "", inline: "", urls: "", defaultCategoryId: "", targetCategoryIds: "", targetCountyCodes: "" }}
          categories={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
      ) : (
        <List>
          {DISCOVERY_SOURCE_KINDS.map((k) => (
            <li key={k} className="ed-row">
              <div className="ed-row__main">
                <Link href={`/console/discovery/sources/new?kind=${k}`} className="ed-row__title">
                  {t(`kinds.${k}`)}
                </Link>
                <span className="ed-row__meta">{t(`kindHelp.${k}`)}</span>
              </div>
            </li>
          ))}
        </List>
      )}
    </Page>
  );
}
