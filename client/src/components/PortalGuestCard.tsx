import React from "react";
import { ZoneSelect } from "./ZoneSelect";

export type PortalGuestForm = {
  first_name: string;
  last_name: string;
  phone: string;
  gender: string;
  preferred_zone: string;
  wants_aisle: boolean;
  needs_accessible: boolean;
};

type Props = {
  guest: PortalGuestForm;
  zones: string[];
  onChange(patch: Partial<PortalGuestForm>): void;
};

export function PortalGuestCard({ guest, zones, onChange }: Props) {
  return (
    <div className="border rounded p-3 mb-3 bg-white">
      <div className="grid grid-cols-4 gap-2 mb-2">
        <input
          className="border rounded px-2 py-1"
          placeholder="First name"
          value={guest.first_name}
          onChange={(e) => onChange({ first_name: e.target.value })}
        />
        <input
          className="border rounded px-2 py-1"
          placeholder="Last name"
          value={guest.last_name}
          onChange={(e) => onChange({ last_name: e.target.value })}
        />
        <input
          className="border rounded px-2 py-1"
          placeholder="Phone (optional)"
          value={guest.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
        />

        <select
          className="border rounded px-2 py-1 bg-white"
          value={guest.gender}
          onChange={(e) => onChange({ gender: e.target.value })}
        >
          <option value="" disabled>
            Gender
          </option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ZoneSelect
          size="sm"
          label="Preferred zone"
          value={guest.preferred_zone}
          zones={zones}
          onChange={(v) => onChange({ preferred_zone: v })}
        />

        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={guest.wants_aisle}
              onChange={(e) => onChange({ wants_aisle: e.target.checked })}
            />
            <span className="text-sm">Wants aisle</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={guest.needs_accessible}
              onChange={(e) => onChange({ needs_accessible: e.target.checked })}
            />
            <span className="text-sm">Needs accessible seat</span>
          </label>
        </div>
      </div>
    </div>
  );
}

export default PortalGuestCard;
