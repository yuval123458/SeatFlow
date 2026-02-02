import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createVenue, generateVenueSeats } from "../lib/api";

const CATEGORIES = [
  "Convention",
  "Stadium",
  "Theater",
  "Synagogue",
  "EventHall",
  "Airplane",
  "Other",
];

export default function CreateVenuePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    location: "",
    category: "Other",
    status: "active",
  });

  const [zones, setZones] = useState([
    { zone: "VIP", rows: 1, seatsPerRow: 1 },
  ]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const totalSeats = useMemo(() => {
    return zones.reduce(
      (sum, z) => sum + (Number(z.rows) || 0) * (Number(z.seatsPerRow) || 0),
      0,
    );
  }, [zones]);

  const submit = async () => {
    if (!form.name.trim()) return setErr("Name is required");
    if (!form.location.trim()) return setErr("Location is required");

    if (!zones.length) return setErr("Add at least one zone");
    for (const z of zones) {
      if (!String(z.zone || "").trim())
        return setErr("Each zone must have a name (e.g. VIP)");
      if (!Number.isFinite(Number(z.rows)) || Number(z.rows) < 1)
        return setErr("Rows must be >= 1");
      if (!Number.isFinite(Number(z.seatsPerRow)) || Number(z.seatsPerRow) < 1)
        return setErr("Seats per row must be >= 1");
    }

    setErr("");
    setSaving(true);
    try {
      // 1) Create venue
      const venue = await createVenue({
        name: form.name.trim(),
        location: form.location.trim(),
        category: form.category || "Other",
        status: form.status || "active",
      });

      // 2) Generate seats
      await generateVenueSeats(venue.id, {
        zones: zones.map((z) => ({
          zone: String(z.zone).trim(),
          rows: Number(z.rows),
          seats_per_row: Number(z.seatsPerRow),
        })),
      });

      navigate("/venues");
    } catch (e) {
      setErr(e?.message || "Failed to create venue");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6">
      <div className="max-w-[720px] mx-auto bg-white rounded shadow-sm p-6 space-y-4">
        <h1 className="text-xl font-semibold">Create Venue</h1>
        {err && <div className="text-sm text-red-600">{err}</div>}

        <label className="block">
          <span className="text-sm">Name</span>
          <input
            className="mt-1 w-full border rounded px-3 py-2"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="text-sm">Location</span>
          <input
            className="mt-1 w-full border rounded px-3 py-2"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="text-sm">Category</span>
          <select
            className="mt-1 w-full border rounded px-3 py-2"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm">Status</span>
          <select
            className="mt-1 w-full border rounded px-3 py-2"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>

        <div className="pt-2 border-t">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Seat generation</h2>
            <div className="text-sm text-slate-600">
              Total seats: {totalSeats}
            </div>
          </div>

          <div className="space-y-3 mt-3">
            {zones.map((z, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 gap-2 items-end border rounded p-3"
              >
                <label className="col-span-4">
                  <span className="text-xs text-slate-600">Zone</span>
                  <input
                    className="mt-1 w-full border rounded px-2 py-2"
                    value={z.zone}
                    onChange={(e) => {
                      const next = [...zones];
                      next[idx] = { ...next[idx], zone: e.target.value };
                      setZones(next);
                    }}
                    placeholder="VIP"
                  />
                </label>

                <label className="col-span-3">
                  <span className="text-xs text-slate-600">Rows</span>
                  <input
                    type="number"
                    min="1"
                    className="mt-1 w-full border rounded px-2 py-2"
                    value={z.rows}
                    onChange={(e) => {
                      const next = [...zones];
                      next[idx] = {
                        ...next[idx],
                        rows: Number(e.target.value),
                      };
                      setZones(next);
                    }}
                  />
                </label>

                <label className="col-span-3">
                  <span className="text-xs text-slate-600">Seats / row</span>
                  <input
                    type="number"
                    min="1"
                    className="mt-1 w-full border rounded px-2 py-2"
                    value={z.seatsPerRow}
                    onChange={(e) => {
                      const next = [...zones];
                      next[idx] = {
                        ...next[idx],
                        seatsPerRow: Number(e.target.value),
                      };
                      setZones(next);
                    }}
                  />
                </label>

                <div className="col-span-2 flex justify-end">
                  <button
                    className="px-3 py-2 rounded border"
                    type="button"
                    onClick={() => setZones(zones.filter((_, i) => i !== idx))}
                    disabled={zones.length === 1}
                    title={
                      zones.length === 1
                        ? "Keep at least one zone"
                        : "Remove zone"
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="px-3 py-2 rounded border"
              onClick={() =>
                setZones([
                  ...zones,
                  { zone: "General", rows: 1, seatsPerRow: 1 },
                ])
              }
            >
              Add zone
            </button>
          </div>
        </div>

        <div className="pt-2">
          <button
            className="px-4 py-2 rounded bg-[#1E3A8A] text-white disabled:opacity-60"
            onClick={submit}
            disabled={saving}
          >
            {saving ? "Saving…" : "Create venue & generate seats"}
          </button>
        </div>
      </div>
    </div>
  );
}
