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

  // Visual helpers
  showFront?: boolean;
  frontLabel?: string;

  // NEW: make it look like the Figma grid
  seatShape?: "circle" | "square";
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function SeatMapSvg({
  seats,
  issueSeatIds,
  selectedSeatId,
  onSeatClick,
  showFront = true,
  frontLabel = "Front / Stage",
  seatShape = "circle",
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
    return clamp(minNN * 0.35, 3.5, 12);
  }, [pts]);

  const fill = (s: SeatMapSeat) => {
    if (s.is_blocked === 1) return "#94A3B8"; // blocked
    if (s.assignment) return "#F59E0B"; // occupied (orange)
    return "#E2E8F0"; // vacant
  };

  const stroke = (s: SeatMapSeat) => {
    if (selectedSeatId === s.id) return "#06B6D4";
    if (issueSeatIds?.has(s.id)) return "#DC2626";
    return "#CBD5E1";
  };

  if (pts.length === 0) {
    return (
      <div className="text-sm text-slate-600">
        No x/y coordinates found for seats.
      </div>
    );
  }

  const stageHeight = clamp(h * 0.08, 12, 28);
  const stageY = bounds.minY - pad + 4;
  const stageX = bounds.minX - pad + 4;
  const stageW = w + pad * 2 - 8;

  const size = seatRadius * 2;

  return (
    <svg
      className="w-full h-[560px] bg-slate-50 rounded-lg border border-slate-200"
      viewBox={`${bounds.minX - pad} ${bounds.minY - pad} ${w + pad * 2} ${h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {showFront && (
        <g>
          <rect
            x={stageX}
            y={stageY}
            width={stageW}
            height={stageHeight}
            rx={6}
            fill="#0F172A"
            opacity={0.12}
          />
          <text
            x={stageX + stageW / 2}
            y={stageY + stageHeight / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={clamp(stageHeight * 0.55, 10, 14)}
            fill="#0F172A"
            opacity={0.65}
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
              rx={Math.max(2, seatRadius * 0.45)}
              fill={fill(s)}
              stroke={stroke(s)}
              strokeWidth={2}
            />
          ) : (
            <circle
              cx={Number(s.x)}
              cy={Number(s.y)}
              r={seatRadius}
              fill={fill(s)}
              stroke={stroke(s)}
              strokeWidth={2}
            />
          )}

          {/* Simple hover tooltip (browser native) */}
          <title>
            {s.code}
            {s.assignment
              ? ` • Occupied by ${s.assignment.first_name} ${s.assignment.last_name}`
              : " • Vacant"}
          </title>
        </g>
      ))}
    </svg>
  );
}
