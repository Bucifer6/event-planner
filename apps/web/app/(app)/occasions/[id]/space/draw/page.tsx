import { getSpaceModel } from "@ed/core/seating";
import { buttonClassName, Notice, PageHeader, Section } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { HelpLink } from "@/components/help/HelpLink";
import { RoomDrawer } from "@/components/plan/RoomDrawer";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../../_lib/load";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("space.draw"))("title") };
}

/**
 * Draw the room (own spaces only): walls and rectangles to scale, with snapping and typed
 * lengths. A venue's space comes from the venue's own drawing and is not redrawn here.
 */
export default async function DrawRoomPage({ params }: Props) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("space.draw");
  const space = await orNotFound(getSpaceModel(ctx, id));
  const back = `/occasions/${id}/space`;

  if (!space || space.source !== "own" || !space.canManage) {
    return (
      <>
        <PageHeader level={2} title={t("title")} />
        <Section>
          <Notice tone="attention" title={!space ? t("unavailable.noSpace") : space.source !== "own" ? t("unavailable.venue") : t("unavailable.role")}>
            <Link href={back} className={buttonClassName({ variant: "secondary" })}>
              {t("back")}
            </Link>
          </Notice>
        </Section>
      </>
    );
  }

  // a typed rectangle starts the drawing, so the planner reshapes it instead of starting over
  const initial = space.model.areas.map((a) => ({ ...a, id: a.id === "own" ? "room" : a.id, points: a.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) }));
  return (
    <>
      <PageHeader level={2} title={t("title")} description={t("description", { name: space.name })} />
      <HelpLink topic="space-draw" />
      <Section>
        <RoomDrawer occasionId={id} locale={ctx.locale} initial={initial} items={space.model.items} backHref={back} />
      </Section>
    </>
  );
}
