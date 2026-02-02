export const API_BASE = "http://localhost:8000";

export async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed`);
  return res.json();
}

export async function apiPost(
  path: string,
  body?: any,
  init?: RequestInit,
): Promise<any> {
  const isForm = body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: isForm
      ? (init?.headers as any)
      : { "Content-Type": "application/json", ...(init?.headers as any) },
    body: isForm
      ? (body as FormData)
      : body !== undefined
        ? JSON.stringify(body)
        : undefined,
    ...init,
  });
  if (!res.ok) throw new Error(`POST ${path} failed`);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

// Convenience wrappers
export const getVenues = () => apiGet("/venues");
export const getEvents = () => apiGet(`/events`);
export const runAssignments = (id: string | number, payload?: any) =>
  fetch(`${API_BASE}/events/${id}/assignments/run`, {
    method: "POST",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  }).then((r) => {
    if (!r.ok) throw new Error("run failed");
    return r.json();
  });
export const getEvent = (id: string | number) => apiGet(`/events/${id}`);
export const getPreferenceSummary = (id: string | number) =>
  apiGet(`/events/${id}/preferences/summary`);
export const getVenueSections = (id: string | number) =>
  apiGet(`/venues/${id}/sections`);
export const getEventIssues = (id: string | number) =>
  apiGet(`/events/${id}/issues`);
export const getEventParticipants = (id: string | number) =>
  apiGet(`/events/${id}/participants`);
export const getEventSeatMap = (id: string | number) =>
  apiGet(`/events/${id}/seatmap`);

export const moveAssignment = (
  id: string | number,
  preferenceId: number,
  seatId: number,
) =>
  fetch(
    `${API_BASE}/events/${id}/assignments/move?preference_id=${preferenceId}&seat_id=${seatId}`,
    { method: "POST" },
  ).then((r) => {
    if (!r.ok) throw new Error("move failed");
  });
export const clearAssignment = (id: string | number, preferenceId: number) =>
  fetch(
    `${API_BASE}/events/${id}/assignments/clear?preference_id=${preferenceId}`,
    { method: "POST" },
  ).then((r) => {
    if (!r.ok) throw new Error("clear failed");
  });

export const getPortal = (token: string) => apiGet(`/portal/${token}`);
export const submitPortal = (token: string, body: any) =>
  apiPost(`/portal/${token}`, body);

export const importEventMembers = (
  eventId: number,
  file: File,
  opts?: { dryRun?: boolean },
) => {
  const fd = new FormData();
  fd.append("file", file);
  const qs = opts?.dryRun ? "?dry_run=1" : "";
  return apiPost(`/events/${eventId}/members/import${qs}`, fd, {
    headers: undefined,
  });
};

export async function createVenue(payload: {
  name: string;
  location?: string;
  category?: string;
  status?: string;
}): Promise<{
  id: number;
  name: string;
  location?: string;
  status: string;
  category?: string;
}> {
  return apiPost("/venues", payload);
}

export async function generateVenueSeats(
  venueId: number,
  payload: {
    zones: Array<{ zone: string; rows: number; seats_per_row: number }>;
  },
): Promise<any> {
  return apiPost(`/venues/${venueId}/seats/generate`, payload);
}

// ADD: event creation wrapper (matches the import used by CreateEventPage.jsx)
export const createEvent = (payload: any) => apiPost("/events", payload);
