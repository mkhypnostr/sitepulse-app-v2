import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage, statusLabels } from "@/lib/domain";
import { formatDate, formatTRY, halfHourOptions } from "@/lib/format";
import { AccessDenied, EmptyState, LoadingState, PageHeader } from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/work-orders")({
  component: WorkOrdersPage,
});

function WorkOrdersPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    customerId: "",
    title: "",
    description: "",
    location: "",
    date: new Date().toISOString().slice(0, 10),
    time: "08:00",
    amount: "0",
    contractorId: "none",
    showToCustomer: false,
  });

  const pageQuery = useQuery({
    queryKey: ["admin-work-orders"],
    enabled: role === "admin",
    queryFn: async () => {
      const [ordersResult, customersResult, rolesResult, assignmentsResult] = await Promise.all([
        supabase
          .from("work_orders")
          .select("*, customers(name), work_order_financials(total_amount, approved_progress_pct)")
          .order("created_at", { ascending: false }),
        supabase.from("customers").select("id, name").order("name"),
        supabase.from("user_roles").select("user_id").eq("role", "contractor"),
        supabase.from("work_order_assignments").select("work_order_id, contractor_id"),
      ]);
      if (ordersResult.error) throw ordersResult.error;
      if (customersResult.error) throw customersResult.error;
      if (rolesResult.error) throw rolesResult.error;
      if (assignmentsResult.error) throw assignmentsResult.error;

      const contractorIds = rolesResult.data.map((item) => item.user_id);
      const contractors = contractorIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name, company_name")
            .in("id", contractorIds)
            .order("full_name")
        : { data: [], error: null };
      if (contractors.error) throw contractors.error;
      return {
        orders: ordersResult.data,
        customers: customersResult.data,
        contractors: contractors.data ?? [],
        assignments: assignmentsResult.data,
      };
    },
  });

  const createOrder = useMutation({
    mutationFn: async () => {
      const amount = Number(form.amount.replace(",", "."));
      if (!Number.isFinite(amount) || amount < 0) throw new Error("İş bedelini kontrol edin");
      const scheduledAt = new Date(`${form.date}T${form.time}:00`).toISOString();
      const { error } = await supabase.rpc("create_work_order", {
        target_customer_id: form.customerId,
        order_title: form.title,
        order_description: form.description,
        order_location: form.location,
        order_scheduled_at: scheduledAt,
        order_total_amount: amount,
        visible_to_customer: form.showToCustomer,
        assigned_contractor_id: form.contractorId === "none" ? null : form.contractorId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-work-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
      setForm({
        customerId: "",
        title: "",
        description: "",
        location: "",
        date: new Date().toISOString().slice(0, 10),
        time: "08:00",
        amount: "0",
        contractorId: "none",
        showToCustomer: false,
      });
      toast.success("İş emri oluşturuldu");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const visibilityMutation = useMutation({
    mutationFn: async ({ id, visible }: { id: string; visible: boolean }) => {
      const { error } = await supabase
        .from("work_orders")
        .update({ show_to_customer: visible, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-work-orders"] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (role !== "admin") return <AccessDenied />;
  if (pageQuery.isLoading) return <LoadingState />;

  const data = pageQuery.data ?? { orders: [], customers: [], contractors: [], assignments: [] };
  const contractorById = new Map(data.contractors.map((item) => [item.id, item]));
  const assignmentByOrder = new Map(
    data.assignments.map((item) => [item.work_order_id, item.contractor_id]),
  );
  const createButton = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-12 font-bold" disabled={data.customers.length === 0}>
          <Plus className="mr-2 h-4 w-4" /> Yeni İş Emri
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Yeni iş emri</DialogTitle>
          <DialogDescription>
            Planlama, müşteri ve taşeron atamasını tek kayıtta oluşturun.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Müşteri
            <Select
              value={form.customerId}
              onValueChange={(customerId) => setForm({ ...form, customerId })}
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Müşteri seçin" />
              </SelectTrigger>
              <SelectContent>
                {data.customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            Taşeron
            <Select
              value={form.contractorId}
              onValueChange={(contractorId) => setForm({ ...form, contractorId })}
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Henüz atama</SelectItem>
                {data.contractors.map((contractor) => (
                  <SelectItem key={contractor.id} value={contractor.id}>
                    {contractor.full_name || "İsimsiz taşeron"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            Başlık
            <Input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            Açıklama
            <Textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            Lokasyon / Adres
            <Input
              value={form.location}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Planlanan Tarih
            <Input
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Saat
            <Select value={form.time} onValueChange={(time) => setForm({ ...form, time })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {halfHourOptions().map((time) => (
                  <SelectItem key={time} value={time}>
                    {time}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            Toplam İş Bedeli (₺)
            <Input
              inputMode="decimal"
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            Müşteriye Göster
            <Switch
              checked={form.showToCustomer}
              onCheckedChange={(showToCustomer) => setForm({ ...form, showToCustomer })}
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            onClick={() => createOrder.mutate()}
            disabled={!form.customerId || !form.title.trim() || !form.date || createOrder.isPending}
          >
            {createOrder.isPending ? "Oluşturuluyor..." : "İş Emrini Oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        title="İş Emirleri"
        description="Planlanan, devam eden ve tamamlanan bütün saha işleri."
        actions={createButton}
      />
      {data.customers.length === 0 ? (
        <p className="mb-4 rounded-md border border-primary/40 bg-primary/10 p-4 text-sm">
          İş emri oluşturmak için önce Müşteriler ekranından müşteri ekleyin.
        </p>
      ) : null}
      {data.orders.length === 0 ? (
        <EmptyState
          title="Henüz iş emri yok"
          description="İlk iş emrini oluşturup taşerona atayın."
          action={createButton}
        />
      ) : (
        <div className="grid gap-4">
          {data.orders.map((order) => {
            const contractor = contractorById.get(assignmentByOrder.get(order.id) ?? "");
            return (
              <div key={order.id} className="surface-panel p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{order.work_order_no}
                      </span>
                      <Badge variant="outline">{statusLabels[order.status]}</Badge>
                    </div>
                    <h2 className="mt-2 text-lg font-black">{order.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      {order.customers?.name} · {formatDate(order.scheduled_at)} ·{" "}
                      {order.location || "Lokasyon yok"}
                    </p>
                    <p className="mt-1 text-sm">
                      Taşeron:{" "}
                      <span className="font-semibold">{contractor?.full_name || "Atanmadı"}</span>
                    </p>
                  </div>
                  <div className="w-full lg:w-56">
                    <div className="mb-1 flex justify-between text-xs">
                      <span>İlerleme</span>
                      <strong>%{order.progress_pct}</strong>
                    </div>
                    <Progress value={order.progress_pct} />
                    <p className="mt-2 text-right font-bold">
                      {formatTRY(order.work_order_financials?.total_amount)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border p-3 lg:w-44">
                    <div>
                      <p className="text-xs text-muted-foreground">Müşteri görünümü</p>
                      <p className="text-sm font-semibold">
                        {order.show_to_customer ? "Açık" : "Kapalı"}
                      </p>
                    </div>
                    <Switch
                      checked={order.show_to_customer}
                      onCheckedChange={(visible) =>
                        visibilityMutation.mutate({ id: order.id, visible })
                      }
                    />
                  </div>
                  <Button asChild variant="outline" className="h-12">
                    <Link to="/jobs/$jobId" params={{ jobId: order.id }}>
                      <Eye className="mr-2 h-4 w-4" /> Detay
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
