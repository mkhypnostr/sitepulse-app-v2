import { Link } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import { statusLabels } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/page-states";

type Order = Database["public"]["Tables"]["work_orders"]["Row"] & {
  customers: { name: string } | null;
};

export function JobList({ orders, emptyLabel }: { orders: Order[]; emptyLabel: string }) {
  if (orders.length === 0) {
    return (
      <EmptyState title={emptyLabel} description="Yeni bir kayıt açıldığında burada görünecek." />
    );
  }

  return (
    <div className="grid gap-4">
      {orders.map((order) => (
        <Link
          key={order.id}
          to="/jobs/$jobId"
          params={{ jobId: order.id }}
          className="surface-panel block p-5 transition-colors hover:border-primary/60"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  #{order.work_order_no}
                </span>
                <Badge variant="outline">{statusLabels[order.status]}</Badge>
              </div>
              <h2 className="mt-2 text-lg font-black">{order.title}</h2>
              <p className="text-sm text-muted-foreground">
                {order.customers?.name} · {formatDate(order.scheduled_at)}
              </p>
              {order.location ? <p className="mt-1 text-sm">{order.location}</p> : null}
            </div>
            <div className="w-full shrink-0 sm:w-64">
              <div className="mb-1 flex justify-between text-sm">
                <span>Genel ilerleme</span>
                <strong>%{order.progress_pct}</strong>
              </div>
              <Progress value={order.progress_pct} className="h-3" />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
