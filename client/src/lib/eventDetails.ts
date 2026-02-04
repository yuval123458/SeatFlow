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

export function buildWarnings(issues: any | null) {
  if (!issues) return [];
  const out: Array<{
    id: string;
    severity: "error" | "warning" | "info";
    category: string;
    message: string;
    detail?: string;
  }> = [];

  const aisle = Number(issues?.summary?.aisle_mismatches ?? 0);
  if (aisle > 0) {
    out.push({
      id: "aisle-mismatches",
      severity: "warning",
      category: "Preferences",
      message: `${aisle} member(s) want aisle but are not on aisle`,
      detail: "Open Manual Correction to review swaps.",
    });
  }

  const zone = Number(issues?.summary?.zone_mismatches ?? 0);
  if (zone > 0) {
    out.push({
      id: "zone-mismatches",
      severity: "warning",
      category: "Preferences",
      message: `${zone} member(s) seated outside their preferred zone`,
      detail: "Consider zone-respecting moves.",
    });
  }

  const groupsBad = Number(issues?.summary?.groups_not_adjacent ?? 0);
  if (groupsBad > 0) {
    out.push({
      id: "groups-not-adjacent",
      severity: "warning",
      category: "Groups",
      message: `${groupsBad} group(s) not seated contiguously`,
      detail: "Aim to place each group in a single consecutive seat block.",
    });
  }

  return out;
}
