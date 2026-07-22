import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  BriefcaseBusiness,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  UserCog,
  UsersRound,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { roleLabels } from "@/lib/domain";
import { supabase } from "@/integrations/supabase/client";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { role, user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const profileQuery = useQuery({
    queryKey: ["current-profile", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const displayName = (
    profileQuery.data?.full_name?.trim() ||
    user?.email ||
    "Kullanıcı"
  ).toLocaleUpperCase("tr-TR");

  const nav: NavItem[] =
    role === "admin"
      ? [
          { to: "/dashboard", label: "Panel", icon: LayoutDashboard },
          { to: "/projects", label: "Projeler ve Şantiyeler", icon: FolderKanban },
          { to: "/work-orders", label: "İş Emirleri", icon: ClipboardList },
          { to: "/customers", label: "Müşteriler", icon: UsersRound },
          { to: "/stock", label: "Stok", icon: Boxes },
          { to: "/team", label: "Ekip ve Yetkiler", icon: UserCog },
          { to: "/reports", label: "Raporlar", icon: BarChart3 },
        ]
      : role === "contractor"
        ? [
            { to: "/dashboard", label: "Panel", icon: LayoutDashboard },
            { to: "/my-jobs", label: "İşlerim", icon: BriefcaseBusiness },
          ]
        : [
            { to: "/dashboard", label: "Panel", icon: LayoutDashboard },
            { to: "/my-projects", label: "Projelerim", icon: FolderKanban },
          ];

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/", replace: true });
  };

  const navigation = (closeAfterClick = false) => (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {nav.map((item) => {
        const active = location.pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => closeAfterClick && setMobileOpen(false)}
            className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-bold transition-colors ${
              active
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/15"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            }`}
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const accountArea = () => (
    <div className="border-t border-sidebar-border p-3">
      <div className="mb-3 rounded-xl bg-sidebar-accent/60 p-3">
        <p className="text-xs font-semibold text-muted-foreground">
          {role ? roleLabels[role] : "Kullanıcı"}
        </p>
        <p className="mt-1 truncate text-sm font-bold text-foreground">{displayName}</p>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-sm font-bold text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <LogOut className="h-5 w-5" /> Çıkış Yap
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Link
          to="/dashboard"
          className="flex h-20 shrink-0 items-center gap-3 border-b border-sidebar-border px-5"
        >
          <img
            src="/app-icon.svg"
            alt="NES Enerji"
            className="h-11 w-11 rounded-xl bg-white object-cover shadow-sm"
          />
          <div className="leading-tight">
            <div className="text-base font-black tracking-wide text-foreground">NES ENERJİ</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Saha Operasyon
            </div>
          </div>
        </Link>
        {navigation()}
        {accountArea()}
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center border-b border-sidebar-border bg-sidebar/95 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-sidebar-border text-foreground"
          aria-label="Menüyü aç"
        >
          <Menu className="h-6 w-6" />
        </button>
        <Link to="/dashboard" className="ml-3 flex items-center gap-2">
          <img src="/app-icon.svg" alt="NES Enerji" className="h-9 w-9 rounded-lg bg-white" />
          <div className="leading-tight">
            <div className="text-sm font-black">NES ENERJİ</div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-primary">
              Saha Operasyon
            </div>
          </div>
        </Link>
        <span className="ml-auto max-w-32 truncate text-xs text-muted-foreground">
          {displayName}
        </span>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-label="Menüyü kapat"
          />
          <aside className="relative flex h-full w-[82%] max-w-80 flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex h-20 items-center gap-3 border-b border-sidebar-border px-5">
              <img src="/app-icon.svg" alt="NES Enerji" className="h-11 w-11 rounded-xl bg-white" />
              <div className="leading-tight">
                <div className="font-black">NES ENERJİ</div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                  Saha Operasyon
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sidebar-border"
                aria-label="Menüyü kapat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {navigation(true)}
            {accountArea()}
          </aside>
        </div>
      ) : null}

      <main className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
