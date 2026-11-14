"use client";

import { buildPlanScene, type PlanModel, type PlanSceneOptions } from "@ed/core/spacemodel";
import { useEffect, useMemo, useRef, useState } from "react";
import { PlanSvg } from "./PlanSvg";
import styles from "./plan.module.css";

export type PlanViewProps = {
  model: PlanModel;
  /** Accessible name: "Planul sălii Sala Mare". */
  label: string;
  pictureUrl?: string | null;
  title?: { name: string; meta?: string | null } | null;
  /** Unit written after the scale bar's number ("m"). */
  unit?: string;
  /** Numbered legend under the plan: one label per point of interest, in order. */
  poiLabels?: string[];
  mineIds?: string[];
  options?: Pick<PlanSceneOptions, "showTables" | "showFixtures" | "showPois" | "showParking" | "showSeats" | "showCounts" | "onlyItemIds" | "withBackdrop">;
};

/** Width of the element, re-measured when it changes. 0 until mounted (SSR draws a phone-wide sheet). */
export function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.floor(el.clientWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * A read-only plan: the business's preview, the public listing, the planner's space page and
 * the guest view all use it. Lettering stays the same size at every width because the scene
 * is laid out for the measured width.
 */
export function PlanView({ model, label, pictureUrl, title, unit = "m", poiLabels, mineIds, options }: PlanViewProps) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const width = Math.min(measured || 358, 960);
  const scene = useMemo(() => buildPlanScene(model, { ...options, width, title, scaleLabel: (n) => `${n} ${unit}` }), [model, options, width, title, unit]);
  return (
    <div className={styles.frame}>
      <div ref={ref} className={`ed-plan ${styles.sheet}`} data-backdrop={pictureUrl && scene.backdrop ? "true" : undefined}>
        <PlanSvg scene={scene} label={label} pictureUrl={pictureUrl} mineIds={mineIds} />
      </div>
      {poiLabels && poiLabels.length > 0 ? (
        <ol className={styles.legend}>
          {poiLabels.map((text, i) => (
            <li key={i}>
              <span className={styles.legendMark}>{i + 1}</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
