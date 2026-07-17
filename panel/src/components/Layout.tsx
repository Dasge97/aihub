import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { clearToken } from "../api";
import {
  IconClock,
  IconCpu,
  IconDashboard,
  IconFlask,
  IconHub,
  IconKey,
  IconLayers,
  IconList,
  IconLogout,
  IconSettings,
} from "./icons";

const NAV = [
  { to: "/", label: "Dashboard", icon: IconDashboard, end: true },
  { to: "/capacidades", label: "Capacidades", icon: IconLayers },
  { to: "/modelos", label: "Modelos", icon: IconCpu },
  { to: "/playground", label: "Playground", icon: IconFlask },
  { to: "/peticiones", label: "Peticiones", icon: IconList },
  { to: "/jobs", label: "Jobs", icon: IconClock },
  { to: "/claves", label: "Claves API", icon: IconKey },
  { to: "/ajustes", label: "Ajustes", icon: IconSettings },
];

export function Layout() {
  const navigate = useNavigate();

  function logout() {
    clearToken();
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-52 flex-col border-r border-zinc-800 bg-zinc-900/80">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3.5">
          <IconHub className="h-5 w-5 text-accent-400" />
          <span className="text-sm font-semibold tracking-wide text-zinc-100">
            AI Hub
          </span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-accent-600/15 font-medium text-accent-400"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-zinc-800 p-2">
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <IconLogout className="h-4 w-4" />
            Salir
          </button>
        </div>
      </aside>
      <main className="ml-52 min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}

export function PageTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}
