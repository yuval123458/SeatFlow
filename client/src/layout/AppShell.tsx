import React, { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { TopNavbar, LeftSidebar } from "./Navigation";

export default function AppShell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const current = location.pathname.startsWith("/venues")
    ? "venues"
    : location.pathname.startsWith("/events")
      ? "events"
      : "dashboard";

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <TopNavbar onMenuClick={() => setOpen(true)} />

      <div className="flex">
        <LeftSidebar
          isOpen={open}
          onClose={() => setOpen(false)}
          currentPage={current}
          onNavigate={(page) => navigate(`/${page}`)}
        />

        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
