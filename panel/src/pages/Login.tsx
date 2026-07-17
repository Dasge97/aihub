import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearToken, setToken } from "../api";
import { IconHub } from "../components/icons";
import { Spinner } from "../components/Spinner";

export function Login() {
  const [token, setTokenValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setToken(value);
    try {
      await api.get<{ ok: boolean }>("/admin/me");
      navigate("/");
    } catch (err) {
      clearToken();
      setError(
        err instanceof Error && !err.message.startsWith("Sesión")
          ? err.message
          : "Token no válido"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900/70 p-6"
      >
        <div className="mb-6 flex items-center justify-center gap-2">
          <IconHub className="h-6 w-6 text-accent-400" />
          <h1 className="text-lg font-semibold text-zinc-100">AI Hub</h1>
        </div>
        <label className="label" htmlFor="token">
          Token de administrador
        </label>
        <input
          id="token"
          type="password"
          className="input"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          placeholder="Pega aquí el token"
          autoFocus
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          className="btn-primary mt-4 w-full justify-center"
          disabled={busy || !token.trim()}
        >
          {busy ? <Spinner className="h-4 w-4 text-white" /> : "Entrar"}
        </button>
      </form>
    </div>
  );
}
