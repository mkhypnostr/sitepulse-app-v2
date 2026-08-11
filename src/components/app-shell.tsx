import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Search,
  ShieldAlert,
  UserCog,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { roleLabels } from "@/lib/domain";
import { isOperationalManager } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { GlobalSearch } from "@/components/global-search";

// Bu liste yalnızca work_orders.status (work_status enum) için kullanılır;
// "not_applicable" ve "external_approval" bu enum'da yok ve sorguya
// eklenirse "invalid input value for enum work_status" hatası verir.
// "draft" da hariç tutulur — taslak bir iş emri henüz aktif iş sayılmaz.
const TERMINAL_STATUSES = ["draft", "completed", "cancelled", "review_pending"];

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: "approvals" | "stock" | "workOrders" | "tasks";
  hash?: string;
}
type NavEntry = NavItem | { separator: true };

export function AppShell({ children }: { children: ReactNode }) {
  const { role, user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPod|iPad/.test(navigator.userAgent);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
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

  // Menü rozet sayıları: yalnızca görsel bir ipucu, karar mantığı değil.
  // Sorgular RLS ile zaten role göre sınırlanır; hata durumunda sessizce 0 gösterilir.
  const operationalManager = isOperationalManager(role);
  const canSeeApprovals =
    role === "admin" || role === "technical_office" || role === "contractor";
  const badgeQuery = useQuery({
    queryKey: ["sidebar-badges", role],
    enabled: canSeeApprovals || operationalManager,
    queryFn: async () => {
      let approvals = 0;
      if (canSeeApprovals) {
        const [completion, progress, projectTasks] = await Promise.all([
          supabase
            .from("work_completion_submissions")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending"),
          supabase
            .from("progress_updates")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending"),
          supabase
            .from("project_task_progress_submissions")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending"),
        ]);
        approvals =
          (completion.count ?? 0) +
          (progress.count ?? 0) +
          (projectTasks.count ?? 0);
      }
      let stock = 0;
      let workOrders = 0;
      let tasks = 0;
      if (operationalManager) {
        const [
          stockResult,
          workOrdersResult,
          projectTasksResult,
          independentTasksResult,
        ] = await Promise.all([
          supabase.from("stock_items").select("quantity, min_quantity"),
          supabase
            .from("work_orders")
            .select("id", { count: "exact", head: true })
            .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`),
          supabase
            .from("project_tasks")
            .select("id", { count: "exact", head: true })
            .not("status", "in", "(completed,cancelled,not_applicable)"),
          supabase
            .from("operational_tasks")
            .select("id", { count: "exact", head: true })
            .not("status", "in", "(completed,cancelled,not_applicable)"),
        ]);
        stock = (stockResult.data ?? []).filter(
          (item) => item.quantity <= item.min_quantity,
        ).length;
        workOrders = workOrdersResult.count ?? 0;
        tasks =
          (projectTasksResult.count ?? 0) + (independentTasksResult.count ?? 0);
      }
      return { approvals, stock, workOrders, tasks };
    },
  });
  const badgeCounts: Record<string, number> = {
    approvals: badgeQuery.data?.approvals ?? 0,
    stock: badgeQuery.data?.stock ?? 0,
    workOrders: badgeQuery.data?.workOrders ?? 0,
    tasks: badgeQuery.data?.tasks ?? 0,
  };

  const nav: NavEntry[] =
    role === "admin"
      ? [
          { to: "/dashboard", label: "Genel Bakış", icon: LayoutDashboard },
          {
            to: "/work-orders",
            label: "İş Emirleri",
            icon: ListChecks,
            badgeKey: "workOrders",
          },
          { to: "/projects", label: "Projeler", icon: FolderKanban },
          {
            to: "/tasks",
            label: "Görevler",
            icon: ClipboardList,
            badgeKey: "tasks",
          },
          { to: "/calendar", label: "Takvim", icon: CalendarDays },
          { separator: true },
          { to: "/stock", label: "Stok", icon: Boxes, badgeKey: "stock" },
          { to: "/dashboard", label: "Finans", icon: Wallet, hash: "finance" },
          { to: "/customers", label: "Müşteriler", icon: UsersRound },
          { separator: true },
          {
            to: "/approvals",
            label: "Onay Merkezi",
            icon: ShieldAlert,
            badgeKey: "approvals",
          },
          { to: "/reports", label: "Raporlar", icon: BarChart3 },
        ]
      : role === "technical_office"
        ? [
            { to: "/dashboard", label: "Genel Bakış", icon: LayoutDashboard },
            {
              to: "/work-orders",
              label: "İş Emirleri",
              icon: ListChecks,
              badgeKey: "workOrders",
            },
            { to: "/projects", label: "Projeler", icon: FolderKanban },
            {
              to: "/tasks",
              label: "Görevler",
              icon: ClipboardList,
              badgeKey: "tasks",
            },
            { to: "/calendar", label: "Takvim", icon: CalendarDays },
            { separator: true },
            { to: "/stock", label: "Stok", icon: Boxes, badgeKey: "stock" },
            { to: "/customers", label: "Müşteriler", icon: UsersRound },
            { separator: true },
            {
              to: "/approvals",
              label: "Onay Merkezi",
              icon: ShieldAlert,
              badgeKey: "approvals",
            },
          ]
        : role === "contractor"
          ? [
              { to: "/dashboard", label: "Panel", icon: LayoutDashboard },
              {
                to: "/approvals",
                label: "Onay ve Uyarı Merkezi",
                icon: ShieldAlert,
                badgeKey: "approvals",
              },
              { to: "/my-jobs", label: "Görevlerim", icon: BriefcaseBusiness },
              {
                to: "/my-project-tasks",
                label: "Proje Görevlerim",
                icon: ClipboardList,
              },
              { to: "/calendar", label: "Takvim", icon: CalendarDays },
            ]
          : [
              { to: "/dashboard", label: "Panel", icon: LayoutDashboard },
              { to: "/my-projects", label: "Projelerim", icon: FolderKanban },
              { to: "/my-jobs", label: "Görevlerim", icon: BriefcaseBusiness },
            ];

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/", replace: true });
  };

  const navLink = (item: NavItem, closeAfterClick: boolean) => {
    const active = location.pathname.startsWith(item.to);
    const badgeCount = item.badgeKey ? badgeCounts[item.badgeKey] : 0;
    return (
      <Link
        key={item.label}
        to={item.to}
        hash={item.hash}
        onClick={() => closeAfterClick && setMobileOpen(false)}
        className={`relative flex h-9 shrink-0 items-center gap-3 overflow-hidden rounded-lg px-[13px] text-sm font-bold whitespace-nowrap transition-colors ${
          active
            ? "bg-sidebar-active text-foreground before:absolute before:left-0 before:top-1/2 before:h-6 before:w-[2px] before:-translate-y-1/2 before:rounded-r before:bg-sidebar-active-border"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <item.icon className="h-5 w-5 shrink-0" />
        <span className="sidebar-reveal">{item.label}</span>
        {badgeCount > 0 ? (
          <span className="sidebar-reveal ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-black text-primary-foreground">
            {badgeCount}
          </span>
        ) : null}
      </Link>
    );
  };

  const navigation = (closeAfterClick = false) => (
    // flex + gap-0.5 (space-y yerine): ayırıcıların kendi margin'iyle
    // (my-0.5) çakışmayan, öngörülebilir tek bir dikey ritim. py-2/gap-0.5,
    // 100% zoom'da tipik masaüstü ekran yüksekliğinde en uzun rol menüsünün
    // (admin, 12 öğe) bile scroll'a düşmeden sığması için sıkılaştırıldı;
    // overflow-y-auto + min-h-0 güvenlik ağı olarak kalıyor — daha kısa
    // ekranlarda menü hâlâ kayabilir, içerik asla erişilemez olmuyor.
    <nav className="sidebar-nav-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2 py-2">
      {nav.map((item, index) =>
        "separator" in item ? (
          <div
            key={`sep-${index}`}
            className="my-0.5 shrink-0 border-t border-sidebar-border"
          />
        ) : (
          navLink(item, closeAfterClick)
        ),
      )}
    </nav>
  );

  const accountArea = () => (
    <div className="border-t border-sidebar-border p-2">
      {/* Avatar + isim/rol tek tıklanabilir profil giriş noktası: daraltılmış
          sidebar'da yalnızca avatar görünür ama Link tüm satırı kaplıyor, bu
          yüzden avatara tıklamak da yeterli. aria-label, sidebar-reveal ile
          görsel olarak gizlenen metne screen reader için net bir yedek sağlar;
          title ise daraltılmış haldeyken native tooltip veriyor. */}
      <Link
        to="/profile"
        title={`Profilim — ${displayName} · ${role ? roleLabels[role] : "Kullanıcı"}`}
        aria-label={`Profilim: ${displayName}, ${role ? roleLabels[role] : "Kullanıcı"}`}
        className="mb-0.5 flex items-center gap-3 rounded-lg px-[13px] py-1 transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-active-border"
      >
        {/* sidebar-avatar-center: daraltılmış (hover olmayan) durumda 32px
            avatarın merkezini 20px nav ikonlarının merkez hizasına getirmek
            için 6px sola kaydırır ((32-20)/2px, ikisi de aynı sol kenardan
            [px-13px] başladığı için). transform layout'u etkilemediğinden
            geniş sidebar'da (hover) transform sıfırlanınca isim/rol
            satırının konumu hiç değişmiyor. */}
        <span className="sidebar-avatar-center flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-black text-primary">
          {displayName.slice(0, 1)}
        </span>
        <span className="sidebar-reveal leading-tight">
          <span className="block truncate text-sm font-bold text-foreground">
            {displayName}
          </span>
          <span className="block truncate text-xs font-semibold text-muted-foreground">
            {role ? roleLabels[role] : "Kullanıcı"}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={handleSignOut}
        className="flex h-9 w-full items-center gap-3 overflow-hidden rounded-lg px-[13px] text-sm font-bold whitespace-nowrap text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <LogOut className="h-5 w-5 shrink-0" />
        <span className="sidebar-reveal">Çıkış Yap</span>
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-background">
      <aside className="group sidebar-transition sticky top-0 z-40 hidden h-screen w-14 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground hover:w-[210px] lg:flex">
        <Link
          to="/dashboard"
          className="flex h-16 shrink-0 items-center gap-3 overflow-hidden border-b border-sidebar-border px-[13px]"
        >
          <img
            src="/app-icon.svg"
            alt="NES Enerji"
            className="h-8 w-8 shrink-0 rounded-lg bg-white object-cover shadow-sm"
          />
          <span className="sidebar-reveal leading-tight">
            <span className="block text-sm font-black tracking-wide text-foreground">
              NES ENERJİ
            </span>
            <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-highlight">
              Saha Operasyon
            </span>
          </span>
        </Link>
        <div className="shrink-0 px-2 pt-1">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-9 w-full items-center gap-3 overflow-hidden rounded-lg px-[13px] text-sm font-bold whitespace-nowrap text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Search className="h-5 w-5 shrink-0" />
            <span className="sidebar-reveal">Ara</span>
            <span className="sidebar-reveal ml-auto shrink-0 rounded border border-sidebar-border px-1.5 py-0.5 text-[10px] font-black text-muted-foreground">
              {isMac ? "⌘K" : "Ctrl K"}
            </span>
          </button>
        </div>
        {navigation()}
        {accountArea()}
      </aside>

      <div className="min-w-0 flex-1">
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
            <img
              src="/app-icon.svg"
              alt="NES Enerji"
              className="h-9 w-9 rounded-lg bg-white"
            />
            <div className="leading-tight">
              <div className="text-sm font-black">NES ENERJİ</div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-highlight">
                Saha Operasyon
              </div>
            </div>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <span className="max-w-20 truncate text-xs text-muted-foreground">
              {displayName}
            </span>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sidebar-border text-foreground"
              aria-label="Ara"
            >
              <Search className="h-5 w-5" />
            </button>
          </div>
        </header>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
              aria-label="Menüyü kapat"
            />
            <aside className="relative flex h-full w-[82%] max-w-80 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl">
              <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
                <img
                  src="/app-icon.svg"
                  alt="NES Enerji"
                  className="h-11 w-11 rounded-xl bg-white"
                />
                <div className="leading-tight">
                  <div className="font-black">NES ENERJİ</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-highlight">
                    Saha Operasyon
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-xl border border-sidebar-border"
                  aria-label="Menüyü kapat"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
                {nav.map((item, index) =>
                  "separator" in item ? (
                    <div
                      key={`sep-mobile-${index}`}
                      className="my-2 border-t border-sidebar-border"
                    />
                  ) : (
                    (() => {
                      const active = location.pathname.startsWith(item.to);
                      const badgeCount = item.badgeKey
                        ? badgeCounts[item.badgeKey]
                        : 0;
                      return (
                        <Link
                          key={item.label}
                          to={item.to}
                          hash={item.hash}
                          onClick={() => setMobileOpen(false)}
                          className={`relative flex min-h-12 items-center gap-3 rounded-xl px-4 text-sm font-bold transition-colors ${
                            active
                              ? "bg-sidebar-active text-foreground before:absolute before:left-0 before:top-1/2 before:h-6 before:w-[2px] before:-translate-y-1/2 before:rounded-r before:bg-sidebar-active-border"
                              : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                          }`}
                        >
                          <item.icon className="h-5 w-5 shrink-0" />
                          {item.label}
                          {badgeCount > 0 ? (
                            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-black text-primary-foreground">
                              {badgeCount}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })()
                  ),
                )}
              </nav>
              <div className="border-t border-sidebar-border p-3">
                <Link
                  to="/profile"
                  onClick={() => setMobileOpen(false)}
                  className="mb-3 block rounded-xl bg-sidebar-accent/60 p-3 transition-colors hover:bg-sidebar-accent"
                >
                  <p className="text-xs font-semibold text-muted-foreground">
                    {role ? roleLabels[role] : "Kullanıcı"}
                  </p>
                  <p className="mt-1 truncate text-sm font-bold text-foreground">
                    {displayName}
                  </p>
                </Link>
                <Link
                  to="/profile"
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-sm font-bold text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <UserCog className="h-5 w-5" /> Profilim
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-sm font-bold text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <LogOut className="h-5 w-5" /> Çıkış Yap
                </button>
              </div>
            </aside>
          </div>
        ) : null}

        <main className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
