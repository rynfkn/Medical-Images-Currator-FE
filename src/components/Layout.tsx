import { Link, Outlet } from "react-router-dom";
import type { User } from "../types/api";

export function Layout({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  return (
    <>
      <header className="site-header">
        <Link to="/datasets" className="brand">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>
          <span>
            Medical Dataset Curator<small>Review workspace</small>
          </span>
        </Link>
        <div className="account">
          <span>
            {user.full_name || user.username}
            <small>{user.role.toLowerCase()}</small>
          </span>
          <button className="secondary" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className="workspace">
        <Outlet />
      </main>
      <footer className="site-footer">
        Medical Dataset Curator <span>Integration MVP</span>
      </footer>
    </>
  );
}
