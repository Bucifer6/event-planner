import { ITINERARY_KINDS } from "@ed/db";
import type { TFieldSpec } from "./forms";

type T = (key: string) => string;

/** The fields of the "add / edit a leg" sheet. Times are typed as the local clock of each end. */
export function legFields(t: T, opts: { tripTz: string; subgroups: Array<{ id: string; name: string }>; values?: Partial<Record<string, string>> }): TFieldSpec[] {
  const v = opts.values ?? {};
  const fields: TFieldSpec[] = [
    { name: "title", label: t("leg.title"), required: true, maxLength: 160, defaultValue: v.title ?? "", placeholder: t("leg.titleExample") },
    { name: "kind", label: t("leg.kind"), type: "select", defaultValue: v.kind ?? "flight", options: ITINERARY_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) })) },
    { name: "startsLocal", label: t("leg.starts"), type: "datetime", required: true, hint: t("leg.startsHint"), defaultValue: v.startsLocal ?? "" },
    { name: "startTz", label: t("leg.startTz"), type: "zone", required: true, hint: t("leg.zoneHint"), defaultValue: v.startTz ?? opts.tripTz },
    { name: "endsLocal", label: t("leg.ends"), type: "datetime", hint: t("leg.endsHint"), defaultValue: v.endsLocal ?? "" },
    { name: "endTz", label: t("leg.endTz"), type: "zone", hint: t("leg.endTzHint"), defaultValue: v.endTz ?? "" },
    { name: "placeFrom", label: t("leg.from"), maxLength: 160, defaultValue: v.placeFrom ?? "" },
    { name: "placeTo", label: t("leg.to"), maxLength: 160, defaultValue: v.placeTo ?? "" },
    { name: "reference", label: t("leg.reference"), maxLength: 60, hint: t("leg.referenceHint"), defaultValue: v.reference ?? "" },
    { name: "notes", label: t("leg.notes"), type: "textarea", maxLength: 2000, defaultValue: v.notes ?? "" },
  ];
  if (opts.subgroups.length > 0) {
    fields.push({ name: "subgroupId", label: t("leg.subgroup"), type: "select", hint: t("leg.subgroupHint"), defaultValue: v.subgroupId ?? "", options: [{ value: "", label: t("leg.everyone") }, ...opts.subgroups.map((g) => ({ value: g.id, label: g.name }))] });
  }
  return fields;
}
