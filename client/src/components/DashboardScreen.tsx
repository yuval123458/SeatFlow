import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  Users,
  Calendar,
  TrendingUp,
  UserX,
  Plus,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { getEvents } from "../lib/api";

export default function DashboardScreen() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    getEvents()
      .then((data) => setEvents((data as any[]) ?? []))
      .catch(() => setError("Failed to load events"))
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
  };

  const activityFeed = useMemo(() => {
    const items: Array<{
      id: string;
      user: string;
      action: string;
      target: string;
      time: string;
      icon: any;
      color: string;
    }> = [];

    const sorted = [...events].sort((a, b) => {
      const da = a?.event_date ? new Date(a.event_date).getTime() : 0;
      const db = b?.event_date ? new Date(b.event_date).getTime() : 0;
      return db - da;
    });

    for (const e of sorted) {
      const total = Number(e.total_prefs ?? e.attendees_count ?? 0);
      const assigned = Number(e.assigned_count ?? 0);
      const unassigned = Math.max(total - assigned, 0);
      const status = String(e.status ?? "draft");

      if (status === "published") {
        items.push({
          id: `status:${e.id}`,
          user: "System",
          action: "marked event as published",
          target: e.name ?? "—",
          time: formatDate(e.event_date),
          icon: CheckCircle2,
          color: "text-[#16A34A]",
        });
      } else if (status === "in-progress" || status === "in_progress") {
        items.push({
          id: `status:${e.id}`,
          user: "System",
          action: "assignment is in progress",
          target: e.name ?? "—",
          time: formatDate(e.event_date),
          icon: TrendingUp,
          color: "text-[#06B6D4]",
        });
      } else {
        items.push({
          id: `status:${e.id}`,
          user: "System",
          action: "event is in draft",
          target: e.name ?? "—",
          time: formatDate(e.event_date),
          icon: AlertCircle,
          color: "text-[#64748B]",
        });
      }

      if (total > 0) {
        if (unassigned > 0) {
          items.push({
            id: `unassigned:${e.id}`,
            user: "System",
            action: "seats still unassigned",
            target: `${e.name ?? "—"} • ${unassigned}/${total} remaining`,
            time: formatDate(e.event_date),
            icon: UserX,
            color: "text-[#D97706]",
          });
        } else {
          items.push({
            id: `progress:${e.id}`,
            user: "System",
            action: "assignment completed",
            target: `${e.name ?? "—"} • ${assigned}/${total}`,
            time: formatDate(e.event_date),
            icon: CheckCircle2,
            color: "text-[#16A34A]",
          });
        }
      }

      if (items.length >= 12) break;
    }

    return items;
  }, [events]);

  const totals = events.reduce(
    (acc, e) => {
      const total = Number(e.total_prefs ?? e.attendees_count ?? 0);
      const assigned = Number(e.assigned_count ?? 0);
      acc.total += total;
      acc.assigned += assigned;
      acc.unassigned += Math.max(total - assigned, 0);
      return acc;
    },
    { total: 0, assigned: 0, unassigned: 0 },
  );

  const kpiData = [
    {
      title: "Total Attendees",
      value: totals.total,
      color: "from-[#1E3A8A] to-[#06B6D4]",
      icon: Users,
    },
    {
      title: "Assigned Seats",
      value: `${totals.assigned}/${totals.total}`,
      color: "from-[#10B981] to-[#16A34A]",
      icon: CheckCircle2,
    },
    {
      title: "Unassigned",
      value: totals.unassigned,
      color: "from-[#F59E0B] to-[#D97706]",
      icon: UserX,
    },
    {
      title: "Upcoming Events",
      value: events.length,
      color: "from-[#6366F1] to-[#1E3A8A]",
      icon: Calendar,
    },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-6 lg:p-8">
      <div className="max-w-[1440px] mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-[#0B1220]">Dashboard</h1>
            <p className="text-[#64748B] mt-1">
              Welcome back! Here's what's happening today.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              className="bg-[#1E3A8A] hover:bg-[#2563EB] gap-2"
              onClick={() => navigate("/events/new")}
            >
              <Plus className="h-4 w-4" />
              Create Event
            </Button>
          </div>
        </div>

        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        {loading ? (
          <div className="text-sm text-[#64748B]">Loading…</div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {kpiData.map((kpi, index) => {
            const Icon = kpi.icon;
            return (
              <Card
                key={index}
                className="p-6 bg-white shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm text-[#64748B] mb-1">{kpi.title}</p>
                    <h3 className="text-3xl font-bold text-[#0B1220] mb-2">
                      {kpi.value}
                    </h3>
                  </div>
                  <div
                    className={`w-12 h-12 rounded-lg bg-gradient-to-br ${kpi.color} flex items-center justify-center flex-shrink-0`}
                  >
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 bg-white shadow-sm overflow-hidden">
            <div className="p-6 border-b border-[#E2E8F0]">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-[#0B1220]">
                  Recent Events
                </h2>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F8FAFC]">
                    <TableHead>Event Name</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Venue
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">
                      Progress
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event: any) => (
                    <TableRow
                      onClick={() => navigate(`/events/${event.id}`)}
                      key={event.id}
                      className="cursor-pointer hover:bg-[#F8FAFC]"
                    >
                      <TableCell>
                        <div>
                          <div className="font-medium text-[#0B1220]">
                            {event.name}
                          </div>
                          <div className="text-sm text-[#64748B] md:hidden">
                            {event.venue_name}
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="hidden md:table-cell text-[#64748B]">
                        {event.venue_name}
                      </TableCell>

                      <TableCell className="hidden sm:table-cell text-[#64748B]">
                        {formatDate(event.event_date) || "—"}
                      </TableCell>

                      <TableCell>
                        <Badge className="bg-[#CFFAFE] text-[#06B6D4] hover:bg-[#CFFAFE]">
                          {(event.status ?? "draft").replace("_", " ")}
                        </Badge>
                      </TableCell>

                      <TableCell className="hidden lg:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-[#E2E8F0] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#1E3A8A] to-[#06B6D4] rounded-full"
                              style={{
                                width: `${
                                  event.total_prefs
                                    ? (event.assigned_count /
                                        event.total_prefs) *
                                      100
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                          <span className="text-sm text-[#64748B] whitespace-nowrap">
                            {event.assigned_count ?? 0}/{event.total_prefs ?? 0}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card className="bg-white shadow-sm">
            <div className="p-6 border-b border-[#E2E8F0]">
              <h2 className="text-xl font-semibold text-[#0B1220]">
                Activity Feed
              </h2>
            </div>
            <div className="p-6 space-y-4 max-h-[600px] overflow-y-auto">
              {activityFeed.map((activity) => {
                const Icon = activity.icon;
                return (
                  <div key={activity.id} className="flex gap-3">
                    <div
                      className={`w-8 h-8 rounded-full bg-[#F1F5F9] flex items-center justify-center flex-shrink-0 ${activity.color}`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#0B1220]">
                        <span className="font-medium">{activity.user}</span>{" "}
                        <span className="text-[#64748B]">
                          {activity.action}
                        </span>
                      </p>
                      <p className="text-sm font-medium text-[#1E3A8A] truncate">
                        {activity.target}
                      </p>
                      <p className="text-xs text-[#94A3B8] mt-0.5">
                        {activity.time}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
