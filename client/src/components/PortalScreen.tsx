import React, { useEffect, useMemo, useState } from "react";
import { submitPortal } from "../lib/api";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import PortalGuestCard, { type PortalGuestForm } from "./PortalGuestCard";
import ZoneSelect from "./ZoneSelect";
import { usePortal } from "./usePortal";

type Props = { token?: string };

export default function PortalScreen({ token }: Props) {
  const { data, loading, loadError } = usePortal(token);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [formError, setFormError] = useState("");

  const [form, setForm] = useState({
    preferred_zone: "",
    wants_aisle: false,
    needs_accessible: false,
  });

  const [guests, setGuests] = useState<PortalGuestForm[]>([]);

  const updateGuest = (i: number, patch: Partial<PortalGuestForm>) => {
    setGuests((prev) =>
      prev.map((g, idx) => (idx === i ? { ...g, ...patch } : g)),
    );
  };

  useEffect(() => {
    if (!data) return;

    setForm({
      preferred_zone: data.preferred_zone || "",
      wants_aisle: Boolean(data.wants_aisle),
      needs_accessible: Boolean(data.needs_accessible),
    });

    const gs = Array.isArray(data.guests) ? data.guests : [];
    setGuests(
      gs.map((g: any) => ({
        first_name: g.first_name || "",
        last_name: g.last_name || "",
        phone: g.phone || "",
        gender: g.gender || "",
        preferred_zone: g.preferred_zone || "",
        wants_aisle: Boolean(g.wants_aisle),
        needs_accessible: Boolean(g.needs_accessible),
      })),
    );
  }, [data]);

  const zoneOptions = useMemo<string[]>(() => {
    const zs = Array.isArray(data?.zones) ? data.zones : [];
    return zs
      .map((z: any) => String(z))
      .map((z: string) => z.trim())
      .filter(Boolean);
  }, [data]);

  const onSubmit = async () => {
    if (!token) return;

    const missingGender = guests.some((g) => !String(g.gender || "").trim());
    if (missingGender) {
      setFormError("Please select gender (Male/Female) for all guests.");
      return;
    }

    setSaving(true);
    setFormError("");
    setSaveMsg("");

    try {
      await submitPortal(token, {
        preferred_zone: form.preferred_zone || null,
        preferred_seat_code: null,
        wants_aisle: form.wants_aisle ? 1 : 0,
        needs_accessible: form.needs_accessible ? 1 : 0,
        guests: guests.map((g) => ({
          first_name: g.first_name,
          last_name: g.last_name || null,
          phone: g.phone || null,
          gender: g.gender,
          preferred_zone: g.preferred_zone || null,
          preferred_seat_code: null,
          wants_aisle: g.wants_aisle ? 1 : 0,
          needs_accessible: g.needs_accessible ? 1 : 0,
        })),
      });

      setSaveMsg("Saved");
    } catch (e: any) {
      setFormError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">Loading…</div>;
  if (loadError) return <div className="p-6 text-red-600">{loadError}</div>;
  if (!data) return <div className="p-6 text-red-600">Link not found</div>;

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6">
      <div className="max-w-[720px] mx-auto space-y-4">
        <Card className="p-6 bg-white shadow-sm">
          <h1 className="text-xl font-semibold text-[#0B1220] mb-2">
            {data.event_name}
          </h1>
          <p className="text-sm text-[#64748B] mb-4">
            {data.member_first_name} {data.member_last_name}
          </p>

          {data.assigned_seat_code && (
            <div className="mb-4 text-sm">
              <span className="text-[#64748B]">Assigned seat: </span>
              <span className="font-mono font-semibold text-[#0B1220]">
                {data.assigned_seat_code}
              </span>
            </div>
          )}

          {saveMsg && (
            <div className="text-sm text-green-700 mb-3">{saveMsg}</div>
          )}
          {formError && (
            <div className="text-sm text-red-600 mb-3">{formError}</div>
          )}

          <div className="space-y-3">
            <ZoneSelect
              label="Preferred zone"
              value={form.preferred_zone}
              zones={zoneOptions}
              onChange={(v) => setForm({ ...form, preferred_zone: v })}
            />

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.wants_aisle}
                onChange={(e) =>
                  setForm({ ...form, wants_aisle: e.target.checked })
                }
              />
              <span className="text-sm">Wants aisle</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.needs_accessible}
                onChange={(e) =>
                  setForm({ ...form, needs_accessible: e.target.checked })
                }
              />
              <span className="text-sm">Needs accessible seat</span>
            </label>

            <div className="mt-4">
              <div className="text-sm font-medium mb-2">Guests</div>

              {guests.map((g, i) => (
                <PortalGuestCard
                  key={i}
                  guest={g}
                  zones={zoneOptions}
                  onChange={(patch) => updateGuest(i, patch)}
                />
              ))}

              <Button
                variant="secondary"
                onClick={() =>
                  setGuests((prev) => [
                    ...prev,
                    {
                      first_name: "",
                      last_name: "",
                      phone: "",
                      gender: "",
                      preferred_zone: "",
                      wants_aisle: false,
                      needs_accessible: false,
                    },
                  ])
                }
              >
                Add guest
              </Button>
            </div>

            <div className="pt-2">
              <Button onClick={onSubmit} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
