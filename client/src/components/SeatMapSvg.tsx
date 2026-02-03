import React, { useMemo } from "react";

export type SeatMapSeat = {
  id: number;
  code: string;
  x: number | null;
  y: number | null;
  is_blocked: number;
  is_accessible: number;
  is_aisle: number;
  assignment: null | {
    preference_id: number;
    member_id: number;
    first_name: string;
    last_name: string;
    needs_accessible: number;
    group_code: string | null;
  };
};

type Props = {
  seats: SeatMapSeat[];
  issueSeatIds?: Set<number>;
  selectedSeatId?: number | null;
  onSeatClick?: (seat: SeatMapSeat) => void;

  showFront?: boolean;
  frontLabel?: string;
  seatShape?: "circle" | "square";

  heightPx?: number;
  widthPx?: number;
  className?: string;

  baseScale?: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function SeatMapSvg({
  seats,
  issueSeatIds,
  selectedSeatId,
  onSeatClick,
  showFront = false,
  frontLabel = "Front / Stage",
  seatShape = "circle",
  heightPx = 560,
  widthPx,
  className = "",
  baseScale = 1,
}: Props) {
  const pts = useMemo(
    () => seats.filter((s) => s.x != null && s.y != null),
    [seats],
  );

  const bounds = useMemo(() => {
    if (pts.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const xs = pts.map((s) => Number(s.x));
    const ys = pts.map((s) => Number(s.y));
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }, [pts]);

  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const pad = 20;

  const seatRadius = useMemo(() => {
    if (pts.length > 350) return 4.0;
    if (pts.length <= 1) return 10;

    let minNN = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pts.length; i++) {
      const xi = Number(pts[i].x);
      const yi = Number(pts[i].y);
      let best = Number.POSITIVE_INFINITY;
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue;
        const dx = xi - Number(pts[j].x);
        const dy = yi - Number(pts[j].y);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) best = d;
      }
      if (best < minNN) minNN = best;
    }

    if (!isFinite(minNN) || minNN <= 0) return 6;
    return clamp(minNN * 0.35, 3.0, 12);
  }, [pts]);

  const strokeWidth = useMemo(
    () => clamp(seatRadius * 0.28, 0.6, 2),
    [seatRadius],
  );
  const size = seatRadius * 2;

  const accessibleFontSize = useMemo(() => {
    const px = size * 0.95;
    return clamp(px, 8, 26);
  }, [size]);

  const showAccessibleIcon = accessibleFontSize >= 8;

  const fill = (s: SeatMapSeat) => {
    if (s.is_blocked === 1) return "#94A3B8";
    if (s.assignment) return "#16A34A";
    return "#E2E8F0";
  };

  const stroke = (s: SeatMapSeat) => {
    if (selectedSeatId === s.id) return "#06B6D4";
    if (issueSeatIds?.has(s.id)) return "#DC2626";
    if (s.is_aisle === 1) return "#7C3AED";
    if (s.is_accessible === 1) return "#0891B2";
    return "#CBD5E1";
  };

  const dash = (s: SeatMapSeat) => (s.is_aisle === 1 ? "3 2" : undefined);

  if (pts.length === 0) {
    return (
      <div className="text-sm text-slate-600">
        No x/y coordinates found for seats.
      </div>
    );
  }

  const stageHeight = clamp(h * 0.04, 10, 16);
  const stageGap = 10;
  const extraTop = showFront ? stageHeight + stageGap : 0;

  const viewMinX = bounds.minX - pad;
  const viewMinY = bounds.minY - pad - extraTop;
  const viewW = w + pad * 2;
  const viewH = h + pad * 2 + extraTop;

  const stageX = viewMinX + 6;
  const stageY = viewMinY + 6;
  const stageW = viewW - 12;

  const effectiveHeight = Math.round(heightPx * baseScale);
  const effectiveWidth =
    widthPx != null ? Math.round(widthPx * baseScale) : undefined;

  return (
    <svg
      className={`w-full block bg-slate-50 rounded-lg border border-slate-200 ${className}`}
      style={{
        height: effectiveHeight,
        width: effectiveWidth ?? "100%",
      }}
      viewBox={`${viewMinX} ${viewMinY} ${viewW} ${viewH}`}
      preserveAspectRatio="xMinYMin meet"
    >
      {showFront && (
        <g style={{ pointerEvents: "none" }}>
          <rect
            x={stageX}
            y={stageY}
            width={stageW}
            height={stageHeight}
            rx={999}
            fill="#0F172A"
            opacity={0.08}
          />
          <text
            x={stageX + stageW / 2}
            y={stageY + stageHeight / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            fill="#0F172A"
            opacity={0.5}
          >
            {frontLabel}
          </text>
        </g>
      )}

      {pts.map((s) => (
        <g
          key={s.id}
          onClick={() => s.is_blocked !== 1 && onSeatClick?.(s)}
          style={{ cursor: s.is_blocked === 1 ? "not-allowed" : "pointer" }}
        >
          {seatShape === "square" ? (
            <rect
              x={Number(s.x) - size / 2}
              y={Number(s.y) - size / 2}
              width={size}
              height={size}
              rx={Math.max(1, seatRadius * 0.35)}
              fill={fill(s)}
              stroke={stroke(s)}
              strokeWidth={strokeWidth}
              strokeDasharray={dash(s)}
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <circle
              cx={Number(s.x)}
              cy={Number(s.y)}
              r={seatRadius}
              fill={fill(s)}
              stroke={stroke(s)}
              strokeWidth={strokeWidth}
              strokeDasharray={dash(s)}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {showAccessibleIcon &&
            s.is_accessible === 1 &&
            s.is_blocked !== 1 && (
              <text
                x={Number(s.x)}
                y={Number(s.y)}
                textAnchor="middle"
                dy="0.35em"
                fontSize={accessibleFontSize}
                fill="#0B1220"
                opacity={0.92}
                pointerEvents="none"
                style={{
                  paintOrder: "stroke",
                  stroke: "#FFFFFF",
                  strokeWidth: clamp(accessibleFontSize * 0.12, 1, 2.5),
                }}
              >
                ♿
              </text>
            )}

          <title>
            {s.code}
            {s.is_aisle === 1 ? " • Aisle" : ""}
            {s.is_accessible === 1 ? " • Accessible" : ""}
            {s.assignment
              ? ` • Occupied by ${s.assignment.first_name} ${s.assignment.last_name}`
              : " • Vacant"}
          </title>
        </g>
      ))}
    </svg>
  );
}
