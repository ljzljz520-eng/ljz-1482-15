import { Link, useLocation, useNavigate } from "react-router-dom";
import { ReactNode, useMemo } from "react";
import { useUIStore } from "@/store/uiStore";
import clsx from "clsx";

const navItems = [
  { path: "/", label: "公园总览" },
  { path: "/audiovisual", label: "视听体验" },
  { path: "/timeline", label: "多轨剪辑" }
];

const UserChip = () => {
  const nav = useNavigate();
  const raw = localStorage.getItem("tl_user");
  if (!raw) {
    return (
      <Link
        to="/login"
        className="hidden sm:inline-flex px-3 py-1.5 rounded-full text-xs font-medium text-white bg-gradient-to-r from-primary to-accent hover:opacity-90 transition"
      >
        登录剪辑台
      </Link>
    );
  }
  try {
    const user = JSON.parse(raw) as { displayName: string; role: string };
    return (
      <div className="hidden sm:flex items-center gap-2">
        <span className="px-2.5 py-1 rounded-full bg-slate-100 text-xs text-slate-600">
          {user.displayName}
          <span className="ml-1 text-slate-400">{user.role === "admin" ? "管理员" : "剪辑师"}</span>
        </span>
        <button
          onClick={() => {
            localStorage.removeItem("tl_token");
            localStorage.removeItem("tl_user");
            localStorage.removeItem("tl_role");
            nav("/login");
          }}
          className="text-xs text-slate-400 hover:text-rose-500 transition"
        >
          退出
        </button>
      </div>
    );
  } catch {
    return null;
  }
};

const Layout = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  const { isMenuOpen, toggleMenu } = useUIStore();

  const activeMatch = useMemo(() => pathname, [pathname]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 backdrop-blur bg-white/80 border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary to-accent shadow-card flex items-center justify-center text-white font-bold">
              云溪
            </span>
            <div>
              <p className="text-sm text-slate-500">城市微度假</p>
              <h1 className="text-lg font-semibold text-slate-900">云溪公园</h1>
            </div>
          </Link>
          <nav className="hidden md:flex items-center gap-2">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={clsx(
                  "px-3 py-2 rounded-full text-sm font-medium transition hover:bg-primary/10",
                  activeMatch === item.path
                    ? "bg-primary/10 text-primary"
                    : "text-slate-600"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <UserChip />
            <button
              onClick={toggleMenu}
              className="md:hidden inline-flex items-center justify-center h-10 w-10 rounded-full border border-slate-200 hover:border-primary hover:text-primary transition"
              aria-label="Toggle menu"
            >
              <span className="block h-0.5 w-5 bg-current relative">
                <span className="block absolute -top-1.5 h-0.5 w-5 bg-current" />
                <span className="block absolute top-1.5 h-0.5 w-5 bg-current" />
              </span>
            </button>
          </div>
        </div>
        {isMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white/95">
            <div className="max-w-6xl mx-auto px-4 py-3 grid grid-cols-2 gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={clsx(
                    "px-3 py-2 rounded-xl text-sm font-medium transition hover:bg-primary/10",
                    activeMatch === item.path
                      ? "bg-primary/10 text-primary"
                      : "text-slate-600"
                  )}
                  onClick={toggleMenu}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>
      <main className="flex-1">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white/70 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-sm text-slate-500">© 2026 云溪公园 · 自然与创作共生</p>
          <div className="flex gap-3 text-sm text-slate-500">
            <span>开放时间：06:00 - 22:00</span>
            <span>服务热线：400-123-4567</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
