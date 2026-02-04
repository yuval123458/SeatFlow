export type HardConstraint = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

export const hardConstraints: HardConstraint[] = [
  {
    id: "unique_seat",
    name: "Unique seat assignment",
    description: "No seat can be assigned to more than one member.",
    enabled: true,
  },
  {
    id: "accessible_for_needs",
    name: "Accessibility requirements",
    description:
      "Members who need accessibility should receive accessible seats.",
    enabled: true,
  },
  {
    id: "blocked_seats",
    name: "Blocked seats",
    description: "Never assign seats marked as blocked/unavailable.",
    enabled: true,
  },
];

export function zoneFromSeatCode(code?: string) {
  if (!code) return "—";
  const z = String(code).split("-")[0]?.trim();
  return z || "—";
}

export type AssignmentResultRow = {
  id: string | number;
  member: string;
  phone: string;
  seat: string;
  zone: string;
  satisfaction: number | null;
};

export function buildAssignmentResults(
  participants: any[],
): AssignmentResultRow[] {
  return (participants || [])
    .filter((p: any) => p?.assigned_seat_code)
    .map((p: any) => {
      const member =
        `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "—";
      const seat = p?.assigned_seat_code ?? "—";

      return {
        id: p?.preference_id ?? p?.member_id ?? seat,
        member,
        phone: p?.phone ?? "—",
        seat,
        zone: zoneFromSeatCode(seat),
        satisfaction: null,
      };
    });
}

export type WarningRow = {
  id: string;
  severity: "error" | "warning" | "info";
  category: string;
  message: string;
  detail: string;
};

export function buildWarnings(issues: any): WarningRow[] {
  const out: WarningRow[] = [];
  const s = issues?.summary;
  if (!s) return out;

  const push = (
    severity: "error" | "warning" | "info",
    category: string,
    message: string,
    detail: string,
  ) => {
    out.push({
      id: `${category}:${message}`,
      severity,
      category,
      message,
      detail,
    });
  };

  const unassignedCnt = Number(s.unassigned ?? 0);
  const seatConflictsCnt = Number(s.seat_conflicts ?? 0);
  const blockedCnt = Number(s.blocked_assignments ?? 0);

  push("warning", "Unassigned", `Unassigned: ${unassignedCnt}`, "");
  push("warning", "Seat conflicts", `Seat conflicts: ${seatConflictsCnt}`, "");
  push(
    "warning",
    "Blocked assignments",
    `Blocked assignments: ${blockedCnt}`,
    "",
  );

  return out;
}
