import type { Badge } from "@ed/core/business";
import { formatDate } from "@ed/i18n/format";
import { Fact } from "@ed/ui";
import { IconCheck } from "@ed/ui/icons";
import { getLocale, getTranslations } from "next-intl/server";

/**
 * P4: the ONLY two badges the product can show — both statements of fact, set as small
 * tracked labels (<Fact>), never as an endorsement. There is no other badge component.
 */
export async function Badges({ badges }: { badges: Badge[] }) {
  if (badges.length === 0) return null;
  const t = await getTranslations("directory.badges");
  const locale = (await getLocale()) as "ro" | "en";
  return (
    <>
      {badges.map((b) => {
        if (b.kind === "onrc") {
          return (
            <li key="onrc">
              <Fact icon={<IconCheck size={14} />}>{t("onrc")}</Fact>
            </li>
          );
        }
        const [y, m, d] = b.validUntil.split("-").map(Number) as [number, number, number];
        return (
          <li key="insurance">
            <Fact icon={<IconCheck size={14} />}>{t("insurance", { date: formatDate(new Date(Date.UTC(y, m - 1, d, 12)), locale) })}</Fact>
          </li>
        );
      })}
    </>
  );
}
