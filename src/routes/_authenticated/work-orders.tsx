import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, Search, SlidersHorizontal, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage, roleLabels, statusLabels } from "@/lib/domain";
import { canSeeFinancials, isOperationalManager } from "@/lib/permissions";
import { formatDate, formatTRY, halfHourOptions } from "@/lib/format";
import { safeHttpsMapUrl } from "@/lib/map-location";
import { MapPreview } from "@/components/map-preview";
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
  validateSearch: (search: Record<string, unknown>) => ({
    create: search.create === true || search.create === "true",
    projectId: typeof search.projectId === "string" ? search.projectId : undefined,
  }),
  component: WorkOrdersPage,
});

function WorkOrdersPage() {
  const { role } = useAuth();
  const canManage = isOperationalManager(role);
  const canSeeAmounts = canSeeFinancials(role);
  const { create, projectId } = Route.useSearch();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; no: number | null } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState({
    projectId: "",
    customerId: "",
    title: "",
    description: "",
    locationUrl: "",
    date: new Date().toISOString().slice(0, 10),
    time: "08:00",
    customerLaborAmount: "0",
    customerMaterialAmount: "0",
    contractorLaborAmount: "0",
    estimatedMaterialCost: "0",
    workScopeType: "labor_only",
    materialSource: "none",
    assigneeId: "none",
    showToCustomer: false,
  });

  const pageQuery = useQuery({
    queryKey: ["admin-work-orders"],
    enabled: canManage,
    queryFn: async () => {
      const [ordersResult, customersResult, projectsResult, assigneesResult, assignmentsResult] =
        await Promise.all([
          supabase
            .from("work_orders")
            .select(
              // work_order_financials RLS yalnızca admin'e açık; teknik ofis
              // için bu embed otomatik olarak null döner (bkz. canSeeAmounts).
              "*, customers(name), projects(name, project_no), work_order_financials(customer_amount, customer_labor_amount, customer_material_amount, contractor_labor_amount, estimated_material_cost, approved_progress_pct)",
            )
            .order("created_at", { ascending: false }),
          supabase.from("customers").select("id, name").order("name"),
          supabase
            .from("projects")
            .select("id, name, project_no, customer_id, location_url, show_to_customer, status")
            .not("status", "in", '("completed","cancelled")')
            .order("name"),
          supabase.rpc("list_task_assignees"),
          supabase.from("work_order_assignments").select("work_order_id, contractor_id"),
        ]);
      if (ordersResult.error) throw ordersResult.error;
      if (customersResult.error) throw customersResult.error;
      if (projectsResult.error) throw projectsResult.error;
      if (assigneesResult.error) throw assigneesResult.error;
      if (assignmentsResult.error) throw assignmentsResult.error;

      return {
        orders: ordersResult.data,
        customers: customersResult.data,
        projects: projectsResult.data,
        assignees: assigneesResult.data ?? [],
        assignments: assignmentsResult.data,
      };
    },
  });

  const deleteOrder = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error("Silinecek görev bulunamadı.");
      const { error } = await supabase.rpc("delete_work_order_permanently" as never, {
        target_work_order_id: deleteTarget.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-work-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["unified-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["projects-page"] }),
      ]);
      setDeleteTarget(null);
      toast.success("Saha görevi kalıcı olarak silindi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  useEffect(() => {
    if (create) setOpen(true);
  }, [create]);

  useEffect(() => {
    if (!projectId || !pageQuery.data) return;
    const selectedProject = pageQuery.data.projects.find((project) => project.id === projectId);
    if (!selectedProject) return;
    setForm((current) => ({
      ...current,
      projectId: selectedProject.id,
      customerId: selectedProject.customer_id ?? "",
      locationUrl: selectedProject.location_url ?? "",
      showToCustomer: selectedProject.show_to_customer,
    }));
  }, [pageQuery.data, projectId]);

  const createOrder = useMutation({
    mutationFn: async () => {
      const locationUrl = safeHttpsMapUrl(form.locationUrl);
      if (!locationUrl) throw new Error("Google Maps'ten geçerli bir konum bağlantısı girin");
      const scheduledAt = new Date(`${form.date}T${form.time}:00`).toISOString();
      const workScopeType = form.workScopeType;
      const materialSource = form.workScopeType === "labor_only" ? "none" : form.materialSource;

      if (canSeeAmounts) {
        const customerLaborAmount = Number(form.customerLaborAmount.replace(",", "."));
        const customerMaterialAmount = Number(form.customerMaterialAmount.replace(",", "."));
        const contractorLaborAmount = Number(form.contractorLaborAmount.replace(",", "."));
        const estimatedMaterialCost = Number(form.estimatedMaterialCost.replace(",", "."));
        if (
          ![customerLaborAmount, customerMaterialAmount, contractorLaborAmount, estimatedMaterialCost].every(
            (value) => Number.isFinite(value) && value >= 0,
          )
        ) {
          throw new Error("Ticari tutarları kontrol edin");
        }
        const { error } = await supabase.rpc("create_work_order", {
          // target_customer_id has no SQL default (must be sent even when empty);
          // the RPC accepts NULL for a customer-less work order.
          target_customer_id: (form.customerId || null) as string,
          order_title: form.title,
          order_description: form.description,
          order_location: "",
          order_location_url: locationUrl,
          order_scheduled_at: scheduledAt,
          order_customer_labor_amount: customerLaborAmount,
          order_customer_material_amount: customerMaterialAmount,
          order_contractor_labor_amount: contractorLaborAmount,
          order_estimated_material_cost: estimatedMaterialCost,
          order_work_scope_type: workScopeType,
          order_default_material_source: materialSource,
          visible_to_customer: form.showToCustomer,
          assigned_contractor_id: form.assigneeId === "none" ? undefined : form.assigneeId,
          target_project_id: form.projectId || undefined,
        });
        if (error) throw error;
        return;
      }

      // Teknik ofis ticari tutar giremez; saha görevi finans kaydı 0 ile
      // oluşturulur, tutarları yalnızca admin sonradan girer.
      const { error } = await supabase.rpc("create_work_order_technical", {
        target_customer_id: (form.customerId || null) as string,
        order_title: form.title,
        order_description: form.description,
        order_location: "",
        order_location_url: locationUrl,
        order_scheduled_at: scheduledAt,
        order_work_scope_type: workScopeType,
        order_default_material_source: materialSource,
        visible_to_customer: form.showToCustomer,
        assigned_contractor_id: form.assigneeId === "none" ? undefined : form.assigneeId,
        target_project_id: form.projectId || undefined,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-work-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
      setForm({
        projectId: "",
        customerId: "",
        title: "",
        description: "",
        locationUrl: "",
        date: new Date().toISOString().slice(0, 10),
        time: "08:00",
        customerLaborAmount: "0",
        customerMaterialAmount: "0",
        contractorLaborAmount: "0",
        estimatedMaterialCost: "0",
        workScopeType: "labor_only",
        materialSource: "none",
        assigneeId: "none",
        showToCustomer: false,
      });
      toast.success("Görev oluşturuldu");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const visibilityMutation = useMutation({
    mutationFn: async ({ id, visible }: { id: string; visible: boolean }) => {
      const { error } = await supabase.rpc("set_work_order_customer_visibility", {
        target_work_order_id: id,
        visible,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-work-orders"] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canManage) return <AccessDenied />;
  if (pageQuery.isLoading) return <LoadingState />;

  const data = pageQuery.data ?? {
    orders: [],
    customers: [],
    projects: [],
    assignees: [],
    assignments: [],
  };
  const selectedProject = data.projects.find((project) => project.id === form.projectId);
  const assigneeById = new Map(data.assignees.map((item) => [item.id, item]));
  const assignmentByOrder = new Map(
    data.assignments.map((item) => [item.work_order_id, item.contractor_id]),
  );
  const filteredOrders = (() => {
    const needle = searchText.trim().toLocaleLowerCase("tr-TR");
    return data.orders.filter((order) => {
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      if (!needle) return true;
      const assignee = assigneeById.get(assignmentByOrder.get(order.id) ?? "");
      return [
        order.work_order_no,
        order.title,
        order.customers?.name,
        order.projects?.name,
        order.location,
        order.location_url,
        assignee?.full_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr-TR")
        .includes(needle);
    });
  })();
  const createButton = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-12 font-bold">
          <Plus className="mr-2 h-4 w-4" /> Yeni Görev
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Yeni görev</DialogTitle>
          <DialogDescription>
            Bağımsız bir görev oluşturun veya görevi mevcut bir projeye bağlayın.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm sm:col-span-2">
            Bağlı Proje / Şantiye
            <Select
              value={form.projectId || "independent"}
              onValueChange={(value) => {
                if (value === "independent") {
                  setForm({
                    ...form,
                    projectId: "",
                    customerId: "",
                    locationUrl: "",
                    showToCustomer: false,
                  });
                  return;
                }
                const project = data.projects.find((item) => item.id === value);
                if (!project) return;
                setForm({
                  ...form,
                  projectId: project.id,
                  customerId: project.customer_id ?? "",
                  locationUrl: project.location_url ?? "",
                  showToCustomer: project.show_to_customer,
                });
              }}
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="independent">Bağımsız görev</SelectItem>
                {data.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.project_no} · {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              Proje seçildiğinde müşteri ve konum otomatik alınır.
            </span>
          </label>
          <label className="grid gap-1 text-sm">
            Müşteri
            <Select
              value={form.customerId || "none"}
              disabled={Boolean(selectedProject)}
              onValueChange={(customerId) =>
                setForm({
                  ...form,
                  customerId: customerId === "none" ? "" : customerId,
                  showToCustomer: customerId === "none" ? false : form.showToCustomer,
                })
              }
            >
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Müşteri seçin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Müşteri yok (bağımsız görev)</SelectItem>
                {data.customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            Sorumlu Kişi
            <Select
              value={form.assigneeId}
              onValueChange={(assigneeId) => setForm({ ...form, assigneeId })}
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Henüz atama</SelectItem>
                {data.assignees.map((assignee) => (
                  <SelectItem key={assignee.id} value={assignee.id}>
                    {assignee.full_name || "İsimsiz kullanıcı"} · {roleLabels[assignee.role]}
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
            Google Maps Konumu <span className="text-destructive">*</span>
            <Input
              value={form.locationUrl}
              disabled={Boolean(selectedProject)}
              onChange={(event) => setForm({ ...form, locationUrl: event.target.value })}
              placeholder="Google Maps > Paylaş > Bağlantıyı kopyala"
            />
            <span className="text-xs text-muted-foreground">
              Düz adres yerine haritadaki yerin paylaşım bağlantısını yapıştırın.
            </span>
          </label>
          {safeHttpsMapUrl(form.locationUrl) ? (
            <MapPreview mapUrl={form.locationUrl} compact className="sm:col-span-2" />
          ) : null}
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
            İş Kapsamı
            <Select
              value={form.workScopeType}
              onValueChange={(workScopeType) =>
                setForm({
                  ...form,
                  workScopeType,
                  materialSource:
                    workScopeType === "labor_only"
                      ? "none"
                      : form.materialSource === "none"
                        ? "nes_stock"
                        : form.materialSource,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="labor_only">Yalnızca işçilik</SelectItem>
                <SelectItem value="labor_and_material">İşçilik + malzeme</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            Malzeme Kaynağı
            <Select
              value={form.materialSource}
              disabled={form.workScopeType === "labor_only"}
              onValueChange={(materialSource) => setForm({ ...form, materialSource })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Malzeme kullanılmayacak</SelectItem>
                <SelectItem value="nes_stock">NES deposu</SelectItem>
                <SelectItem value="contractor">Taşeron malzemesi</SelectItem>
                <SelectItem value="customer_site">Müşteri / şantiye malzemesi</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {canSeeAmounts ? (
            <>
              <label className="grid gap-1 text-sm">
                Müşteriye İşçilik Satış Bedeli (₺)
                <Input
                  inputMode="decimal"
                  value={form.customerLaborAmount}
                  onChange={(event) => setForm({ ...form, customerLaborAmount: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Müşteriye Malzeme Satış Bedeli (₺)
                <Input
                  inputMode="decimal"
                  value={form.customerMaterialAmount}
                  onChange={(event) => setForm({ ...form, customerMaterialAmount: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Taşeron İşçilik Bedeli (₺)
                <Input
                  inputMode="decimal"
                  value={form.contractorLaborAmount}
                  onChange={(event) => setForm({ ...form, contractorLaborAmount: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Tahmini Malzeme / Diğer Maliyet (₺)
                <Input
                  inputMode="decimal"
                  value={form.estimatedMaterialCost}
                  onChange={(event) => setForm({ ...form, estimatedMaterialCost: event.target.value })}
                />
              </label>
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="text-xs text-muted-foreground">Tahmini Brüt Fark</p>
                <p className="mt-1 text-lg font-black text-highlight">
                  {formatTRY(
                    (Number(form.customerLaborAmount.replace(",", ".")) || 0) +
                      (Number(form.customerMaterialAmount.replace(",", ".")) || 0) -
                      (Number(form.contractorLaborAmount.replace(",", ".")) || 0) -
                      (Number(form.estimatedMaterialCost.replace(",", ".")) || 0),
                  )}
                </p>
              </div>
            </>
          ) : (
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground sm:col-span-2">
              Ticari tutarlar bu görevde görünmez; satış ve işçilik bedelleri yönetici tarafından
              girilir.
            </p>
          )}
          <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
            Müşteriye Göster
            <Switch
              checked={form.showToCustomer}
              disabled={!form.customerId}
              onCheckedChange={(showToCustomer) => setForm({ ...form, showToCustomer })}
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            onClick={() => createOrder.mutate()}
            disabled={
              !form.title.trim() ||
              !safeHttpsMapUrl(form.locationUrl) ||
              !form.date ||
              (form.workScopeType === "labor_and_material" && form.materialSource === "none") ||
              createOrder.isPending
            }
          >
            {createOrder.isPending ? "Oluşturuluyor..." : "Görevi Oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        title="Görevler"
        description="Bağımsız veya projeye bağlı bütün saha görevleri."
        actions={createButton}
      />
      {data.orders.length > 0 ? (
        <div className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-[1fr_220px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Görev no, proje, müşteri, konum veya sorumlu ara"
              className="h-11 pl-10"
            />
          </label>
          <div className="relative">
            <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-11 pl-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Bütün durumlar</SelectItem>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {filteredOrders.length} görev gösteriliyor.
          </p>
        </div>
      ) : null}
      {data.orders.length === 0 ? (
        <EmptyState
          title="Henüz görev yok"
          description="İlk bağımsız veya projeye bağlı görevi oluşturun."
          action={createButton}
        />
      ) : (
        <div className="grid gap-4">
          {filteredOrders.map((order) => {
            const assignee = assigneeById.get(assignmentByOrder.get(order.id) ?? "");
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
                    {order.projects ? (
                      <p className="mt-1 text-sm font-semibold text-highlight">
                        {order.projects.project_no} · {order.projects.name}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">
                        Bağımsız görev
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {order.customers?.name || "Müşteri yok"} · {formatDate(order.scheduled_at)} ·{" "}
                      {order.location ||
                        (order.location_url ? "Harita konumu eklendi" : "Konum yok")}
                    </p>
                    <p className="mt-1 text-sm">
                      Sorumlu:{" "}
                      <span className="font-semibold">
                        {assignee?.full_name || "Atanmadı"}
                        {assignee ? ` · ${roleLabels[assignee.role]}` : ""}
                      </span>
                    </p>
                  </div>
                  <div className="w-full lg:w-56">
                    <div className="mb-1 flex justify-between text-xs">
                      <span>İlerleme</span>
                      <strong>%{order.progress_pct}</strong>
                    </div>
                    <Progress value={order.progress_pct} />
                    {canSeeAmounts ? (
                      <div className="mt-2 space-y-1 text-right text-xs">
                        <p>
                          Müşteri:{" "}
                          <strong>{formatTRY(order.work_order_financials?.customer_amount)}</strong>
                        </p>
                        <p>
                          Taşeron:{" "}
                          <strong>
                            {formatTRY(order.work_order_financials?.contractor_labor_amount)}
                          </strong>
                        </p>
                        <p className="text-highlight">
                          Brüt fark:{" "}
                          <strong>
                            {formatTRY(
                              (order.work_order_financials?.customer_amount ?? 0) -
                                (order.work_order_financials?.contractor_labor_amount ?? 0) -
                                (order.work_order_financials?.estimated_material_cost ?? 0),
                            )}
                          </strong>
                        </p>
                      </div>
                    ) : null}
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
                      disabled={!order.customer_id}
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
                  {role === "admin" ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 border-destructive/50 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget({ id: order.id, title: order.title, no: order.work_order_no })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Sil
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {filteredOrders.length === 0 ? (
            <div className="surface-panel p-8 text-center text-sm text-muted-foreground">
              Aramanıza veya seçtiğiniz duruma uygun görev bulunamadı.
            </div>
          ) : null}
        </div>
      )}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(nextOpen) => !nextOpen && !deleteOrder.isPending && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/15 text-destructive"><AlertTriangle className="h-6 w-6" /></div>
            <DialogTitle>Saha görevi kalıcı olarak silinsin mi?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `#${deleteTarget.no ?? "—"} · ${deleteTarget.title}` : "Bu görev"} ve bağlı atama, ilerleme, kanıt ve finans kayıtları silinir. Bu işlem geri alınamaz.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteOrder.isPending}>Vazgeç</Button>
            <Button variant="destructive" onClick={() => deleteOrder.mutate()} disabled={deleteOrder.isPending}>{deleteOrder.isPending ? "Siliniyor..." : "Görevi Kalıcı Sil"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
