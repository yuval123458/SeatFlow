import { useMemo, useState } from "react";
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
] as const;

type Category = (typeof CATEGORIES)[number];

type VenueForm = {
  name: string;
  location: string;
  category: Category | string;
  status: "active" | "inactive" | string;
};

type SeatLayout = "horizontal" | "vertical";

type AccessibleSide = "start" | "end" | "both";

type ZoneForm = {
  zone: string;
  rows: number;
  seatsPerRow: number;
  aisleCsv: string;
  accessibleRowsCsv: string;
  accessiblePerRow: string;
  accessibleSide: AccessibleSide;
};

export default function CreateVenuePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<VenueForm>({
    name: "",
    location: "",
    category: "Other",
    status: "active",
  });

  const [seatLayout, setSeatLayout] = useState<SeatLayout>("vertical");
  const [zones, setZones] = useState<ZoneForm[]>([
    {
      zone: "VIP",
      rows: 1,
      seatsPerRow: 1,
      aisleCsv: "",
      accessibleRowsCsv: "",
      accessiblePerRow: "1",
      accessibleSide: "start",
    },
  ]);

  const updateZone = (idx: number, patch: Partial<ZoneForm>) => {
    setZones((prev) =>
      prev.map((z, i) => (i === idx ? { ...z, ...patch } : z)),
    );
  };

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const totalSeats = useMemo(() => {
    return zones.reduce(
      (sum, z) => sum + (Number(z.rows) || 0) * (Number(z.seatsPerRow) || 0),
      0,
    );
  }, [zones]);

  function parseCsvNumbers(s: unknown): number[] {
    return String(s || "")
      .split(",")
      .map((t) => parseInt(t.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

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
      const venue: { id: number } = await createVenue({
        name: form.name.trim(),
        location: form.location.trim(),
        category: form.category || "Other",
        status: form.status || "active",
      });

      await generateVenueSeats(venue.id, {
        layout: seatLayout,
        zones: zones.map((z) => ({
          zone: z.zone,
          rows: Number(z.rows),
          seats_per_row: Number(z.seatsPerRow),
          aisle_seat_numbers: parseCsvNumbers(z.aisleCsv),
          accessible_rows: parseCsvNumbers(z.accessibleRowsCsv),
          accessible_per_row: Math.max(
            1,
            parseInt(z.accessiblePerRow || "1", 10),
          ),
          accessible_side: z.accessibleSide,
        })),
      });

      navigate("/venues");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to create venue");
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

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-600">Zone layout</label>
              <select
                className="mt-1 w-full border rounded px-3 py-2"
                value={seatLayout}
                onChange={(e) => setSeatLayout(e.target.value as SeatLayout)}
              >
                <option value="vertical">
                  Vertical (zones behind each other)
                </option>
                <option value="horizontal">
                  Horizontal (zones side-by-side)
                </option>
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Vertical makes “General behind VIP” (further from stage).
              </p>
            </div>
          </div>

          <div className="space-y-3 mt-3">
            {zones.map((z, idx) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-600">Zone</label>
                  <input
                    className="mt-1 w-full border rounded px-2 py-2"
                    value={z.zone}
                    onChange={(e) => updateZone(idx, { zone: e.target.value })}
                    placeholder="VIP"
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-600">Rows</label>
                  <input
                    type="number"
                    min="1"
                    className="mt-1 w-full border rounded px-2 py-2"
                    value={z.rows}
                    onChange={(e) =>
                      updateZone(idx, { rows: Number(e.target.value) })
                    }
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-600">Seats / row</label>
                  <input
                    type="number"
                    min="1"
                    className="mt-1 w-full border rounded px-2 py-2"
                    value={z.seatsPerRow}
                    onChange={(e) =>
                      updateZone(idx, { seatsPerRow: Number(e.target.value) })
                    }
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-600">Aisles</label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-2"
                    placeholder="e.g. 1, 10"
                    value={z.aisleCsv || ""}
                    onChange={(e) =>
                      updateZone(idx, { aisleCsv: e.target.value })
                    }
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Comma-separated seat numbers per row to mark as aisle.
                  </p>
                </div>

                <div>
                  <label className="text-sm text-slate-600">
                    Accessible rows
                  </label>
                  <input
                    className="mt-1 w-full border rounded px-3 py-2"
                    placeholder="e.g. 1, 2, 10"
                    value={z.accessibleRowsCsv || ""}
                    onChange={(e) =>
                      updateZone(idx, { accessibleRowsCsv: e.target.value })
                    }
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Row numbers (1-based) that have accessible seats.
                  </p>
                </div>

                <div>
                  <label className="text-sm text-slate-600">
                    Accessible per row
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="mt-1 w-full border rounded px-3 py-2"
                    value={z.accessiblePerRow}
                    onChange={(e) =>
                      updateZone(idx, { accessiblePerRow: e.target.value })
                    }
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-600">
                    Accessible side
                  </label>
                  <select
                    className="mt-1 w-full border rounded px-3 py-2"
                    value={z.accessibleSide}
                    onChange={(e) =>
                      updateZone(idx, {
                        accessibleSide: e.target.value as AccessibleSide,
                      })
                    }
                  >
                    <option value="start">Start of row</option>
                    <option value="end">End of row</option>
                    <option value="both">Both ends</option>
                  </select>
                </div>

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
                  {
                    zone: "General",
                    rows: 1,
                    seatsPerRow: 1,
                    aisleCsv: "",
                    accessibleRowsCsv: "",
                    accessiblePerRow: "1",
                    accessibleSide: "start",
                  },
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
