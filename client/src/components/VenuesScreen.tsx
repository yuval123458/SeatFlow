import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { useResizeObserverWidth } from "../lib/useResizeObserverWidth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  MapPin,
  Search,
  Plus,
  Users,
  Grid3x3,
  ChevronRight,
} from "lucide-react";

import SeatMapSvg from "./SeatMapSvg";
import type { SeatMapSeat } from "./SeatMapSvg";
import { apiGet, getVenueSections, getVenueSeatMap } from "../lib/api";

export default function VenuesScreen() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [selectedVenue, setSelectedVenue] = useState<number | null>(null);
  const [venues, setVenues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sections, setSections] = useState<any[]>([]);
  const [venueSeats, setVenueSeats] = useState<SeatMapSeat[]>([]);
  const [seatmapLoading, setSeatmapLoading] = useState(false);

  const { ref: setMapWrapEl, width: wrapW } =
    useResizeObserverWidth<HTMLDivElement>();

  useEffect(() => {
    setLoading(true);
    apiGet("/venues")
      .then((data) => {
        const rows = (data as any[]) ?? [];
        setVenues(rows);
        setLoading(false);
        if (rows.length > 0) setSelectedVenue(Number(rows[0].id));
      })
      .catch(() => {
        setError("Failed to load venues");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedVenue) return;
    getVenueSections(Number(selectedVenue))
      .then((data) => setSections((data as any[]) ?? []))
      .catch(() => setSections([]));
  }, [selectedVenue]);

  useEffect(() => {
    if (!selectedVenue) return;

    setSeatmapLoading(true);
    getVenueSeatMap(Number(selectedVenue))
      .then((data: SeatMapSeat[]) =>
        setVenueSeats(data as unknown as SeatMapSeat[]),
      )
      .catch(() => setVenueSeats([]))
      .finally(() => setSeatmapLoading(false));
  }, [selectedVenue]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of venues) {
      const c = (v?.category ?? "").trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [venues]);

  const filteredVenues = venues.filter((venue) => {
    const nameOk = (venue.name ?? "")
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const categoryOk =
      filterCategory === "all"
        ? true
        : (venue.category ?? "") === filterCategory;
    return nameOk && categoryOk;
  });

  const venueDetails = venues.find((v) => v.id === selectedVenue);

  const viewMetrics = useMemo(() => {
    const pts = venueSeats.filter((s) => s.x != null && s.y != null) as Array<
      SeatMapSeat & { x: number; y: number }
    >;

    if (pts.length === 0) return { viewW: 100, viewH: 100 };

    const xs = pts.map((s) => Number(s.x));
    const ys = pts.map((s) => Number(s.y));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const pad = 20;

    const stageHeight = Math.max(10, Math.min(h * 0.04, 16));
    const stageGap = 10;
    const extraTop = stageHeight + stageGap;

    return {
      viewW: w + pad * 2,
      viewH: h + pad * 2 + extraTop,
    };
  }, [venueSeats]);

  const fittedHeight = useMemo(() => {
    if (!wrapW || viewMetrics.viewW <= 0) return 560;
    const h = Math.round((viewMetrics.viewH / viewMetrics.viewW) * wrapW);
    return Math.max(560, h);
  }, [wrapW, viewMetrics]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-6 lg:p-8">
      <div className="max-w-[1440px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-[#0B1220]">Venues</h1>
            <p className="text-[#64748B] mt-1">
              Manage your event venues and seating layouts
            </p>
          </div>
          <Button
            className="bg-[#1E3A8A] hover:bg-[#2563EB] gap-2 w-full sm:w-auto"
            onClick={() => navigate("/venues/new")}
          >
            <Plus className="h-4 w-4" />
            Create Venue
          </Button>
        </div>

        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        {loading ? (
          <div className="text-sm text-[#64748B]">Loading…</div>
        ) : null}

        {/* Filters */}
        <Card className="p-4 bg-white shadow-sm">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
              <Input
                placeholder="Search venues..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Venues List */}
          <div className="lg:col-span-1 space-y-4">
            <h2 className="text-lg font-semibold text-[#0B1220]">
              {filteredVenues.length} Venue
              {filteredVenues.length !== 1 ? "s" : ""}
            </h2>
            <div className="space-y-3 max-h-[800px] overflow-y-auto">
              {filteredVenues.map((venue) => (
                <Card
                  key={venue.id}
                  className={`p-4 cursor-pointer transition-all hover:shadow-md ${
                    selectedVenue === venue.id
                      ? "bg-[#DBEAFE] border-[#1E3A8A] shadow-sm"
                      : "bg-white"
                  }`}
                  onClick={() => setSelectedVenue(Number(venue.id))}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-3xl">🏟️</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-[#0B1220] truncate">
                          {venue.name}
                        </h3>
                        <Badge className="bg-[#DCFCE7] text-[#16A34A] hover:bg-[#DCFCE7] flex-shrink-0">
                          {venue.status ?? "Active"}
                        </Badge>
                      </div>
                      <p className="text-sm text-[#64748B] flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {venue.location ?? "—"}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-[#64748B]">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {venue.seat_count ?? 0}
                        </span>
                        <span className="flex items-center gap-1">
                          <Grid3x3 className="h-3 w-3" />
                          {venue.zones_count ?? 0} sections
                        </span>
                      </div>
                    </div>
                    <ChevronRight
                      className={`h-5 w-5 text-[#64748B] flex-shrink-0 ${
                        selectedVenue === venue.id ? "text-[#1E3A8A]" : ""
                      }`}
                    />
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {/* Venue Details */}
          <div className="lg:col-span-2 space-y-4">
            {venueDetails ? (
              <>
                <Card className="p-6 bg-white shadow-sm">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-4xl">🏟️</span>
                        <div>
                          <h2 className="text-2xl font-semibold text-[#0B1220]">
                            {venueDetails.name}
                          </h2>
                          <p className="text-[#64748B] flex items-center gap-1">
                            <MapPin className="h-4 w-4" />
                            {venueDetails?.location ?? "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-[#F8FAFC] rounded-lg">
                      <p className="text-xs text-[#64748B] mb-1">
                        Total Capacity
                      </p>
                      <p className="text-xl font-semibold text-[#0B1220]">
                        {venueDetails?.seat_count ?? 0}
                      </p>
                    </div>
                    <div className="p-4 bg-[#F8FAFC] rounded-lg">
                      <p className="text-xs text-[#64748B] mb-1">Sections</p>
                      <p className="text-xl font-semibold text-[#0B1220]">
                        {venueDetails?.zones_count ?? 0}
                      </p>
                    </div>
                    <div className="p-4 bg-[#F8FAFC] rounded-lg">
                      <p className="text-xs text-[#64748B] mb-1">Zones</p>
                      <p className="text-xl font-semibold text-[#0B1220]">
                        {venueDetails?.zones_count ?? 0}
                      </p>
                    </div>
                    <div className="p-4 bg-[#F8FAFC] rounded-lg">
                      <p className="text-xs text-[#64748B] mb-1">Category</p>
                      <p className="text-xl font-semibold text-[#0B1220]">
                        {venueDetails?.category ?? "—"}
                      </p>
                    </div>
                  </div>
                </Card>

                {/* Sections */}
                <Card className="p-6 bg-white shadow-sm">
                  <h3 className="text-lg font-semibold text-[#0B1220] mb-4">
                    Sections & Zones
                  </h3>
                  <div className="space-y-2">
                    {sections.map((section) => (
                      <div
                        key={section.zone}
                        className="flex items-center justify-between p-3 bg-[#F8FAFC] rounded-lg hover:bg-[#F1F5F9] transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-[#1E3A8A] to-[#06B6D4] rounded-lg flex items-center justify-center text-white font-bold">
                            {section.rows_count}
                          </div>
                          <div>
                            <p className="font-medium text-[#0B1220]">
                              {section.zone}
                            </p>
                            <p className="text-sm text-[#64748B]">
                              {section.seat_count} seats
                              {section.accessible_count
                                ? ` • ${section.accessible_count} accessible`
                                : ""}
                              {section.blocked_count
                                ? ` • ${section.blocked_count} blocked`
                                : ""}
                            </p>
                          </div>
                        </div>
                        <Badge className="bg-[#F1F5F9] text-[#64748B] hover:bg-[#F1F5F9]">
                          {section.rows_count} rows
                        </Badge>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Seat Map Preview */}
                <Card className="p-6 bg-white shadow-sm">
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-[#0B1220]">
                      Seat Map Preview
                    </h3>
                    {seatmapLoading ? (
                      <div className="text-sm text-[#64748B] mt-1">
                        Loading seat map…
                      </div>
                    ) : null}
                  </div>

                  <div
                    ref={setMapWrapEl}
                    className="rounded-lg border border-slate-200 bg-white overflow-y-auto overflow-x-hidden"
                    style={{ height: 520 }}
                  >
                    <SeatMapSvg
                      seats={venueSeats}
                      issueSeatIds={new Set()}
                      selectedSeatId={null}
                      onSeatClick={undefined}
                      showFront={true}
                      frontLabel="Stage"
                      seatShape="square"
                      heightPx={fittedHeight}
                      className="border-0 rounded-none bg-white"
                    />
                  </div>
                </Card>
              </>
            ) : (
              <Card className="p-12 bg-white shadow-sm text-center">
                <p className="text-[#64748B]">Select a venue to view details</p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
