import { useState } from "react";
import type { FormEvent } from "react";
import { api, clearToken, errorMessage, setToken } from "../api/client";
import type { User } from "../types/api";

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = new URLSearchParams({ username, password });
      const { data } = await api.post<{ access_token: string }>(
        "/auth/login",
        body,
      );
      setToken(data.access_token);
      onLogin((await api.get<User>("/auth/me")).data);
    } catch (error) {
      clearToken();
      setError(errorMessage(error, "Failed to log in."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-card">
        <span className="brand-mark large" aria-hidden="true">
          +
        </span>
        <p className="eyebrow">Review workspace</p>
        <h1>Medical Dataset Curator</h1>
        <p className="muted">Sign in to review cases and curate annotations.</p>
        <form onSubmit={(event) => void login(event)}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            autoFocus
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="full-width" disabled={busy}>
            {busy ? "Signing in…" : "Log in"}
          </button>
        </form>
      </section>
      <p className="muted">Medical Dataset Curator · Integration MVP</p>
    </main>
  );
}
