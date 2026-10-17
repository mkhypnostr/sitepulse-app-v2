import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FolderKanban,
  FolderOpen,
  Landmark,
  LayoutDashboard,
  Map as MapIcon,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Search,
  ShieldAlert,
  Sun,
  Target,
  UserCog,
  UsersRound,
  Wallet,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { roleLabels } from "@/lib/domain";
import { isOperationalManager } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { GlobalSearch } from "@/components/global-search";
import { useTheme } from "@/lib/theme";
import { PushBanner } from "@/components/push-settings";
import { refreshPushSubscription } from "@/lib/push";

// Bu liste yalnızca work_orders.status (work_status enum) için kullanılır;
// "not_applicable" ve "external_approval" bu enum'da yok ve sorguya
// eklenirse "invalid input value for enum work_status" hatası verir.
// "draft" da hariç tutulur — taslak bir iş emri henüz aktif iş sayılmaz.
const TERMINAL_STATUSES = ["draft", "completed", "cancelled", "review_pending"];

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: "approvals" | "stock" | "tasks" | "sales";
  hash?: string;
}
type NavEntry = NavItem | { section: string };

export function AppShell({ children }: { children: ReactNode }) {
  const { role, user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Masaüstünde menü etiketleriyle açık sabitlenebilir (tarayıcıda hatırlanır).
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    try {
      setPinned(window.localStorage.getItem("nes-sidebar-pinned") === "1");
    } catch {
      // Depolama kapalıysa varsayılan: daraltılmış.
    }
  }, []);
  // Daraltılmış menü üzerine gelince (veya klavyeyle içine girilince) geçici
  // olarak açılır. "Menüyü daralt"a basıldığında fare hâlâ menünün üzerinde
  // olsa bile hemen kapanması için bu durum CSS :hover yerine burada tutulur.
  const [peek, setPeek] = useState(false);
  // Daraltma düğmesine basıldıktan sonra fare menüden bir kez çıkana kadar
  // menü kendiliğinden yeniden açılmaz (daralırken içerik kaydığı için
  // tarayıcı yeni bir "fare girdi" olayı üretebiliyor).
  const peekBlocked = useRef(false);
  // Üzerinden geçerken açılmasın: fare kısa bir an durunca açılır, çıkınca
  // kısa bir gecikmeyle kapanır (yanlışlıkla taşınca titremez).
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePeek = (open: boolean, delay: number) => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(open), delay);
  };
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    [],
  );
  const togglePinned = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    setPeek(false);
    peekBlocked.current = true;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setPinned((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("nes-sidebar-pinned", next ? "1" : "0");
      } catch {
        // Hatırlanamazsa yalnız bu oturumda geçerli olur.
      }
      return next;
    });
  };
  // Bildirim izni verilmiş cihazda aboneliği bu hesaba (yeniden) bağla.
  useEffect(() => {
    if (user?.id) void refreshPushSubscription();
  }, [user?.id]);
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
            .select("id, responsible_id, approved_progress_pct, status")
            .not("status", "in", "(completed,cancelled,not_applicable)"),
          supabase
            .from("operational_tasks")
            .select("id", { count: "exact", head: true })
            .not("status", "in", "(completed,cancelled,not_applicable)"),
        ]);
        stock = (stockResult.data ?? []).filter(
          (item) => item.quantity <= item.min_quantity,
        ).length;
        tasks =
          (workOrdersResult.count ?? 0) +
          (projectTasksResult.data ?? []).filter(
            (task) =>
              Boolean(task.responsible_id) ||
              task.approved_progress_pct > 0 ||
              [
                "in_progress",
                "external_approval",
                "revision_required",
                "blocked",
              ].includes(task.status),
          ).length +
          (independentTasksResult.count ?? 0);
      }
      // Satış: bugün veya daha önce planlanmış, açık fırsatlardaki adımlar.
      let sales = 0;
      if (role === "admin") {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const { count } = await supabase
          .from("sales_leads")
          .select("id", { count: "exact", head: true })
          .lte("next_action_at", today)
          .not("stage", "in", "(kazanildi,kaybedildi)");
        sales = count ?? 0;
      }
      return { approvals, stock, tasks, sales };
    },
  });
  const badgeCounts: Record<string, number> = {
    approvals: badgeQuery.data?.approvals ?? 0,
    stock: badgeQuery.data?.stock ?? 0,
    tasks: badgeQuery.data?.tasks ?? 0,
    sales: badgeQuery.data?.sales ?? 0,
  };

  const nav: NavEntry[] =
    role === "admin"
      ? [
          { to: "/dashboard", label: "Genel Bakış", icon: LayoutDashboard },
          {
            to: "/tasks",
            label: "Görevler",
            icon: ClipboardList,
            badgeKey: "tasks",
          },
          { to: "/calendar", label: "Takvim", icon: CalendarDays },
          { to: "/map", label: "Harita", icon: MapIcon },
          { section: "Saha ve proje" },
          { to: "/projects", label: "Projeler", icon: FolderKanban },
          {
            to: "/service-requests",
            label: "Servis Talepleri",
            icon: Wrench,
          },
          { to: "/stock", label: "Stok", icon: Boxes, badgeKey: "stock" },
          { to: "/shared-files", label: "Ortak Dosyalar", icon: FolderOpen },
          { section: "Satış" },
          {
            to: "/sales",
            label: "Satış Takibi",
            icon: Target,
            badgeKey: "sales",
          },
          { to: "/offers", label: "Teklifler", icon: Receipt },
          { to: "/customers", label: "Müşteriler", icon: UsersRound },
          { section: "Finans" },
          {
            to: "/dashboard",
            label: "Finans Özeti",
            icon: Wallet,
            hash: "finance",
          },
          { to: "/receivables", label: "Cari Hesaplar", icon: Landmark },
          {
            to: "/measurement-tracking",
            label: "Ölçüm ve Tahsilat",
            icon: ClipboardList,
          },
          {
            to: "/transformer-responsibility",
            label: "Trafo Sorumluluğu",
            icon: ShieldAlert,
          },
          { section: "Yönetim" },
          {
            to: "/approvals",
            label: "Onay Merkezi",
            icon: ShieldAlert,
            badgeKey: "approvals",
          },
          { to: "/automations", label: "Otomatik Görevler", icon: Zap },
          { to: "/reports", label: "Raporlar", icon: BarChart3 },
          { to: "/team", label: "Ekip ve Yetkiler", icon: UserCog },
        ]
      : role === "technical_office"
        ? [
            { to: "/dashboard", label: "Genel Bakış", icon: LayoutDashboard },
            {
              to: "/tasks",
              label: "Görevler",
              icon: ClipboardList,
              badgeKey: "tasks",
            },
            { to: "/calendar", label: "Takvim", icon: CalendarDays },
            { to: "/map", label: "Harita", icon: MapIcon },
            { section: "Saha ve proje" },
            { to: "/projects", label: "Projeler", icon: FolderKanban },
            {
              to: "/service-requests",
              label: "Servis Talepleri",
              icon: Wrench,
            },
            { to: "/stock", label: "Stok", icon: Boxes, badgeKey: "stock" },
            {
              to: "/shared-files",
              label: "Ortak Dosyalar",
              icon: FolderOpen,
            },
            { section: "Yönetim" },
            { to: "/customers", label: "Müşteriler", icon: UsersRound },
            {
              to: "/approvals",
              label: "Onay Merkezi",
              icon: ShieldAlert,
              badgeKey: "approvals",
            },
            { to: "/team", label: "Taşeronlar", icon: UserCog },
          ]
        : role === "contractor"
          ? [
              { to: "/dashboard", label: "Panel", icon: LayoutDashboard },
              { to: "/my-jobs", label: "Görevlerim", icon: BriefcaseBusiness },
              {
                to: "/my-project-tasks",
                label: "Proje Görevlerim",
                icon: ClipboardList,
              },
              {
                to: "/approvals",
                label: "Onay ve Uyarı Merkezi",
                icon: ShieldAlert,
                badgeKey: "approvals",
              },
              { to: "/calendar", label: "Takvim", icon: CalendarDays },
            ]
          : [
              { to: "/dashboard", label: "Panel", icon: LayoutDashboard },
              { to: "/my-projects", label: "Projelerim", icon: FolderKanban },
              { to: "/my-jobs", label: "Görevlerim", icon: BriefcaseBusiness },
              {
                to: "/service-requests",
                label: "Teknik Servis",
                icon: Wrench,
              },
            ];

  // Telefonda alt çubukta duran en sık kullanılan ekranlar (rol bazında).
  const bottomPaths: Record<string, string[]> = {
    admin: ["/dashboard", "/tasks", "/sales", "/calendar"],
    technical_office: ["/dashboard", "/tasks", "/projects", "/calendar"],
    contractor: ["/dashboard", "/my-jobs", "/my-project-tasks", "/calendar"],
    customer: ["/dashboard", "/my-projects", "/my-jobs", "/service-requests"],
  };
  const bottomItems = (bottomPaths[role ?? "customer"] ?? [])
    .map((path) =>
      nav.find(
        (item): item is NavItem =>
          "to" in item && item.to === path && !item.hash,
      ),
    )
    .filter((item): item is NavItem => Boolean(item));

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/", replace: true });
  };

  const navItems = nav.filter((item): item is NavItem => !("section" in item));
  const currentHash = location.hash.replace(/^#/, "");
  // Aynı sayfaya giden öğeler (Genel Bakış / Finans Özeti) için hash ayrımı:
  // hash'li öğe yalnız hash eşleşince, hash'siz öğe ise eşleşen hash'li bir
  // kardeşi yokken aktif sayılır.
  const isActive = (item: NavItem) => {
    if (!location.pathname.startsWith(item.to)) return false;
    if (item.hash) return currentHash === item.hash;
    return !navItems.some(
      (other) =>
        other !== item &&
        other.to === item.to &&
        other.hash &&
        other.hash === currentHash,
    );
  };

  const roleLabel = role ? roleLabels[role] : "Kullanıcı";

  // Masaüstü menü öğesi. Daraltılmışken yalnız renkli ikon karesi görünür;
  // üzerine gelince ya da sabitliyken ad ve rozet açılır (sidebar-reveal).
  const navLink = (item: NavItem) => {
    const active = isActive(item);
    const badgeCount = item.badgeKey ? badgeCounts[item.badgeKey] : 0;
    return (
      <Link
        key={item.label}
        to={item.to}
        hash={item.hash}
        title={item.label}
        aria-label={item.label}
        className={`press relative flex h-9 shrink-0 items-center gap-3 rounded-xl px-[12px] text-[14px] whitespace-nowrap ${
          active
            ? "bg-sidebar-active font-semibold text-foreground shadow-[0_1px_3px_oklch(0_0_0/0.08)]"
            : "font-medium text-foreground/80 hover:bg-sidebar-accent hover:text-foreground"
        }`}
      >
        <span className="relative">
          <NavIconTile item={item} />
          {badgeCount > 0 ? (
            <span className="sidebar-collapsed-only absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-card" />
          ) : null}
        </span>
        <span className="sidebar-reveal truncate">{item.label}</span>
        {badgeCount > 0 ? (
          <CountBadge count={badgeCount} className="sidebar-reveal ml-auto" />
        ) : null}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-background lg:flex">
      {/* Masaüstü: yerleşimde dar bir yer tutucu; asıl kenar çubuğu onun
          üzerinde yüzer. Daraltılmışken yalnız ikonlar görünür, üzerine
          gelince içeriğin üstüne açılır (sayfa kaymaz). Sabitlenince yer
          tutucu da genişler. */}
      <div
        className={`sidebar-transition hidden shrink-0 lg:block ${pinned ? "w-[260px]" : "w-[88px]"}`}
      >
        <aside
          data-pinned={pinned ? "true" : "false"}
          data-expanded={pinned || peek ? "true" : "false"}
          onMouseEnter={() => {
            if (!peekBlocked.current) schedulePeek(true, 140);
          }}
          onMouseLeave={() => {
            peekBlocked.current = false;
            schedulePeek(false, 120);
          }}
          onFocus={(event) => {
            if (!peekBlocked.current && event.target.matches(":focus-visible"))
              setPeek(true);
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setPeek(false);
            }
          }}
          className={`group glass sidebar-transition fixed top-3 bottom-3 left-3 z-40 flex flex-col overflow-hidden rounded-[28px] text-sidebar-foreground ${
            pinned || peek ? "w-[248px]" : "w-[76px]"
          }`}
        >
          <Link
            to="/dashboard"
            title="NES Enerji"
            className="flex shrink-0 items-center gap-3 px-[18px] pt-3.5 pb-2.5"
          >
            <img
              src="/app-icon.svg"
              alt="NES Enerji"
              className="h-10 w-10 shrink-0 rounded-[11px] bg-white object-cover shadow-[0_1px_3px_oklch(0_0_0/0.15)]"
            />
            <span className="sidebar-reveal leading-tight">
              <span className="block text-[15px] font-semibold tracking-tight text-foreground">
                NES Enerji
              </span>
              <span className="block text-xs text-muted-foreground">
                Saha Operasyon
              </span>
            </span>
          </Link>
          <div className="shrink-0 px-3 pb-1">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              title="Ara"
              className="press flex h-9 w-full items-center gap-3 rounded-xl bg-foreground/[0.05] px-[18px] text-sm whitespace-nowrap text-muted-foreground hover:bg-foreground/[0.08]"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="sidebar-reveal truncate">Ara</span>
              <span className="sidebar-reveal ml-auto shrink-0 text-[11px] font-medium text-muted-foreground/80">
                {isMac ? "⌘K" : "Ctrl K"}
              </span>
            </button>
          </div>
          <nav className="sidebar-nav-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-3 py-2">
            {nav.map((item, index) =>
              "section" in item ? (
                <div key={`sec-${index}`} className="shrink-0 pt-1.5 pb-0.5">
                  <div className="sidebar-collapsed-only mx-3 border-t border-sidebar-border" />
                  <p className="sidebar-reveal px-[12px] text-[12px] whitespace-nowrap font-semibold text-muted-foreground">
                    {item.section}
                  </p>
                </div>
              ) : (
                navLink(item)
              ),
            )}
          </nav>
          <div className="shrink-0 space-y-1 border-t border-sidebar-border p-3">
            <Link
              to="/profile"
              title={`Profilim — ${displayName} · ${roleLabel}`}
              aria-label={`Profilim: ${displayName}, ${roleLabel}`}
              className="press flex items-center gap-3 rounded-xl px-[10px] py-1.5 hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:outline-none"
            >
              <Avatar name={displayName} />
              <span className="sidebar-reveal min-w-0 leading-tight">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {displayName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {roleLabel}
                </span>
              </span>
            </Link>
            {/* Daraltılmışken yalnız "sabitle" düğmesi görünür; açılınca tema
                ve çıkış da aynı satıra gelir — alt alan yüksekliği sabit kalır. */}
            <div className="flex h-9 items-center gap-1 pl-2">
              <SidebarIconButton
                onClick={togglePinned}
                icon={pinned ? PanelLeftClose : PanelLeftOpen}
                label={pinned ? "Menüyü daralt" : "Menüyü sabitle"}
                pressed={pinned}
              />
              <div className="sidebar-reveal flex items-center gap-1">
                <SidebarIconButton
                  onClick={toggleTheme}
                  icon={theme === "dark" ? Sun : Moon}
                  label={theme === "dark" ? "Açık tema" : "Koyu tema"}
                />
                <SidebarIconButton
                  onClick={handleSignOut}
                  icon={LogOut}
                  label="Çıkış yap"
                  danger
                />
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="min-w-0 flex-1">
        {/* Mobil: üstte cam başlık çubuğu. */}
        <header className="glass sticky top-0 z-30 flex h-14 items-center rounded-none border-x-0 border-t-0 px-4 shadow-none lg:hidden">
          <Link to="/dashboard" className="flex items-center gap-2.5">
            <img
              src="/app-icon.svg"
              alt="NES Enerji"
              className="h-8 w-8 rounded-[9px] bg-white shadow-[0_1px_3px_oklch(0_0_0/0.15)]"
            />
            <span className="text-[15px] font-semibold tracking-tight">
              NES Enerji
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="press inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-foreground/5"
              aria-label="Ara"
            >
              <Search className="h-5 w-5" />
            </button>
            <Link
              to="/profile"
              aria-label={`Profilim: ${displayName}`}
              className="press inline-flex h-10 w-10 items-center justify-center rounded-full"
            >
              <Avatar name={displayName} />
            </Link>
          </div>
        </header>

        <main className="mx-auto min-h-screen w-full max-w-[1500px] px-4 pt-6 pb-32 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">
          {location.pathname.startsWith("/dashboard") ? (
            <PushBanner
              onOpenProfile={() =>
                navigate({ to: "/profile", hash: "bildirimler" })
              }
            />
          ) : null}
          {children}
        </main>

        {/* Mobil: iOS tarzı yüzen alt sekme çubuğu. */}
        <nav
          className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex h-16 items-stretch justify-around rounded-[26px] px-1 lg:hidden"
          aria-label="Hızlı menü"
        >
          {bottomItems.map((item) => {
            const active = isActive(item);
            const badgeCount = item.badgeKey ? badgeCounts[item.badgeKey] : 0;
            return (
              <Link
                key={item.label}
                to={item.to}
                hash={item.hash}
                className={`press relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[20px] ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <span className="relative">
                  <item.icon
                    className="h-[22px] w-[22px]"
                    strokeWidth={active ? 2.4 : 1.9}
                  />
                  {badgeCount > 0 ? (
                    <CountBadge
                      count={badgeCount}
                      className="absolute -top-1.5 -right-2.5"
                    />
                  ) : null}
                </span>
                <span
                  className={`max-w-full truncate px-1 text-[10px] ${active ? "font-semibold" : "font-medium"}`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className={`press flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[20px] ${
              mobileOpen ? "text-primary" : "text-muted-foreground"
            }`}
            aria-label="Menüyü aç"
          >
            <Menu className="h-[22px] w-[22px]" strokeWidth={1.9} />
            <span className="text-[10px] font-medium">Menü</span>
          </button>
        </nav>

        {/* Mobil: aşağıdan açılan iOS sayfası — bölüm başlıklı gruplu liste. */}
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
              aria-label="Menüyü kapat"
            />
            <div className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-[28px] bg-background shadow-[var(--float-shadow)] animate-in slide-in-from-bottom duration-300">
              <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-foreground/15" />
              <div className="flex shrink-0 items-center px-5 pt-3 pb-2">
                <h2 className="text-xl font-bold tracking-tight">Menü</h2>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="press ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground/[0.07] text-muted-foreground"
                  aria-label="Menüyü kapat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                <Link
                  to="/profile"
                  onClick={() => setMobileOpen(false)}
                  className="press flex items-center gap-3 rounded-2xl bg-card p-3 shadow-[var(--panel-shadow)]"
                >
                  <Avatar name={displayName} size="lg" />
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-[15px] font-semibold">
                      {displayName}
                    </span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {roleLabel} · Profilim
                    </span>
                  </span>
                </Link>
                {groupNav(nav).map((group, groupIndex) => (
                  <div key={`group-${groupIndex}`}>
                    {group.title ? (
                      <p className="px-4 pb-1.5 text-[13px] text-muted-foreground">
                        {group.title}
                      </p>
                    ) : null}
                    <div className="overflow-hidden rounded-2xl bg-card shadow-[var(--panel-shadow)]">
                      {group.items.map((item, index) => {
                        const active = isActive(item);
                        const badgeCount = item.badgeKey
                          ? badgeCounts[item.badgeKey]
                          : 0;
                        return (
                          <Link
                            key={item.label}
                            to={item.to}
                            hash={item.hash}
                            onClick={() => setMobileOpen(false)}
                            className={`flex min-h-12 items-center gap-3 pl-3 transition-colors active:bg-foreground/5 ${
                              active ? "bg-primary/[0.06]" : ""
                            }`}
                          >
                            <NavIconTile item={item} />
                            <span
                              className={`flex min-h-12 flex-1 items-center gap-2 pr-3 text-[15px] ${
                                index > 0 ? "border-t border-border/70" : ""
                              } ${active ? "font-semibold text-primary" : "font-medium"}`}
                            >
                              <span className="truncate">{item.label}</span>
                              {badgeCount > 0 ? (
                                <CountBadge count={badgeCount} />
                              ) : null}
                              <ChevronRight
                                className={`h-4 w-4 shrink-0 text-muted-foreground/60 ${badgeCount > 0 ? "ml-1" : "ml-auto"}`}
                              />
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="overflow-hidden rounded-2xl bg-card shadow-[var(--panel-shadow)]">
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="flex min-h-12 w-full items-center gap-3 px-3 text-[15px] font-medium active:bg-foreground/5"
                  >
                    <IconTile className="bg-indigo-500">
                      {theme === "dark" ? (
                        <Sun className="h-4 w-4" />
                      ) : (
                        <Moon className="h-4 w-4" />
                      )}
                    </IconTile>
                    {theme === "dark" ? "Açık tema" : "Koyu tema"}
                  </button>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex min-h-12 w-full items-center gap-3 border-t border-border/70 px-3 text-[15px] font-medium text-destructive active:bg-foreground/5"
                  >
                    <IconTile className="bg-red-500">
                      <LogOut className="h-4 w-4" />
                    </IconTile>
                    Çıkış Yap
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function SidebarIconButton({
  onClick,
  icon: Icon,
  label,
  pressed,
  danger = false,
}: {
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground ${
        danger
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-sidebar-accent hover:text-foreground"
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

// Menüyü bölüm başlıklarına göre gruplara böler (iOS gruplu liste için).
function groupNav(entries: NavEntry[]) {
  const groups: { title?: string; items: NavItem[] }[] = [{ items: [] }];
  for (const entry of entries) {
    if ("section" in entry) groups.push({ title: entry.section, items: [] });
    else groups[groups.length - 1].items.push(entry);
  }
  return groups.filter((group) => group.items.length > 0);
}

// iOS Ayarlar tarzı renkli ikon kareleri: her bölümün kendi rengi var.
const NAV_TILE_COLORS: Record<string, string> = {
  "/dashboard": "bg-blue-500",
  "/dashboard#finance": "bg-emerald-500",
  "/tasks": "bg-orange-500",
  "/calendar": "bg-red-500",
  "/map": "bg-lime-600",
  "/projects": "bg-indigo-500",
  "/service-requests": "bg-zinc-500",
  "/stock": "bg-amber-600",
  "/shared-files": "bg-sky-500",
  "/sales": "bg-pink-500",
  "/offers": "bg-green-600",
  "/customers": "bg-violet-500",
  "/receivables": "bg-emerald-700",
  "/measurement-tracking": "bg-teal-500",
  "/transformer-responsibility": "bg-yellow-500",
  "/approvals": "bg-rose-500",
  "/automations": "bg-purple-500",
  "/reports": "bg-cyan-600",
  "/team": "bg-slate-600",
  "/my-jobs": "bg-orange-500",
  "/my-project-tasks": "bg-indigo-500",
  "/my-projects": "bg-indigo-500",
};

function IconTile({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.25)] ${className}`}
    >
      {children}
    </span>
  );
}

function NavIconTile({ item }: { item: NavItem }) {
  const key = item.hash ? `${item.to}#${item.hash}` : item.to;
  return (
    <IconTile className={NAV_TILE_COLORS[key] ?? "bg-slate-500"}>
      <item.icon className="h-4 w-4" strokeWidth={2.2} />
    </IconTile>
  );
}

// iOS bildirim rozeti: kırmızı hap içinde sayı.
function CountBadge({
  count,
  className = "ml-auto",
}: {
  count: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-white tabular-nums ${className}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-slate-400 to-slate-500 font-semibold text-white ${
        size === "lg" ? "h-11 w-11 text-base" : "h-8 w-8 text-xs"
      }`}
    >
      {name.slice(0, 1)}
    </span>
  );
}
