import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getVenues, createEvent } from "../lib/api";

export default function CreateEventPage() {
  const navigate = useNavigate();
  const [venues, setVenues] = useState([]);
  const [form, setForm] = useState({
    name: "",
    venue_id: "",
    event_date: "",
    status: "draft",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    getVenues()
      .then(setVenues)
      .catch(() => setVenues([]));
  }, []);

  const submit = async () => {
    if (!form.name.trim() || !form.venue_id) {
      setErr("Name and venue are required");
      return;
    }
    setErr("");
    setSaving(true);
    try {
      const ev = await createEvent({
        name: form.name.trim(),
        venue_id: Number(form.venue_id),
        event_date: form.event_date || undefined, // ISO date
        status: form.status || "draft",
      });
      navigate(`/events/${ev.id}`);
    } catch (e) {
      setErr(e?.message || "Failed to create event");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6">
      <div className="max-w-[720px] mx-auto bg-white rounded shadow-sm p-6 space-y-4">
        <h1 className="text-xl font-semibold">Create Event</h1>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <label className="block">
          <span className="text-sm">Event name</span>
          <input
            className="mt-1 w-full border rounded px-3 py-2"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-sm">Venue</span>
          <select
            className="mt-1 w-full border rounded px-3 py-2"
            value={form.venue_id}
            onChange={(e) => setForm({ ...form, venue_id: e.target.value })}
          >
            <option value="">Select venue…</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm">Event date (optional)</span>
          <input
            type="date"
            className="mt-1 w-full border rounded px-3 py-2"
            value={form.event_date}
            onChange={(e) => setForm({ ...form, event_date: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-sm">Status</span>
          <select
            className="mt-1 w-full border rounded px-3 py-2"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </label>
        <div className="pt-2">
          <button
            className="px-4 py-2 rounded bg-[#1E3A8A] text-white"
            onClick={submit}
            disabled={saving}
          >
            {saving ? "Saving…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
