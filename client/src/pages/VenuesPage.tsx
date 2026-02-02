import React, { useState, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  MapPin,
  Search,
  Plus,
  Users,
  Grid3x3,
  ChevronRight,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { apiGet, getVenueSections } from "../lib/api";

export default function VenuesPage() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [venues, setVenues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sections, setSections] = useState<any[]>([]);

  useEffect(() => {
    setLoading(true);
    apiGet("/venues")
      .then((data) => {
        setVenues(data as any[]);
        setLoading(false);
        if ((data as any[]).length > 0) setSelectedVenue((data as any[])[0].id);
      })
      .catch((err) => {
        setError("Failed to load venues");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedVenue) return;
    getVenueSections(selectedVenue as any)
      .then((data) => setSections((data as any[]) ?? []))
      .catch(() => setSections([]));
  }, [selectedVenue]);

  const filteredVenues = venues.filter((venue) =>
    (venue.name ?? "").toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const venueDetails = venues.find((v) => v.id === selectedVenue);

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
                <SelectItem value="Convention">Convention</SelectItem>
                <SelectItem value="Stadium">Stadium</SelectItem>
                <SelectItem value="Theater">Theater</SelectItem>
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
                  onClick={() => setSelectedVenue(venue.id)}
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
                      className={`h-5 w-5 text-[#64748B] flex-shrink-0 ${selectedVenue === venue.id ? "text-[#1E3A8A]" : ""}`}
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
                    <Button variant="secondary" size="sm">
                      Edit Venue
                    </Button>
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
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-[#0B1220]">
                      Seat Map Preview
                    </h3>
                    <Button variant="ghost" size="sm">
                      Edit Layout
                    </Button>
                  </div>

                  {/* Simple Grid Representation */}
                  <div className="bg-[#F8FAFC] rounded-lg p-6">
                    <div className="mb-6">
                      <div className="h-12 bg-gradient-to-b from-[#1E3A8A] to-[#06B6D4] rounded-lg flex items-center justify-center text-white font-semibold">
                        STAGE
                      </div>
                    </div>

                    <div className="space-y-4">
                      {/* VIP Section */}
                      <div className="grid grid-cols-10 gap-2">
                        {Array.from({ length: 20 }).map((_, i) => (
                          <div
                            key={`vip-${i}`}
                            className="aspect-square bg-[#1E3A8A] rounded hover:bg-[#2563EB] cursor-pointer transition-colors"
                            title="VIP - Available"
                          />
                        ))}
                      </div>

                      {/* Premium Section */}
                      <div className="grid grid-cols-10 gap-2">
                        {Array.from({ length: 30 }).map((_, i) => (
                          <div
                            key={`premium-${i}`}
                            className={`aspect-square rounded cursor-pointer transition-colors ${
                              i % 5 === 0
                                ? "bg-[#94A3B8] cursor-not-allowed"
                                : i % 7 === 0
                                  ? "bg-[#16A34A]"
                                  : "bg-[#06B6D4] hover:bg-[#22D3EE]"
                            }`}
                            title={
                              i % 5 === 0
                                ? "Blocked"
                                : i % 7 === 0
                                  ? "Assigned"
                                  : "Premium - Available"
                            }
                          />
                        ))}
                      </div>

                      {/* General Section */}
                      <div className="grid grid-cols-10 gap-2">
                        {Array.from({ length: 40 }).map((_, i) => (
                          <div
                            key={`general-${i}`}
                            className={`aspect-square rounded cursor-pointer transition-colors ${
                              i % 6 === 0
                                ? "bg-[#94A3B8] cursor-not-allowed"
                                : i % 4 === 0
                                  ? "bg-[#16A34A]"
                                  : "bg-[#E2E8F0] hover:bg-[#CBD5E1]"
                            }`}
                            title={
                              i % 6 === 0
                                ? "Blocked"
                                : i % 4 === 0
                                  ? "Assigned"
                                  : "General - Available"
                            }
                          />
                        ))}
                      </div>
                    </div>

                    {/* Legend */}
                    <div className="flex flex-wrap gap-4 mt-6 pt-6 border-t border-[#E2E8F0]">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-[#E2E8F0] rounded"></div>
                        <span className="text-sm text-[#64748B]">
                          Available
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-[#16A34A] rounded"></div>
                        <span className="text-sm text-[#64748B]">Assigned</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-[#94A3B8] rounded"></div>
                        <span className="text-sm text-[#64748B]">Blocked</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-[#1E3A8A] rounded"></div>
                        <span className="text-sm text-[#64748B]">VIP</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-[#06B6D4] rounded"></div>
                        <span className="text-sm text-[#64748B]">Premium</span>
                      </div>
                    </div>
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
