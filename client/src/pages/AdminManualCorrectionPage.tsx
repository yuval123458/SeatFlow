import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import SeatMapSvg, { type SeatMapSeat } from "../components/SeatMapSvg";

import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Search,
  User,
  MapPin,
  Move,
  AlertCircle,
  RotateCw,
} from "lucide-react";

import {
  getEventSeatMap,
  getEventIssues,
  getEventParticipants,
  moveAssignment,
  clearAssignment,
} from "../lib/api";

type ViewMode = "loading" | "empty" | "normal";

export default function AdminManualCorrectionPage() {
  const { eventId } = useParams();

  const [seatMap, setSeatMap] = useState<SeatMapSeat[]>([]);
  const [issues, setIssues] = useState<any>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [selectedPrefId, setSelectedPrefId] = useState<number | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<number | null>(null);

  const [zoomLevel, setZoomLevel] = useState(100);
  const [filterZone, setFilterZone] = useState<string>("all");
  const [searchText, setSearchText] = useState("");

  const refresh = async () => {
    if (!eventId) return;
    setLoading(true);
    setError("");
    try {
      const [sm, is, ps] = await Promise.all([
        getEventSeatMap(eventId),
        getEventIssues(eventId),
        getEventParticipants(Number(eventId)),
      ]);
      setSeatMap(sm || []);
      setIssues(is || null);
      setParticipants(ps || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load correction data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const viewMode: ViewMode = useMemo(() => {
    if (loading) return "loading";
    if (!seatMap || seatMap.length === 0) return "empty";
    return "normal";
  }, [loading, seatMap]);

  const issueSeatIds = useMemo(() => {
    const s = new Set<number>();
    for (const x of issues?.blocked_assignments ?? []) s.add(Number(x.seat_id));
    for (const x of issues?.accessibility_violations ?? [])
      s.add(Number(x.seat_id));
    for (const x of issues?.seat_conflicts ?? []) s.add(Number(x.seat_id));
    return s;
  }, [issues]);

  const zones = useMemo(() => {
    const z = new Set<string>();
    for (const seat of seatMap) {
      const v = (seat as any)?.zone;
      if (v) z.add(String(v));
    }
    return Array.from(z).sort((a, b) => a.localeCompare(b));
  }, [seatMap]);

  const filteredSeats = useMemo(() => {
    let seats = seatMap;

    if (filterZone !== "all") {
      seats = seats.filter(
        (s) => String((s as any)?.zone ?? "") === filterZone,
      );
    }

    return seats;
  }, [seatMap, filterZone]);

  const selectedSeatData = useMemo(
    () => filteredSeats.find((s) => s.id === selectedSeatId) || null,
    [filteredSeats, selectedSeatId],
  );

  const unassigned = useMemo(
    () => (participants || []).filter((p: any) => !p?.assigned_seat_code),
    [participants],
  );

  const filteredUnassigned = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return unassigned;
    return unassigned.filter((p: any) => {
      const name = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.toLowerCase();
      const phone = `${p?.phone ?? ""}`.toLowerCase();
      return (
        name.includes(q) ||
        phone.includes(q) ||
        String(p?.preference_id ?? "").includes(q)
      );
    });
  }, [unassigned, searchText]);

  const selectedPref = useMemo(
    () =>
      (participants || []).find(
        (p: any) => p?.preference_id === selectedPrefId,
      ) || null,
    [participants, selectedPrefId],
  );

  const seatSummary = useMemo(() => {
    const total = seatMap.length;
    const blocked = seatMap.filter((s) => s.is_blocked === 1).length;
    const assigned = seatMap.filter((s) => !!s.assignment).length;
    const available = total - blocked - assigned;
    return { total, available, assigned, blocked };
  }, [seatMap]);

  const handleZoomIn = () => setZoomLevel((z) => Math.min(z + 10, 150));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(z - 10, 50));

  const doAssign = async () => {
    if (!eventId || !selectedPrefId || !selectedSeatId) return;

    const seat = seatMap.find((s) => s.id === selectedSeatId);
    if (!seat) return;

    if (seat.is_blocked === 1) {
      setError("This seat is blocked.");
      return;
    }

    if (seat.assignment) {
      setError(
        "This seat is already assigned. Pick a free seat (or clear/move first).",
      );
      return;
    }

    // Optional UI guard: accessible requirement
    const needsAcc = Number(selectedPref?.needs_accessible ?? 0) === 1;
    if (needsAcc && seat.is_accessible !== 1) {
      setError("This member requires an accessible seat.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await moveAssignment(eventId, selectedPrefId, selectedSeatId);
      setSelectedPrefId(null);
      setSelectedSeatId(null);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Assign failed");
    } finally {
      setLoading(false);
    }
  };

  const doClear = async () => {
    if (!eventId || !selectedPrefId) return;
    setLoading(true);
    setError("");
    try {
      await clearAssignment(eventId, selectedPrefId);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Clear failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-6 lg:p-8">
      <div className="max-w-[1440px] mx-auto space-y-6">
        {/* Header (Figma-style) */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-[#0B1220]">Seat Map</h1>
            <p className="text-[#64748B] mt-1">
              Event #{eventId} • Unassigned:{" "}
              {issues?.summary?.unassigned ?? unassigned.length ?? 0}
            </p>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <Select value={filterZone} onValueChange={setFilterZone}>
              <SelectTrigger className="w-44 bg-white">
                <SelectValue placeholder="Filter by zone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Zones</SelectItem>
                {zones.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="secondary"
              className="gap-2"
              onClick={refresh}
              disabled={loading}
            >
              <RotateCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <Card className="p-4 bg-[#FEE2E2] border border-[#FCA5A5]">
            <div className="flex items-start gap-2 text-sm text-[#7F1D1D]">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <div>{error}</div>
            </div>
          </Card>
        )}

        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Seat Map */}
          <div className="lg:col-span-3">
            <Card className="p-6 bg-white shadow-sm">
              {/* Controls (Figma-style) */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleZoomOut}
                    disabled={viewMode !== "normal"}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-[#64748B] min-w-[60px] text-center">
                    {zoomLevel}%
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleZoomIn}
                    disabled={viewMode !== "normal"}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex gap-2 items-center">
                  <Badge className="bg-[#F1F5F9] text-[#64748B] hover:bg-[#F1F5F9]">
                    Issues:{" "}
                    {(issues?.summary?.seat_conflicts ?? 0) +
                      (issues?.summary?.blocked_assignments ?? 0) +
                      (issues?.summary?.accessibility_violations ?? 0)}
                  </Badge>
                  <Button variant="secondary" size="sm" disabled>
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Stage (single source of truth; no duplicate inside SVG) */}
              <div className="mb-6">
                <div className="h-16 bg-gradient-to-b from-[#1E3A8A] to-[#06B6D4] rounded-lg flex items-center justify-center text-white font-semibold">
                  STAGE
                </div>
              </div>

              {/* Loading / Empty / Normal */}
              {viewMode === "loading" && (
                <div className="py-20 text-center">
                  <div className="inline-flex items-center gap-3 text-[#64748B]">
                    <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#06B6D4] rounded-full animate-spin" />
                    <span>Loading seat map...</span>
                  </div>
                </div>
              )}

              {viewMode === "empty" && (
                <div className="py-20 text-center">
                  <div className="w-16 h-16 bg-[#F1F5F9] rounded-full flex items-center justify-center mx-auto mb-4">
                    <MapPin className="h-8 w-8 text-[#64748B]" />
                  </div>
                  <h3 className="font-semibold text-[#0B1220] mb-2">
                    No seat map configured
                  </h3>
                  <p className="text-sm text-[#64748B] mb-6">
                    Add seats (with x/y) to render the hall.
                  </p>
                </div>
              )}

              {viewMode === "normal" && (
                <div
                  className="overflow-auto bg-[#F8FAFC] rounded-lg p-6"
                  style={{
                    transform: `scale(${zoomLevel / 100})`,
                    transformOrigin: "top left",
                  }}
                >
                  <SeatMapSvg
                    seats={filteredSeats}
                    issueSeatIds={issueSeatIds}
                    selectedSeatId={selectedSeatId}
                    onSeatClick={(s) => {
                      setSelectedSeatId(s.id);

                      // If the seat is occupied, select that person for moving
                      if (s.assignment?.preference_id) {
                        setSelectedPrefId(s.assignment.preference_id);
                      }
                    }}
                    showFront={false} // <-- removes the second "front" marker
                    seatShape="square"
                  />
                </div>
              )}

              {/* Legend */}
              {viewMode === "normal" && (
                <div className="flex flex-wrap gap-4 mt-6 pt-6 border-t border-[#E2E8F0]">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-[#E2E8F0] rounded" />
                    <span className="text-sm text-[#64748B]">Available</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-[#16A34A] rounded" />
                    <span className="text-sm text-[#64748B]">Assigned</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-[#94A3B8] rounded" />
                    <span className="text-sm text-[#64748B]">Blocked</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-[#E2E8F0] rounded ring-2 ring-[#DC2626]" />
                    <span className="text-sm text-[#64748B]">Issue</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">♿</span>
                    <span className="text-sm text-[#64748B]">Accessible</span>
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Right panel (Seat details + manual correction controls) */}
          <div className="space-y-4">
            {/* Seat Details (Figma-style) */}
            {selectedSeatData ? (
              <Card className="p-6 bg-white shadow-sm">
                <h2 className="text-lg font-semibold text-[#0B1220] mb-4">
                  Seat Details
                </h2>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-[#64748B] mb-1">Seat Code</p>
                    <p className="text-xl font-mono font-bold text-[#1E3A8A]">
                      {selectedSeatData.code}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-[#64748B] mb-1">Zone</p>
                    <Badge className="bg-[#F1F5F9] text-[#64748B] hover:bg-[#F1F5F9]">
                      {(selectedSeatData as any)?.zone ?? "—"}
                    </Badge>
                  </div>

                  <div>
                    <p className="text-xs text-[#64748B] mb-1">Status</p>
                    <div className="flex items-center gap-2">
                      {selectedSeatData.is_blocked === 1 ? (
                        <Badge className="bg-[#F1F5F9] text-[#64748B] hover:bg-[#F1F5F9]">
                          Blocked
                        </Badge>
                      ) : selectedSeatData.assignment ? (
                        <Badge className="bg-[#DCFCE7] text-[#16A34A] hover:bg-[#DCFCE7]">
                          Assigned
                        </Badge>
                      ) : (
                        <Badge className="bg-[#CFFAFE] text-[#06B6D4] hover:bg-[#CFFAFE]">
                          Available
                        </Badge>
                      )}

                      {issueSeatIds.has(selectedSeatData.id) && (
                        <Badge className="bg-[#FEE2E2] text-[#DC2626] hover:bg-[#FEE2E2]">
                          Issue
                        </Badge>
                      )}

                      {selectedSeatData.is_accessible === 1 && (
                        <span className="text-sm">♿</span>
                      )}
                    </div>
                  </div>

                  {selectedSeatData.assignment && (
                    <div className="p-3 bg-[#F8FAFC] rounded-lg">
                      <p className="text-xs text-[#64748B] mb-1">Assigned To</p>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-[#1E3A8A] rounded-full flex items-center justify-center">
                          <User className="h-4 w-4 text-white" />
                        </div>
                        <p className="font-medium text-[#0B1220]">
                          {selectedSeatData.assignment.first_name}{" "}
                          {selectedSeatData.assignment.last_name}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            ) : (
              <Card className="p-12 bg-white shadow-sm text-center">
                <div className="w-12 h-12 bg-[#F1F5F9] rounded-full flex items-center justify-center mx-auto mb-3">
                  <MapPin className="h-6 w-6 text-[#64748B]" />
                </div>
                <p className="text-sm text-[#64748B]">
                  Select a seat to view details
                </p>
              </Card>
            )}

            {/* Manual correction controls */}
            <Card className="p-6 bg-white shadow-sm">
              <h3 className="font-semibold text-[#0B1220] mb-4">
                Manual correction
              </h3>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-[#64748B]" />
                  <Input
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Search unassigned..."
                  />
                </div>

                <div className="text-xs text-[#64748B]">
                  Pick an unassigned guest, then click a seat, then assign.
                </div>

                <div className="max-h-[280px] overflow-auto space-y-2 border border-[#E2E8F0] rounded-lg p-2">
                  {filteredUnassigned.map((p: any) => (
                    <button
                      key={p.preference_id}
                      className={`w-full text-left p-2 rounded border transition-colors ${
                        selectedPrefId === p.preference_id
                          ? "border-[#06B6D4] bg-[#ECFEFF]"
                          : "border-[#E2E8F0] hover:bg-[#F8FAFC]"
                      }`}
                      onClick={() => setSelectedPrefId(p.preference_id)}
                    >
                      <div className="text-sm font-medium text-[#0B1220]">
                        {p.first_name} {p.last_name || ""}
                        {Number(p.needs_accessible ?? 0) === 1 ? " ♿" : ""}
                      </div>
                    </button>
                  ))}
                  {filteredUnassigned.length === 0 && (
                    <div className="text-sm text-[#64748B] p-2">
                      No unassigned guests.
                    </div>
                  )}
                </div>

                <div className="text-sm text-[#334155]">
                  Selected:{" "}
                  <span className="font-medium">
                    {selectedPref
                      ? `${selectedPref.first_name} ${selectedPref.last_name || ""}`.trim()
                      : "—"}
                  </span>{" "}
                  • Seat:{" "}
                  <span className="font-mono">
                    {selectedSeatData?.code ?? "—"}
                  </span>
                </div>

                <Button
                  className="w-full bg-[#1E3A8A] hover:bg-[#2563EB] gap-2"
                  onClick={doAssign}
                  disabled={!selectedPrefId || !selectedSeatId || loading}
                >
                  <Move className="h-4 w-4" />
                  Assign member to seat
                </Button>

                <Button
                  variant="secondary"
                  className="w-full whitespace-normal break-words"
                  onClick={doClear}
                  disabled={!selectedPrefId || loading}
                >
                  Clear assignment
                </Button>

                {/* REMOVED: View History button */}
              </div>
            </Card>

            {/* Summary Stats (Figma-style) */}
            <Card className="p-6 bg-gradient-to-br from-[#1E3A8A] to-[#06B6D4] text-white shadow-lg">
              <h3 className="font-semibold mb-4">Seat Summary</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm opacity-90">Total Seats</span>
                  <span className="font-bold">{seatSummary.total}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm opacity-90">Available</span>
                  <span className="font-bold">{seatSummary.available}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm opacity-90">Assigned</span>
                  <span className="font-bold">{seatSummary.assigned}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm opacity-90">Blocked</span>
                  <span className="font-bold">{seatSummary.blocked}</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
