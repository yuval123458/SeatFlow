import React, { useEffect, useState, useRef, useMemo } from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Slider } from "../components/ui/slider";
import { Progress } from "../components/ui/progress";
import { useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  FileText,
  Play,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Calendar,
  Users,
  Eye,
  Search,
  RotateCw,
  Pause,
} from "lucide-react";
import { useParams } from "react-router-dom";
import {
  getEvents,
  getEvent,
  getEventIssues,
  runAssignments,
  clearAssignment,
  getEventParticipants,
  importEventMembers,
  updateEventStatus,
} from "../lib/api";

type HardConstraint = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

export default function EventDetailsSinglePage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [eventData, setEventData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<any | null>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const assignmentResults = useMemo(() => {
    const zoneFromSeatCode = (code?: string) => {
      if (!code) return "—";
      const z = String(code).split("-")[0]?.trim();
      return z || "—";
    };

    return (participants || [])
      .filter((p: any) => p?.assigned_seat_code)
      .map((p: any) => {
        const member =
          `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "—";

        const seat = p?.assigned_seat_code ?? "—";

        return {
          id: p?.preference_id ?? p?.member_id ?? seat,
          member,
          phone: p?.phone ?? "—",
          seat,
          zone: zoneFromSeatCode(seat),
          satisfaction: null as number | null,
        };
      });
  }, [participants]);

  const hardConstraints: HardConstraint[] = [
    {
      id: "unique_seat",
      name: "Unique seat assignment",
      description: "No seat can be assigned to more than one member.",
      enabled: true,
    },
    {
      id: "accessible_for_needs",
      name: "Accessibility requirements",
      description:
        "Members who need accessibility should receive accessible seats.",
      enabled: true,
    },
    {
      id: "blocked_seats",
      name: "Blocked seats",
      description: "Never assign seats marked as blocked/unavailable.",
      enabled: true,
    },
  ];

  const [runStatus, setRunStatus] = useState<"idle" | "running" | "completed">(
    "idle",
  );
  const [runProgress, setRunProgress] = useState(0);

  const [preferenceWeight, setPreferenceWeight] = useState([60]);
  const [groupWeight, setGroupWeight] = useState([70]);
  const [stabilityWeight, setStabilityWeight] = useState([80]);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<any>(null);
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [statusDraft, setStatusDraft] = useState<string>("draft");
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState("");

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    getEvent(eventId)
      .then((ev) => setEventData(ev))
      .catch(() => setError("Failed to load event"))
      .finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    getEventIssues(eventId)
      .then(setIssues)
      .catch(() => setIssues(null));
  }, [eventId]);

  useEffect(() => {
    if (eventData?.status) setStatusDraft(eventData.status);
  }, [eventData?.status]);

  const saveStatus = async () => {
    if (!eventId) return;
    setSavingStatus(true);
    setStatusError("");
    try {
      const updated = await updateEventStatus(eventId, statusDraft);
      setEventData(updated);
      const is = await getEventIssues(eventId);
      setIssues(is);
    } catch (e: any) {
      setStatusError(e?.message || "Failed to update status");
    } finally {
      setSavingStatus(false);
    }
  };

  useEffect(() => {
    if (!eventId) return;
    getEventParticipants(Number(eventId))
      .then((rows) => setParticipants(rows || []))
      .catch(() => setParticipants([]));
  }, [eventId]);

  useEffect(() => {
    if (!selectedFile || !eventId) return;

    let cancelled = false;

    (async () => {
      setValidating(true);
      setImportError("");
      setImportSummary(null);

      try {
        const summary = await importEventMembers(
          Number(eventId),
          selectedFile,
          {
            dryRun: true,
          },
        );
        if (cancelled) return;

        setImportSummary(summary);

        if (!summary?.ok || (summary?.errors?.length ?? 0) > 0) {
          setImportError(
            "CSV validation failed. Fix the errors and try again.",
          );
        }
      } catch (e: any) {
        if (cancelled) return;
        setImportError(e?.message || "CSV validation failed.");
      } finally {
        if (!cancelled) setValidating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedFile, eventId]);

  const refreshEventAndIssues = async () => {
    if (!eventId) return;
    const [ev, is] = await Promise.all([
      getEvent(eventId),
      getEventIssues(eventId),
    ]);
    setEventData(ev);
    setIssues(is);
  };

  const formatDate = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? "—"
      : d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
  };

  const handleRun = async () => {
    if (!eventId) return;
    try {
      setRunStatus("running");
      setRunProgress(25);

      await runAssignments(eventId, {
        preference_weight: preferenceWeight[0],
        group_weight: groupWeight[0],
        stability_weight: stabilityWeight[0],
      });

      await refreshEventAndIssues();

      const rows = await getEventParticipants(Number(eventId));
      setParticipants(rows || []);

      setRunProgress(100);
      setRunStatus("completed");
    } catch {
      setError("Run failed");
      setRunStatus("idle");
      setRunProgress(0);
    }
  };

  const submitImport = async () => {
    if (!selectedFile || !eventId) return;
    if (!canSubmit) return;

    setImporting(true);
    setImportError("");
    try {
      const summary = await importEventMembers(Number(eventId), selectedFile); // real import
      setImportSummary(summary);

      const rows = await getEventParticipants(Number(eventId));
      setParticipants(rows || []);

      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: any) {
      setImportError(e?.message || "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const canSubmit =
    !!selectedFile &&
    !validating &&
    !importing &&
    importSummary?.dry_run === true &&
    importSummary?.ok === true &&
    (importSummary?.errors?.length ?? 0) === 0;

  const warnings = useMemo(() => {
    const out: any[] = [];
    const s = issues?.summary;

    const push = (
      severity: "error" | "warning" | "info",
      category: string,
      message: string,
      detail: string,
    ) => {
      out.push({
        id: `${category}:${message}`,
        severity,
        category,
        message,
        detail,
      });
    };

    if (!s) return out;

    const unassignedCnt = Number(s.unassigned ?? 0);
    const seatConflictsCnt = Number(s.seat_conflicts ?? 0);
    const blockedCnt = Number(s.blocked_assignments ?? 0);

    push("warning", "Unassigned", `Unassigned: ${unassignedCnt}`, "");
    push(
      "warning",
      "Seat conflicts",
      `Seat conflicts: ${seatConflictsCnt}`,
      "",
    );
    push(
      "warning",
      "Blocked assignments",
      `Blocked assignments: ${blockedCnt}`,
      "",
    );

    return out;
  }, [issues]);

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "error":
        return (
          <Badge className="bg-[#FEE2E2] text-[#DC2626] hover:bg-[#FEE2E2]">
            Error
          </Badge>
        );
      case "warning":
        return (
          <Badge className="bg-[#FFEDD5] text-[#EA580C] hover:bg-[#FFEDD5]">
            Warning
          </Badge>
        );
      case "info":
        return (
          <Badge className="bg-[#CFFAFE] text-[#06B6D4] hover:bg-[#CFFAFE]">
            Info
          </Badge>
        );
      default:
        return null;
    }
  };

  const assigned = Number(eventData?.assigned_count ?? 0);
  const total = Number(eventData?.total_prefs ?? 0);
  const unassigned = Math.max(total - assigned, 0);

  useEffect(() => {
    if (eventId) return;
    (async () => {
      try {
        const list: any[] = await getEvents();
        if (Array.isArray(list) && list.length) {
          const sorted = [...list].sort((a, b) => {
            const da = new Date(a?.event_date ?? 0).getTime();
            const db = new Date(b?.event_date ?? 0).getTime();
            if (db !== da) return db - da;
            return (b?.id ?? 0) - (a?.id ?? 0);
          });
          navigate(`/events/${sorted[0].id}`, { replace: true });
        }
      } catch {}
    })();
  }, [eventId, navigate]);

  if (!eventId) {
    return <div className="p-6 text-[#64748B]">Loading latest event…</div>;
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-6 lg:p-8">
      <div className="max-w-[1440px] mx-auto space-y-6">
        {/* Event Header */}
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-[#0B1220]">
                {eventData?.name ?? "Event"}
              </h1>
              <Badge className="bg-[#CFFAFE] text-[#06B6D4] hover:bg-[#CFFAFE]">
                {(eventData?.status ?? "draft").replace("_", " ")}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-[#64748B]">
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {eventData?.venue_name ?? "—"}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {formatDate(eventData?.event_date)}
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                {eventData?.assigned_count ?? 0}/{eventData?.total_prefs ?? 0}
              </span>
            </div>
          </div>
        </div>

        <Card className="p-4 bg-white shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
            <div className="text-sm font-semibold text-[#0B1220]">
              Event status
            </div>

            <select
              className="border border-[#E2E8F0] rounded px-3 py-2 text-sm bg-white max-w-[260px]"
              value={statusDraft}
              onChange={(e) => setStatusDraft(e.target.value)}
              disabled={savingStatus}
            >
              <option value="draft">draft</option>
              <option value="preferences_open">preferences_open</option>
              <option value="locked">locked</option>
              <option value="published">published</option>
            </select>

            <Button
              onClick={saveStatus}
              disabled={
                savingStatus ||
                !eventData ||
                statusDraft === (eventData?.status ?? "draft")
              }
              className="bg-[#1E3A8A] hover:bg-[#2563EB]"
            >
              {savingStatus ? "Saving..." : "Save status"}
            </Button>
          </div>
        </Card>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Import Members Section */}
            <Card className="p-6 bg-white shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-[#0B1220]">
                  Import Members
                </h2>

                {validating ? (
                  <Badge className="bg-[#DBEAFE] text-[#1E3A8A] hover:bg-[#DBEAFE] gap-1">
                    <RotateCw className="h-3 w-3 animate-spin" />
                    Validating
                  </Badge>
                ) : importSummary?.errors?.length ? (
                  <Badge className="bg-[#FEE2E2] text-[#DC2626] hover:bg-[#FEE2E2] gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {importSummary.errors.length} Issues
                  </Badge>
                ) : canSubmit ? (
                  <Badge className="bg-[#DCFCE7] text-[#16A34A] hover:bg-[#DCFCE7] gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Ready to submit
                  </Badge>
                ) : (
                  <Badge className="bg-[#F1F5F9] text-[#64748B] hover:bg-[#F1F5F9] gap-1">
                    <FileText className="h-3 w-3" />
                    Choose file
                  </Badge>
                )}
              </div>

              <div className="mb-4 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <div className="text-sm font-semibold text-[#0B1220] mb-1">
                  CSV required columns
                </div>
                <div className="text-sm text-[#334155]">
                  <span className="font-mono">first_name</span>,{" "}
                  <span className="font-mono">last_name</span>,{" "}
                  <span className="font-mono">phone</span>,{" "}
                  <span className="font-mono">gender</span>{" "}
                  <span className="text-[#64748B]">(male/female)</span>,{" "}
                  <span className="font-mono">birth_date</span>{" "}
                  <span className="text-[#64748B]">(YYYY-MM-DD)</span>
                </div>
                <div className="text-xs text-[#64748B] mt-2">
                  Example header:
                  <div className="mt-1 font-mono text-[11px] break-all">
                    first_name,last_name,phone,gender,birth_date
                  </div>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setSelectedFile(f);
                  setImportSummary(null);
                  setImportError("");
                }}
              />

              <div className="flex items-center gap-3">
                <button
                  className="px-3 py-2 rounded bg-[#1E3A8A] text-white disabled:opacity-50"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={validating || importing}
                >
                  Choose CSV
                </button>
                <span className="text-sm text-[#334155]">
                  {selectedFile ? selectedFile.name : "No file selected"}
                </span>
              </div>

              {validating && (
                <p className="text-sm text-[#64748B]">Validating…</p>
              )}
              {importing && (
                <p className="text-sm text-[#64748B]">Uploading…</p>
              )}
              {importError && (
                <p className="text-sm text-red-600">{importError}</p>
              )}

              {importSummary && (
                <div className="text-sm text-[#0B1220]">
                  Members created: {importSummary.created_members ?? 0} •
                  Preferences created: {importSummary.preferences_created ?? 0}{" "}
                  • Preferences updated:{" "}
                  {importSummary.preferences_updated ?? 0}
                  {importSummary.errors?.length
                    ? ` • Errors: ${importSummary.errors.length}`
                    : ""}
                </div>
              )}

              <div className="mt-4 flex items-center gap-3">
                <Button
                  onClick={submitImport}
                  disabled={!canSubmit}
                  className="bg-[#16A34A] hover:bg-[#15803D]"
                >
                  {importing ? "Importing..." : "Submit Import"}
                </Button>
                <span className="text-sm text-[#64748B]">
                  {validating
                    ? "Validating on server..."
                    : canSubmit
                      ? "CSV valid"
                      : selectedFile
                        ? "Fix errors to enable submit"
                        : "Choose a CSV"}
                </span>
              </div>

              {importSummary?.errors?.length ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-red-600">
                    Errors ({importSummary.errors.length})
                  </summary>
                  <ul className="list-disc ml-5 text-sm">
                    {importSummary.errors.map((e: string, i: number) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </Card>

            {/* Rules & Weights */}
            <Card className="p-6 bg-white shadow-sm">
              <h2 className="text-xl font-semibold text-[#0B1220] mb-4">
                Rules & Weights
              </h2>

              {/* Hard Constraints */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-[#334155] uppercase tracking-wide mb-3">
                  Hard Constraints
                </h3>
                <div className="space-y-2">
                  {hardConstraints.map((constraint) => (
                    <div
                      key={constraint.id}
                      className="flex items-start gap-3 p-3 bg-[#F8FAFC] rounded-lg"
                    >
                      <div
                        className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${constraint.enabled ? "bg-[#16A34A]" : "bg-[#E2E8F0]"}`}
                      >
                        {constraint.enabled && (
                          <CheckCircle2 className="h-3 w-3 text-white" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-[#0B1220]">
                          {constraint.name}
                        </p>
                        <p className="text-sm text-[#64748B]">
                          {constraint.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Objective Weights */}
              <div>
                <h3 className="text-sm font-semibold text-[#334155] uppercase tracking-wide mb-4">
                  Objective Weights
                </h3>

                <div className="space-y-6">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Preference Satisfaction</Label>
                      <span className="text-sm font-semibold text-[#1E3A8A]">
                        {preferenceWeight[0]}%
                      </span>
                    </div>
                    <Slider
                      value={preferenceWeight}
                      onValueChange={setPreferenceWeight}
                      max={100}
                      step={1}
                    />
                    <p className="text-xs text-[#64748B] mt-1">
                      Prioritize preferred seat/zone and aisle requests
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Group Togetherness</Label>
                      <span className="text-sm font-semibold text-[#1E3A8A]">
                        {groupWeight[0]}%
                      </span>
                    </div>
                    <Slider
                      value={groupWeight}
                      onValueChange={setGroupWeight}
                      max={100}
                      step={1}
                    />
                    <p className="text-xs text-[#64748B] mt-1">
                      Keep members with the same group close (uses seat x/y)
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Keep manual adjustments</Label>
                      <span className="text-sm font-semibold text-[#1E3A8A]">
                        {stabilityWeight[0]}%
                      </span>
                    </div>
                    <Slider
                      value={stabilityWeight}
                      onValueChange={setStabilityWeight}
                      max={100}
                      step={1}
                    />
                    <p className="text-xs text-[#64748B] mt-1">
                      Higher = keep current{" "}
                      <span className="font-mono">assigned_seat_id</span> on
                      reruns. Lower = allow more reshuffling.
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="bg-white shadow-sm overflow-hidden">
              <div className="p-6 border-b border-[#E2E8F0]">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-[#0B1220]">
                    Assignment Results
                  </h2>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                  <Input placeholder="Search members..." className="pl-9" />
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-[#F8FAFC]">
                      <TableHead>Member</TableHead>
                      <TableHead className="hidden md:table-cell">
                        Phone
                      </TableHead>
                      <TableHead>Seat</TableHead>
                      <TableHead className="hidden sm:table-cell">
                        Zone
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignmentResults.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-[#64748B]">
                          No results yet. Run the assignment to populate
                          results.
                        </TableCell>
                      </TableRow>
                    ) : (
                      assignmentResults.map((result: any) => (
                        <TableRow key={result.id}>
                          <TableCell className="font-medium text-[#0B1220]">
                            {result.member}
                          </TableCell>

                          <TableCell className="hidden md:table-cell text-[#64748B]">
                            {result.phone}
                          </TableCell>

                          <TableCell>
                            <span className="font-mono font-medium text-[#1E3A8A]">
                              {result.seat}
                            </span>
                          </TableCell>

                          <TableCell className="hidden sm:table-cell">
                            <Badge
                              className={
                                result.zone === "VIP"
                                  ? "bg-[#DBEAFE] text-[#1E3A8A] hover:bg-[#DBEAFE]"
                                  : result.zone === "Premium"
                                    ? "bg-[#CFFAFE] text-[#06B6D4] hover:bg-[#CFFAFE]"
                                    : "bg-[#F1F5F9] text-[#64748B] hover:bg-[#F1F5F9]"
                              }
                            >
                              {result.zone}
                            </Badge>
                          </TableCell>

                          <TableCell className="hidden lg:table-cell"></TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Run Assignment Panel */}
            <Card className="p-6 bg-white shadow-sm">
              <h2 className="text-lg font-semibold text-[#0B1220] mb-4">
                Run Assignment
              </h2>

              <Button
                onClick={() => navigate(`/events/${eventId}/corrections`)}
                variant="secondary"
                className="w-full gap-2 mb-3"
              >
                <Eye className="h-4 w-4" />
                Seat map & manual correction
              </Button>

              {runStatus === "idle" && (
                <>
                  <Button
                    onClick={handleRun}
                    className="w-full bg-[#06B6D4] hover:bg-[#22D3EE] gap-2 mb-4"
                  >
                    <Play className="h-4 w-4" />
                    Run Algorithm
                  </Button>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-[#DCFCE7] rounded-lg">
                      <p className="text-xs text-[#64748B]">Assigned</p>
                      <p className="text-xl font-bold text-[#16A34A]">
                        {assigned}
                      </p>
                    </div>
                    <div className="p-3 bg-[#FFEDD5] rounded-lg">
                      <p className="text-xs text-[#64748B]">Unassigned</p>
                      <p className="text-xl font-bold text-[#EA580C]">
                        {unassigned}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {runStatus === "running" && (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <RotateCw className="h-4 w-4 text-[#06B6D4] animate-spin" />
                    <span className="font-medium text-[#0B1220]">
                      Running...
                    </span>
                  </div>
                  <Progress value={runProgress} className="mb-3" />
                  <p className="text-sm text-[#64748B] mb-4">
                    {runProgress}% complete
                  </p>
                  <Button variant="secondary" className="w-full gap-2" disabled>
                    <Pause className="h-4 w-4" />
                    Cancel
                  </Button>
                </>
              )}

              {runStatus === "completed" && (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <CheckCircle2 className="h-5 w-5 text-[#16A34A]" />
                    <span className="font-medium text-[#16A34A]">
                      Run Completed
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="p-3 bg-[#DCFCE7] rounded-lg">
                      <p className="text-xs text-[#64748B]">Assigned</p>
                      <p className="text-xl font-bold text-[#16A34A]">
                        {assigned}
                      </p>
                    </div>
                    <div className="p-3 bg-[#FFEDD5] rounded-lg">
                      <p className="text-xs text-[#64748B]">Unassigned</p>
                      <p className="text-xl font-bold text-[#EA580C]">
                        {unassigned}
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={handleRun}
                    variant="secondary"
                    className="w-full gap-2"
                  >
                    <RotateCw className="h-4 w-4" />
                    Run Again
                  </Button>
                </>
              )}
            </Card>

            {/* Warnings Panel */}
            <Card className="bg-white shadow-sm">
              <div className="p-6 border-b border-[#E2E8F0]">
                <h2 className="text-lg font-semibold text-[#0B1220]">
                  Warnings & Violations
                </h2>
              </div>
              <div className="p-4 space-y-3 max-h-[500px] overflow-y-auto">
                {warnings.map((warning) => (
                  <div
                    key={warning.id}
                    className="p-4 bg-[#F8FAFC] rounded-lg border-l-4"
                    style={{
                      borderLeftColor:
                        warning.severity === "error"
                          ? "#DC2626"
                          : warning.severity === "warning"
                            ? "#EA580C"
                            : "#06B6D4",
                    }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      {getSeverityBadge(warning.severity)}
                      <span className="text-xs text-[#64748B]">
                        {warning.category}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-[#0B1220] mb-1">
                      {warning.message}
                    </p>
                    <p className="text-xs text-[#64748B]">{warning.detail}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* Issues Panel */}
            <Card className="bg-white shadow-sm">
              <div className="p-6 border-b border-[#E2E8F0]">
                <h2 className="text-lg font-semibold text-[#0B1220]">Issues</h2>
                <p className="text-sm text-[#64748B] mt-1">
                  Conflicts: {issues?.summary?.seat_conflicts ?? 0} · Blocked:{" "}
                  {issues?.summary?.blocked_assignments ?? 0} · Accessibility:{" "}
                  {issues?.summary?.accessibility_violations ?? 0}
                </p>
              </div>
              <div className="p-4 space-y-3 max-h-[500px] overflow-y-auto">
                {(issues?.seat_conflicts ?? []).map((c: any) => (
                  <div
                    key={c.seat_id}
                    className="p-3 bg-[#F8FAFC] rounded border"
                  >
                    <div className="text-sm font-medium">
                      Seat {c.seat_code} has {c.member_ids.length} assignments
                    </div>
                    {c.preference_ids.map((pid: number) => (
                      <div key={pid} className="flex gap-2 mt-2">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            clearAssignment(eventId!, pid).then(
                              refreshEventAndIssues,
                            )
                          }
                        >
                          Clear
                        </Button>
                      </div>
                    ))}
                  </div>
                ))}
                {(issues?.blocked_assignments ?? []).map((b: any) => (
                  <div
                    key={b.preference_id}
                    className="p-3 bg-[#FEF2F2] rounded border border-[#FEE2E2]"
                  >
                    <div className="text-sm font-medium">
                      Blocked seat: {b.seat_code}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          clearAssignment(eventId!, b.preference_id).then(
                            refreshEventAndIssues,
                          )
                        }
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                ))}
                {(issues?.accessibility_violations ?? []).map((a: any) => (
                  <div
                    key={a.preference_id}
                    className="p-3 bg-[#FFF7ED] rounded border"
                  >
                    <div className="text-sm font-medium">
                      Needs accessible, got {a.seat_code}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          clearAssignment(eventId!, a.preference_id).then(
                            refreshEventAndIssues,
                          )
                        }
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="space-y-6">
              <div className="p-6 bg-white rounded shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-[#0B1220]">
                    Share links
                  </h2>
                  <span className="text-sm text-[#64748B]">
                    {participants.length} members
                  </span>
                </div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto">
                  {participants.map((p) => {
                    const token = p.invite_token ?? String(p.preference_id); // simple fallback
                    const link = portalUrl(token);
                    const isCopied = copiedId === p.preference_id;
                    return (
                      <div
                        key={p.preference_id}
                        className="flex items-center justify-between gap-3 border rounded px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[#0B1220] truncate">
                            {p.first_name} {p.last_name || ""} ·{" "}
                            {p.phone || "—"}
                          </div>
                          <div className="text-xs text-[#64748B] truncate">
                            {link}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            className={`text-sm px-3 py-1 rounded ${isCopied ? "bg-[#DCFCE7] text-[#16A34A]" : "bg-[#EEF2FF] text-[#1E3A8A]"}`}
                            onClick={async () => {
                              await copyToClipboard(link);
                              setCopiedId(p.preference_id);
                              setTimeout(() => setCopiedId(null), 1200);
                            }}
                          >
                            {isCopied ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {participants.length === 0 && (
                    <div className="text-sm text-[#64748B]">
                      No participants yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const copyToClipboard = async (text: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  } catch (e) {
    console.error("Copy failed", e);
  }
};

const portalUrl = (token?: string) =>
  token ? `${window.location.origin}/portal/${token}` : "";
