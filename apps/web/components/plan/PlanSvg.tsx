import type { PlanScene, SceneNode, SceneRole } from "@ed/core/spacemodel";
import type { ReactNode, SVGProps } from "react";

// THE renderer of a plan scene (see buildPlanScene in @ed/core/spacemodel). No state, no
// hooks: usable from Server and Client Components alike. Styling comes from `.ed-plan`
// (@ed/ui: venue solid, custom dashed, fixtures sunken, POIs gilt) plus plan.module.css.

const KIND: Partial<Record<SceneRole, string>> = { venue: "venue", custom: "custom", fixture: "fixture", poi: "poi" };

function attrs(role: SceneRole, extra?: { selected?: boolean; conflict?: boolean }) {
  const kind = KIND[role];
  const body = role === "venue" || role === "custom" || role === "fixture" || role === "fixture-custom" || role === "unknown";
  return {
    ...(kind ? { "data-kind": kind } : { "data-role": role }),
    ...(body && extra?.selected ? { "data-selected": "true" } : {}),
    ...(body && extra?.conflict && !extra.selected ? { "data-conflict": "true" } : {}),
  };
}

export function SceneNodeView({ node, selected, conflict }: { node: SceneNode; selected?: boolean; conflict?: boolean }) {
  const a = attrs(node.role, { selected, conflict });
  switch (node.t) {
    case "line":
      return <line x1={node.x1} y1={node.y1} x2={node.x2} y2={node.y2} {...a} />;
    case "rect":
      return <rect x={node.x} y={node.y} width={node.w} height={node.h} transform={node.rotate ? `rotate(${node.rotate} ${node.cx} ${node.cy})` : undefined} {...a} />;
    case "circle":
      return <circle cx={node.cx} cy={node.cy} r={node.r} {...a} />;
    case "polygon":
      return <polygon points={node.points.map((p) => p.join(",")).join(" ")} {...a} />;
    case "text":
      return (
        <text x={node.x} y={node.y} textAnchor={node.anchor} {...a}>
          {node.text}
        </text>
      );
  }
}

export type PlanSvgProps = {
  scene: PlanScene;
  /** Accessible name of the drawing. */
  label: string;
  /** Signed link of the drawing picture (shown faintly behind the plan). */
  pictureUrl?: string | null;
  selectedId?: string | null;
  conflictIds?: readonly string[];
  /** Items ringed in gilt (the guest's own table). */
  mineIds?: readonly string[];
  /** Ids drawn faded (put away in this stage). */
  awayIds?: readonly string[];
  /** Per-item <g> props — the editor adds focus, pointer and keyboard handlers here. */
  itemProps?: (id: string) => SVGProps<SVGGElement> | undefined;
  /** Extra SVG drawn above everything (calibration points, drafts, drag ghost). */
  children?: ReactNode;
  svgProps?: SVGProps<SVGSVGElement>;
  /** Explicit pixel width (zoom); otherwise the SVG fills its container. */
  displayWidth?: number;
};

export function PlanSvg({ scene, label, pictureUrl, selectedId, conflictIds = [], mineIds = [], awayIds = [], itemProps, children, svgProps, displayWidth }: PlanSvgProps) {
  const ratio = displayWidth ? displayWidth / scene.width : 1;
  return (
    <svg
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={displayWidth ?? scene.width}
      height={Math.round(scene.height * ratio)}
      role="img"
      aria-label={label}
      {...svgProps}
    >
      {pictureUrl && scene.backdrop ? <image href={pictureUrl} x={scene.backdrop.x} y={scene.backdrop.y} width={scene.backdrop.w} height={scene.backdrop.h} preserveAspectRatio="none" /> : null}
      {scene.under.map((n, i) => (
        <SceneNodeView key={i} node={n} />
      ))}
      {scene.items.map((it) => {
        const selected = it.id === selectedId;
        const conflict = conflictIds.includes(it.id);
        const hit = it.nodes.find((n) => n.role === "hit");
        const half = hit && hit.t === "rect" ? Math.max(hit.w, hit.h) / 2 : 22;
        const extra = itemProps?.(it.id);
        return (
          <g key={it.id} data-item={it.id} opacity={awayIds.includes(it.id) ? 0.3 : undefined} {...extra}>
            {it.nodes.map((n, i) =>
              n.role === "label" && !it.known ? (
                <text key={i} x={n.t === "text" ? n.x : 0} y={n.t === "text" ? n.y : 0} textAnchor="middle" data-role="unknown-label">
                  ?
                </text>
              ) : (
                <SceneNodeView key={i} node={n} selected={selected} conflict={conflict} />
              ),
            )}
            {selected ? <circle cx={it.cx} cy={it.cy} r={half + 4} data-role="halo" /> : null}
            {mineIds.includes(it.id) ? <circle cx={it.cx} cy={it.cy} r={half + 3} data-role="mine" /> : null}
            {conflict ? (
              <>
                {/* never colour alone: a mark with "!" on every item that takes part in a problem */}
                <circle cx={it.cx + half * 0.7} cy={it.cy - half * 0.7} r={7} data-role="conflict-badge" />
                <text x={it.cx + half * 0.7} y={it.cy - half * 0.7 + 3.5} textAnchor="middle" data-role="conflict-mark">
                  !
                </text>
              </>
            ) : null}
          </g>
        );
      })}
      {scene.pois.map((p) => (
        <g key={p.id}>
          {p.nodes.map((n, i) => (
            <SceneNodeView key={i} node={n} />
          ))}
        </g>
      ))}
      {scene.over.map((n, i) => (
        <SceneNodeView key={i} node={n} />
      ))}
      {children}
    </svg>
  );
}
