export const API_BASE = "http://localhost:8000";

function getAccessToken(): string | null {
  return (
    window.localStorage.getItem("access_token") ||
    window.sessionStorage.getItem("access_token")
  );
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });
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
      ? {
          ...authHeaders(), // NEW
          ...(init?.headers as any),
        }
      : {
          "Content-Type": "application/json",
          ...authHeaders(), // NEW
          ...(init?.headers as any),
        },
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

export const getVenues = () => apiGet("/venues");
export const getEvents = () => apiGet(`/events`);

export const runAssignments = (id: string | number, payload?: any) =>
  fetch(`${API_BASE}/events/${id}/assignments/run`, {
    method: "POST",
    headers: payload
      ? { "Content-Type": "application/json", ...authHeaders() } // NEW
      : { ...authHeaders() }, // NEW
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
    {
      method: "POST",
      headers: { ...authHeaders() }, // NEW
    },
  ).then((r) => {
    if (!r.ok) throw new Error("move failed");
  });

export const clearAssignment = (id: string | number, preferenceId: number) =>
  fetch(
    `${API_BASE}/events/${id}/assignments/clear?preference_id=${preferenceId}`,
    {
      method: "POST",
      headers: { ...authHeaders() }, // NEW
    },
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
  payload: GenerateVenueSeatsPayload,
): Promise<any> {
  return apiPost(`/venues/${venueId}/seats/generate`, payload);
}

export const createEvent = (payload: any) => apiPost("/events", payload);

export type Organization = { id: number; name: string };
export type TokenOut = { access_token: string; token_type: "bearer" };
export type AuthMeOut = {
  user_id: number;
  email: string;
  org_id: number;
  org_name: string;
};

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(), // NEW
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function getOrganizations(): Promise<Organization[]> {
  return apiJson<Organization[]>("/organizations", { method: "GET" });
}

export function login(
  org_id: number,
  email: string,
  password: string,
): Promise<TokenOut> {
  return apiJson<TokenOut>("/auth/login", {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ org_id, email, password }),
  });
}

export async function getMe(): Promise<AuthMeOut> {
  return apiJson<AuthMeOut>("/auth/me", { method: "GET" });
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {});

  window.localStorage.removeItem("access_token");
  window.localStorage.removeItem("token_type");
  window.localStorage.removeItem("org_id");

  window.sessionStorage.removeItem("access_token");
  window.sessionStorage.removeItem("token_type");
  window.sessionStorage.removeItem("org_id");
}

export type SeatMapSeat = {
  id: number;
  code: string;
  x: number | null;
  y: number | null;
  is_blocked: number;
  is_accessible: number;
  is_aisle: number;
  assignment: null | {
    preference_id: number;
    member_id: number;
    first_name: string;
    last_name: string;
    needs_accessible: number;
    group_code: string | null;
  };
};

export async function getVenueSeatMap(venueId: number): Promise<SeatMapSeat[]> {
  const res = await fetch(`${API_BASE}/venues/${venueId}/seatmap`, {
    method: "GET",
    headers: { ...authHeaders() }, // NEW
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to load venue seatmap (${res.status})`);
  }
  return (await res.json()) as SeatMapSeat[];
}

export const updateEventStatus = (eventId: number | string, status: string) =>
  apiJson(`/events/${eventId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

export type SeatLayout = "horizontal" | "vertical";

export type GenerateVenueSeatsZone = {
  zone: string;
  rows: number;
  seats_per_row: number;
  aisle_seat_numbers?: number[];
  accessible_rows?: number[];
  accessible_per_row?: number;
  accessible_side?: "start" | "end" | "both";
};

export type GenerateVenueSeatsPayload = {
  layout: SeatLayout;
  zones: GenerateVenueSeatsZone[];
};
