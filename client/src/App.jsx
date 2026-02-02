import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./layout/AppShell";

import DashboardPage from "./pages/DashboardPage";
import VenuesPage from "./pages/VenuesPage";
import LoginPage from "./pages/LoginPage";
import EventDetailsSinglePage from "./pages/EventDetailsSinglePage";
import PortalPage from "./pages/PortalPage";
import CreateVenuePage from "./pages/CreateVenuePage";
import CreateEventPage from "./pages/CreateEventPage";
import AdminManualCorrectionPage from "./pages/AdminManualCorrectionPage";

export default function App() {
  return (
    <Routes>
      {/* member routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/portal/:token" element={<PortalPage />} />

      {/* Admin routes */}
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

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
