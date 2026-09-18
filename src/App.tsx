import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import {
  api,
  clearToken,
  errorMessage,
  getToken,
  SESSION_EXPIRED,
} from "./api/client";
import type { User } from "./types/api";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DatasetListPage } from "./pages/DatasetListPage";
import { DatasetPage } from "./pages/DatasetPage";
import { CaseReviewPage } from "./pages/CaseReviewPage";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);
  const restore = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (getToken()) setUser((await api.get<User>("/auth/me")).data);
    } catch (error) {
      setError(errorMessage(error, "Failed to verify your session."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void restore();
    const sync = (event: StorageEvent) => {
      if (event.storageArea === localStorage) logout();
    };
    window.addEventListener(SESSION_EXPIRED, logout);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SESSION_EXPIRED, logout);
      window.removeEventListener("storage", sync);
    };
  }, [restore, logout]);
  if (loading)
    return (
      <main className="session-state" role="status">
        Verifying session…
      </main>
    );
  if (error && getToken())
    return (
      <main className="session-state">
        <p role="alert">{error}</p>
        <button onClick={() => void restore()}>Try again</button>{" "}
        <button className="secondary" onClick={logout}>
          Log out
        </button>
      </main>
    );
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/datasets" replace />
            ) : (
              <LoginPage onLogin={setUser} />
            )
          }
        />
        <Route
          element={
            user ? (
              <Layout user={user} onLogout={logout} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route path="/datasets" element={<DatasetListPage />} />
          <Route path="/datasets/:datasetId" element={<DatasetPage />} />
          <Route
            path="/cases/:caseId"
            element={user ? <CaseReviewPage user={user} /> : null}
          />
        </Route>
        <Route
          path="*"
          element={<Navigate to={user ? "/datasets" : "/login"} replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}
