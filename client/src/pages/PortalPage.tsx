import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getPortal, submitPortal } from "../lib/api";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";

export default function PortalPage() {
  const { token } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [form, setForm] = useState({
    preferred_zone: "",
    wants_aisle: false,
    needs_accessible: false,
  });

  const [guests, setGuests] = useState<
    {
      first_name: string;
      last_name?: string;
      phone?: string;

      // NEW
      gender?: string;

      preferred_zone?: string;
      wants_aisle?: boolean;
      needs_accessible?: boolean;
    }[]
  >([]);

  useEffect(() => {
    if (!token) return;

    getPortal(token)
      .then((d) => {
        setData(d);

        setForm({
          preferred_zone: d.preferred_zone || "",
          wants_aisle: Boolean(d.wants_aisle),
          needs_accessible: Boolean(d.needs_accessible),
        });

        const gs = Array.isArray(d.guests) ? d.guests : [];
        setGuests(
          gs.map((g: any) => ({
            first_name: g.first_name || "",
            last_name: g.last_name || "",
            phone: g.phone || "",

            // NEW
            gender: g.gender || "",
            preferred_zone: g.preferred_zone || "",
            wants_aisle: Boolean(g.wants_aisle),
            needs_accessible: Boolean(g.needs_accessible),
          })),
        );
      })
      .catch(() => setErr("Link not found"))
      .finally(() => setLoading(false));
  }, [token]);

  const onSubmit = async () => {
    if (!token) return;

    // NEW: require gender for all guests
    const missingGender = guests.some((g) => !String(g.gender || "").trim());
    if (missingGender) {
      setErr("Please select gender (Male/Female) for all guests.");
      return;
    }

    setSaving(true);
    setErr("");
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

          // gender is required (M/F)
          gender: g.gender,

          preferred_zone: g.preferred_zone || null,
          preferred_seat_code: null,
          wants_aisle: g.wants_aisle ? 1 : 0,
          needs_accessible: g.needs_accessible ? 1 : 0,
        })),
      });

      setSaveMsg("Saved");
    } catch (e: any) {
      setErr(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const zoneOptions = useMemo<string[]>(() => {
    const zs = Array.isArray(data?.zones) ? data.zones : [];
    return zs
      .map((z: any) => String(z))
      .map((z: any) => z.trim())
      .filter(Boolean);
  }, [data]);

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-600">{err}</div>;

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

          {/* Optional: show assigned seat read-only if server provides it */}
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

          <div className="space-y-3">
            <label className="block">
              <span className="text-sm text-[#0B1220]">Preferred zone</span>
              <select
                className="mt-1 w-full border rounded px-3 py-2 bg-white"
                value={form.preferred_zone}
                onChange={(e) =>
                  setForm({ ...form, preferred_zone: e.target.value })
                }
                disabled={zoneOptions.length === 0}
              >
                <option value="">No preference</option>
                {zoneOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>

            {/* Removed: Preferred seat code input */}

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
                <div key={i} className="border rounded p-3 mb-3 bg-white">
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    <input
                      className="border rounded px-2 py-1"
                      placeholder="First name"
                      value={g.first_name}
                      onChange={(e) => {
                        const copy = [...guests];
                        copy[i].first_name = e.target.value;
                        setGuests(copy);
                      }}
                    />
                    <input
                      className="border rounded px-2 py-1"
                      placeholder="Last name"
                      value={g.last_name || ""}
                      onChange={(e) => {
                        const copy = [...guests];
                        copy[i].last_name = e.target.value;
                        setGuests(copy);
                      }}
                    />
                    <input
                      className="border rounded px-2 py-1"
                      placeholder="Phone (optional)"
                      value={g.phone || ""}
                      onChange={(e) => {
                        const copy = [...guests];
                        copy[i].phone = e.target.value;
                        setGuests(copy);
                      }}
                    />

                    {/* Gender (Male/Female only) */}
                    <select
                      className="border rounded px-2 py-1 bg-white"
                      value={g.gender || ""}
                      onChange={(e) => {
                        const copy = [...guests];
                        copy[i].gender = e.target.value;
                        setGuests(copy);
                      }}
                    >
                      <option value="" disabled>
                        Gender
                      </option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs text-[#64748B]">
                        Preferred zone
                      </span>
                      <select
                        className="mt-1 w-full border rounded px-2 py-1 bg-white"
                        value={g.preferred_zone || ""}
                        onChange={(e) => {
                          const copy = [...guests];
                          copy[i].preferred_zone = e.target.value;
                          setGuests(copy);
                        }}
                        disabled={zoneOptions.length === 0}
                      >
                        <option value="">No preference</option>
                        {zoneOptions.map((z) => (
                          <option key={z} value={z}>
                            {z}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(g.wants_aisle)}
                          onChange={(e) => {
                            const copy = [...guests];
                            copy[i].wants_aisle = e.target.checked;
                            setGuests(copy);
                          }}
                        />
                        <span className="text-sm">Wants aisle</span>
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(g.needs_accessible)}
                          onChange={(e) => {
                            const copy = [...guests];
                            copy[i].needs_accessible = e.target.checked;
                            setGuests(copy);
                          }}
                        />
                        <span className="text-sm">Needs accessible seat</span>
                      </label>
                    </div>
                  </div>
                </div>
              ))}

              <Button
                variant="secondary"
                onClick={() =>
                  setGuests([
                    ...guests,
                    {
                      first_name: "",
                      last_name: "",
                      phone: "",
                      gender: "", // <-- keep empty so "Gender" shows
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
