import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api";
import { Layout } from "./components/Layout";
import { Ajustes } from "./pages/Ajustes";
import { Capacidades } from "./pages/Capacidades";
import { Claves } from "./pages/Claves";
import { Dashboard } from "./pages/Dashboard";
import { Jobs } from "./pages/Jobs";
import { Login } from "./pages/Login";
import { Modelos } from "./pages/Modelos";
import { Peticiones } from "./pages/Peticiones";
import { Playground } from "./pages/Playground";

function RequireAuth({ children }: { children: JSX.Element }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/capacidades" element={<Capacidades />} />
        <Route path="/modelos" element={<Modelos />} />
        <Route path="/playground" element={<Playground />} />
        <Route path="/peticiones" element={<Peticiones />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/claves" element={<Claves />} />
        <Route path="/ajustes" element={<Ajustes />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
