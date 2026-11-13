import { Card, DeltaList, Figure, List, Meter, Row, Tag, Unknown, cx } from "@ed/ui";
import { Ornament } from "@ed/ui/icons";
import type { ReactNode } from "react";
import s from "@/app/site.module.css";

/** Translator scoped to one vignette's keys. */
type T = (key: string) => string;

/** A product vignette set like a plate in a book: italic caption above, the object below. */
export function Plate({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className={s.figure}>
      {children}
      <figcaption className={s.caption}>{caption}</figcaption>
    </figure>
  );
}

/** The hero object: an engraved invitation drawn only with type and hairlines. */
export function InvitationPlate({ t }: { t: T }) {
  return (
    <div className={cx("ed-plate", s.plate)} role="img" aria-label={t("label")}>
      <span className={s.plateKicker}>{t("kicker")}</span>
      <span className={s.plateNames}>
        <span>{t("first")}</span>
        <span className={s.plateAmp}>&amp;</span>
        <span>{t("second")}</span>
      </span>
      <span className={s.plateLine}>{t("line")}</span>
      <Ornament />
      <span className={s.plateDate}>
        <span>{t("date")}</span>
        <span>{t("time")}</span>
      </span>
      <span className={s.platePlace}>{t("place")}</span>
      <span className={s.plateRsvp}>{t("rsvp")}</span>
    </div>
  );
}

export function RsvpVignette({ t }: { t: T }) {
  return (
    <Card>
      <Figure label={t("label")} value={t("value")} unit={t("unit")} note={t("note")} size="hero" />
      <Meter value={98} max={112} label={t("meter")} />
      <div className={s.miniFigures}>
        <Figure size="sm" label={t("adults")} value={t("adultsValue")} />
        <Figure size="sm" label={t("children")} value={t("childrenValue")} note={t("childrenNote")} />
        <Figure size="sm" label={t("declined")} value={t("declinedValue")} />
      </div>
    </Card>
  );
}

export function WhatIfVignette({ t }: { t: T }) {
  return (
    <Card>
      <p className={s.vignetteQuestion}>{t("question")}</p>
      <DeltaList
        rows={[
          { key: "1", kind: t("r1kind"), what: t("r1what"), before: t("r1before"), after: t("r1after") },
          { key: "2", kind: t("r2kind"), what: t("r2what"), before: t("r2before"), after: t("r2after") },
          {
            key: "3",
            kind: t("r3kind"),
            what: t("r3what"),
            before: t("r3before"),
            after: t("r3after"),
            note: t("r3note"),
          },
        ]}
      />
      <p className="ed-small ed-muted">{t("footer")}</p>
    </Card>
  );
}

export function TasksVignette({ t }: { t: T }) {
  return (
    <Card>
      <List className={s.flush}>
        <Row index="1" title={t("t1")} meta={t("t1meta")}>
          <span className={s.rowState}>
            <Tag tone="success">{t("t1state")}</Tag>
          </span>
        </Row>
        <Row index="2" title={t("t2")} meta={t("t2meta")}>
          <span className={s.rowState}>
            <Tag tone="accent">{t("t2state")}</Tag>
          </span>
        </Row>
        <Row index="3" title={t("t3")} meta={t("t3meta")}>
          <span className={s.rowState}>
            <Tag>{t("t3state")}</Tag>
          </span>
        </Row>
        <Row index="4" title={t("t4")} meta={t("t4meta")}>
          <span className={s.rowState}>
            <Unknown label={t("t4state")} />
          </span>
        </Row>
      </List>
    </Card>
  );
}
