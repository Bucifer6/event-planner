import { suggestDirectoryLink } from "@ed/core/directory";
import { isAppError } from "@ed/shared/errors";
import { IconDirectory } from "@ed/ui/icons";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { hideDirectoryLink } from "@/app/actions/directory";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { getCtx } from "@/lib/ctx";
import styles from "../directory.module.css";

/**
 * P7: the one dismissible link on a relevant task — "Vezi firme de <categorie> în <zona>".
 * It opens a directory search and names no business. Renders nothing when the task has no
 * obvious category or when the link is switched off (per account or per occasion).
 *
 * Mount: <TaskDirectoryLink occasionId={…} taskTitle={task.title} templateTaskKey={…} canManage={…} />
 */
export async function TaskDirectoryLink({
  occasionId,
  taskTitle,
  templateTaskKey,
  canManage,
}: {
  occasionId: string;
  taskTitle: string;
  templateTaskKey?: string | null;
  /** Owner / project manager: may switch the link off for the whole occasion. */
  canManage?: boolean;
}) {
  const ctx = await getCtx();
  let link;
  try {
    link = await suggestDirectoryLink(ctx, { occasionId, taskTitle, templateTaskKey });
  } catch (e) {
    if (isAppError(e)) return null;
    throw e;
  }
  if (!link) return null;
  const t = await getTranslations("directory.taskLink");
  return (
    <div className={styles.linkOff}>
      <Link href={link.href}>
        <IconDirectory size={16} style={{ display: "inline", marginRight: 6, verticalAlign: "-2px" }} />
        {t(link.labelKey === "directory.taskLink.label" ? "label" : "labelNoArea", link.params)}
      </Link>
      <details>
        <summary className={styles.summary}>{t("hide")}</summary>
        <div className={styles.linkOff}>
          {canManage ? (
            <ActionForm
              action={hideDirectoryLink}
              hidden={{ scope: "occasion", occasionId }}
              refreshOnSuccess
              variant="quiet"
              block={false}
              submitLabel={t("hideForOccasion")}
              pendingLabel={t("hiding")}
            />
          ) : null}
          <ActionForm
            action={hideDirectoryLink}
            hidden={{ scope: "account", occasionId }}
            refreshOnSuccess
            variant="quiet"
            block={false}
            submitLabel={t("hideEverywhere")}
            pendingLabel={t("hiding")}
          />
        </div>
      </details>
    </div>
  );
}
