import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import AppShell from "./layout/AppShell";

import DashboardPage from "./pages/DashboardPage";
import VenuesPage from "./pages/VenuesPage";
import LoginPage from "./pages/LoginPage";
import EventDetailsSinglePage from "./pages/EventDetailsSinglePage";
import PortalPage from "./pages/PortalPage";
import CreateVenuePage from "./pages/CreateVenuePage";
import CreateEventPage from "./pages/CreateEventPage";
import AdminManualCorrectionPage from "./pages/AdminManualCorrectionPage";

function hasAccessToken() {
  return (
    !!window.localStorage.getItem("access_token") ||
    !!window.sessionStorage.getItem("access_token")
  );
}

function RequireAuth() {
  const location = useLocation();
  if (!hasAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      {/* public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/portal/:token" element={<PortalPage />} />

      {/* protected admin routes */}
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/venues" element={<VenuesPage />} />
          <Route path="/events/" element={<EventDetailsSinglePage />} />
          <Route path="/events/:eventId" element={<EventDetailsSinglePage />} />
          <Route path="/venues/new" element={<CreateVenuePage />} />
          <Route path="/events/new" element={<CreateEventPage />} />
          <Route
            path="/events/:eventId/corrections"
            element={<AdminManualCorrectionPage />}
          />
        </Route>
      </Route>

      {/* default */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
