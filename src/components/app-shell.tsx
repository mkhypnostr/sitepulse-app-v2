import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { LogOut, HardHat } from "lucide-react";
import type { ReactNode } from "react";
import { roleLabels } from "@/lib/domain";

interface NavItem {
  to: string;
  label: string;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { role, user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const nav: NavItem[] =
    role === "admin"
      ? [
          { to: "/dashboard", label: "Panel" },
          { to: "/work-orders", label: "İş Emirleri" },
          { to: "/customers", label: "Müşteriler" },
          { to: "/stock", label: "Stok" },
          { to: "/team", label: "Ekip" },
          { to: "/reports", label: "Raporlar" },
        ]
      : role === "contractor"
        ? [
            { to: "/dashboard", label: "Panel" },
            { to: "/my-jobs", label: "İşlerim" },
          ]
        : [
            { to: "/dashboard", label: "Panel" },
            { to: "/my-projects", label: "Projelerim" },
          ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-sidebar/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center gap-4">
          <Link to="/dashboard" className="flex items-center gap-2 shrink-0">
            <div className="h-9 w-9 rounded-md bg-primary flex items-center justify-center">
              <HardHat className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-wide text-foreground">NES ENERJİ</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                İş Takip
              </div>
            </div>
          </Link>
          <nav className="hidden md:flex items-center gap-1 ml-6">
            {nav.map((n) => {
              const active = location.pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`px-4 h-11 rounded-md font-semibold text-sm inline-flex items-center transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:block text-right leading-tight">
              <div className="text-xs text-muted-foreground">
                {role ? roleLabels[role] : "Kullanıcı"}
              </div>
              <div className="text-sm font-medium text-foreground max-w-[160px] truncate">
                {user?.email}
              </div>
            </div>
            <button
              onClick={async () => {
                await signOut();
                navigate({ to: "/", replace: true });
              }}
              className="h-11 w-11 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center justify-center"
              aria-label="Çıkış"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
        {/* Mobile nav */}
        <nav className="md:hidden border-t border-border overflow-x-auto">
          <div className="flex items-center gap-1 px-2 py-2 min-w-max">
            {nav.map((n) => {
              const active = location.pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`px-4 h-11 rounded-md font-semibold text-sm inline-flex items-center whitespace-nowrap ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground bg-accent/40"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
