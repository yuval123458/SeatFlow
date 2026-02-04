import React from "react";

export type Props = {
  label: string;
  value: string;
  zones: string[];
  disabled?: boolean;
  onChange(value: string): void;
  size?: "md" | "sm";
};

export function ZoneSelect({
  label,
  value,
  zones,
  disabled,
  onChange,
  size = "md",
}: Props) {
  const base =
    size === "sm"
      ? "mt-1 w-full border rounded px-2 py-1 bg-white"
      : "mt-1 w-full border rounded px-3 py-2 bg-white";

  return (
    <label className="block">
      <span
        className={
          size === "sm" ? "text-xs text-[#64748B]" : "text-sm text-[#0B1220]"
        }
      >
        {label}
      </span>
      <select
        className={base}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || zones.length === 0}
      >
        <option value="">No preference</option>
        {zones.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
    </label>
  );
}
export default ZoneSelect;
