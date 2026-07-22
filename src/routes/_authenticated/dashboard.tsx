import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Package,
  PlusCircle,
  UserCog,
  UsersRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage, statusLabels } from "@/lib/domain";
import { formatDate, formatTRY } from "@/lib/format";
import { PageHeader, LoadingState } from "@/components/page-states";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { role } = useAuth();
  const query = useQuery({
    queryKey: ["dashboard", role],
    enabled: Boolean(role),
    queryFn: async () => {
      const { data: orders, error: orderError } = await supabase
        .from("work_orders")
        .select("*, customers(name), work_order_financials(total_amount, approved_progress_pct)")
        .order("scheduled_at", { ascending: false });
      if (orderError) throw orderError;

      let stock: { quantity: number; min_quantity: number }[] = [];
      if (role === "admin" || role === "contractor") {
        const { data, error } = await supabase.from("stock_items").select("quantity, min_quantity");
        if (error) throw error;
        stock = data;
      }
      return { orders, stock };
    },
  });

  if (query.isLoading) return <LoadingState />;
  if (query.error) {
    return <p className="surface-panel p-5 text-destructive">{errorMessage(query.error)}</p>;
  }

  const orders = query.data?.orders ?? [];
  const active = orders.filter((order) => order.status === "in_progress").length;
  const completed = orders.filter((order) => order.status === "completed").length;
  const pendingApproval = orders.filter(
    (order) =>
      role === "admin" &&
      order.progress_pct > (order.work_order_financials?.approved_progress_pct ?? 0),
  ).length;
  const lowStock = (query.data?.stock ?? []).filter(
    (item) => item.quantity <= item.min_quantity,
  ).length;

  const metrics =
    role === "admin"
      ? [
          { label: "Toplam İş Emri", value: orders.length, icon: BriefcaseBusiness },
          { label: "Devam Eden", value: active, icon: Clock3 },
          { label: "Onay Bekleyen", value: pendingApproval, icon: AlertTriangle },
          { label: "Kritik Stok", value: lowStock, icon: Package },
        ]
      : [
          { label: "Aktif İş", value: active, icon: BriefcaseBusiness },
          { label: "Tamamlanan", value: completed, icon: CheckCircle2 },
          { label: "Toplam İş", value: orders.length, icon: Clock3 },
        ];

  const quickActions = [
    {
      label: "Yeni İş Emri",
      description: "Planla ve taşerona ata",
      to: "/work-orders" as const,
      search: { create: true },
      icon: PlusCircle,
    },
    {
      label: "Müşteri Ekle",
      description: "Firma ve portal bağlantısı",
      to: "/customers" as const,
      icon: UsersRound,
    },
    {
      label: "Stok Yönetimi",
      description: "Malzeme ve kritik stok",
      to: "/stock" as const,
      icon: Boxes,
    },
    {
      label: "Ekip ve Yetkiler",
      description: "Yönetici, taşeron, müşteri",
      to: "/team" as const,
      icon: UserCog,
    },
  ];

  return (
    <>
      <PageHeader
        title="Operasyon Paneli"
        description={
          role === "admin"
            ? "Saha, taşeron, ilerleme ve stok durumunun güncel özeti."
            : "Size açık işlerin ve projelerin güncel özeti."
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} className="border-border bg-card">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="rounded-lg bg-primary/15 p-3 text-primary">
                <metric.icon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{metric.label}</p>
                <p className="text-3xl font-black">{metric.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {role === "admin" ? (
        <section className="mt-7">
          <div className="mb-3">
            <h2 className="text-lg font-bold">Hızlı İşlemler</h2>
            <p className="text-sm text-muted-foreground">Sık kullandığınız alanlara tek dokunuşla gidin.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((action) => (
              <Link
                key={action.label}
                to={action.to}
                search={"search" in action ? action.search : undefined}
                className="group surface-panel flex items-center gap-4 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/70 hover:bg-accent/40"
              >
                <span className="rounded-xl bg-primary/15 p-3 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <action.icon className="h-6 w-6" />
                </span>
                <span>
                  <span className="block font-bold">{action.label}</span>
                  <span className="block text-xs text-muted-foreground">{action.description}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Son İş Emirleri</h2>
          <Link
            to={
              role === "customer"
                ? "/my-projects"
                : role === "contractor"
                  ? "/my-jobs"
                  : "/work-orders"
            }
            className="text-sm font-semibold text-primary"
          >
            Tümünü gör
          </Link>
        </div>
        <div className="grid gap-3">
          {orders.slice(0, 6).map((order) => (
            <Link
              key={order.id}
              to="/jobs/$jobId"
              params={{ jobId: order.id }}
              className="surface-panel block p-4 transition-colors hover:border-primary/60"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      #{order.work_order_no}
                    </span>
                    <Badge variant="outline">{statusLabels[order.status]}</Badge>
                  </div>
                  <h3 className="mt-2 truncate font-bold">{order.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {order.customers?.name} · {formatDate(order.scheduled_at)}
                  </p>
                </div>
                <div className="w-full shrink-0 sm:w-56">
                  <div className="mb-1 flex justify-between text-xs">
                    <span>İlerleme</span>
                    <span className="font-bold">%{order.progress_pct}</span>
                  </div>
                  <Progress value={order.progress_pct} />
                  {role === "admin" ? (
                    <p className="mt-2 text-right text-xs text-muted-foreground">
                      {formatTRY(order.work_order_financials?.total_amount)}
                    </p>
                  ) : null}
                </div>
              </div>
            </Link>
          ))}
          {orders.length === 0 ? (
            <div className="surface-panel p-8 text-center text-sm text-muted-foreground">
              Henüz görüntülenecek iş emri yok.
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
