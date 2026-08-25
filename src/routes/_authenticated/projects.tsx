import { useState } from "react";
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  FolderKanban,
  MapPin,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { createProjectDriveWorkspace } from "@/lib/google-workspace";
import {
  formatProjectDate,
  projectApprovedProgress,
  projectStatusLabel,
  projectStatusOptions,
  projectTypeLabel,
  projectTypeOptions,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/projects";
import {
  AccessDenied,
  EmptyState,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/projects")({
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const isProjectsIndex = pathname === "/projects" || pathname === "/projects/";

  return isProjectsIndex ? <ProjectsPage /> : <Outlet />;
}

const initialForm = {
  customerId: "",
  name: "",
  processes: [] as ProjectType[],
  externalReference: "",
  referringArchitect: "",
  quotedAmount: "",
  contractAmount: "",
  province: "",
  district: "",
  neighborhood: "",
  blockNo: "",
  parcelNo: "",
  area: "",
  managerId: "none",
  startDate: "",
  targetEndDate: "",
  status: "draft" as ProjectStatus,
  showToCustomer: false,
  description: "",
  adminNotes: "",
};

function ProjectsPage() {
  const { role } = useAuth();
  const canManageProjects = role === "admin" || role === "technical_office";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatus>(
    "all",
  );
  const [form, setForm] = useState(initialForm);

  const pageQuery = useQuery({
    queryKey: ["projects-page"],
    enabled: canManageProjects,
    queryFn: async () => {
      const [
        projectsResult,
        customersResult,
        assigneesResult,
        processesResult,
        tasksResult,
      ] = await Promise.all([
        supabase
          .from("projects")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.rpc("list_project_customers"),
        supabase.rpc("list_project_assignees"),
        supabase
          .from("project_processes")
          .select("id, project_id, process_type, position"),
        supabase
          .from("project_tasks")
          .select("project_id, process_id, status, approved_progress_pct"),
      ]);

      if (projectsResult.error) throw projectsResult.error;
      if (customersResult.error) throw customersResult.error;
      if (assigneesResult.error) throw assigneesResult.error;
      if (processesResult.error) throw processesResult.error;
      if (tasksResult.error) throw tasksResult.error;

      return {
        projects: projectsResult.data,
        customers: customersResult.data ?? [],
        managers: (assigneesResult.data ?? []).filter(
          (item) => item.role === "admin" || item.role === "technical_office",
        ),
        processes: processesResult.data,
        tasks: tasksResult.data,
      };
    },
  });

  const createProject = useMutation({
    mutationFn: async () => {
      const parsedArea = form.area.trim()
        ? Number(form.area.trim().replace(",", "."))
        : undefined;
      if (
        parsedArea !== undefined &&
        (!Number.isFinite(parsedArea) || parsedArea <= 0)
      ) {
        throw new Error("Alan bilgisini sıfırdan büyük bir sayı olarak girin");
      }

      const { data, error } = await supabase.rpc(
        "create_project_with_workflow",
        {
          // target_customer_id has no SQL default (must be sent even when empty);
          // the RPC accepts NULL for a customer-less project.
          target_customer_id: (form.customerId || null) as string,
          project_name: form.name.trim(),
          selected_processes: form.processes,
          project_external_reference_no:
            form.externalReference.trim() || undefined,
          project_location_url: undefined,
          project_province: form.province.trim() || undefined,
          project_district: form.district.trim() || undefined,
          project_neighborhood: form.neighborhood.trim() || undefined,
          project_block_no: form.blockNo.trim() || undefined,
          project_parcel_no: form.parcelNo.trim() || undefined,
          project_area: parsedArea,
          target_manager_id:
            form.managerId === "none" ? undefined : form.managerId,
          project_start_date: form.startDate || undefined,
          project_target_end_date: form.targetEndDate || undefined,
          project_state: form.status,
          visible_to_customer: form.showToCustomer,
          project_description: form.description.trim() || undefined,
          project_admin_notes: form.adminNotes.trim() || undefined,
        },
      );
      if (error) throw error;
      const { error: financeError } = await supabase.from("projects").update({
        referring_architect: form.referringArchitect.trim() || null,
        quoted_amount: form.quotedAmount.trim() ? Number(form.quotedAmount.replace(",", ".")) : null,
        contract_amount: form.contractAmount.trim() ? Number(form.contractAmount.replace(",", ".")) : null,
      }).eq("id", data);
      if (financeError) throw financeError;
      return data;
    },
    onSuccess: async (projectId) => {
      await queryClient.invalidateQueries({ queryKey: ["projects-page"] });
      setOpen(false);
      setForm(initialForm);
      navigate({ to: "/projects/$projectId", params: { projectId } });
      toast.success("Proje oluşturuldu; Drive klasörleri hazırlanıyor");
      try {
        await createProjectDriveWorkspace(projectId);
        toast.success("Proje Drive klasörleri hazır");
      } catch (driveError) {
        toast.warning(
          `Proje oluşturuldu, Drive hazırlanamadı: ${errorMessage(driveError)}`,
        );
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggleProcess = (process: ProjectType, checked: boolean) => {
    setForm((current) => ({
      ...current,
      processes: checked
        ? [...current.processes, process]
        : current.processes.filter((item) => item !== process),
    }));
  };

  if (!canManageProjects) return <AccessDenied />;
  if (pageQuery.isLoading)
    return <LoadingState label="Projeler yükleniyor..." />;

  const data = pageQuery.data ?? {
    projects: [],
    customers: [],
    managers: [],
    processes: [],
    tasks: [],
  };
  const customerById = new Map(
    data.customers.map((item) => [item.id, item.name]),
  );
  const managerById = new Map(
    data.managers.map((item) => [item.id, item.full_name]),
  );
  const processesByProject = new Map<string, typeof data.processes>();
  data.processes
    .sort((a, b) => a.position - b.position)
    .forEach((item) => {
      const list = processesByProject.get(item.project_id) ?? [];
      list.push(item);
      processesByProject.set(item.project_id, list);
    });
  const tasksByProject = new Map<string, typeof data.tasks>();
  data.tasks.forEach((item) => {
    const list = tasksByProject.get(item.project_id) ?? [];
    list.push(item);
    tasksByProject.set(item.project_id, list);
  });

  const filteredProjects = (() => {
    const needle = searchText.trim().toLocaleLowerCase("tr-TR");
    return data.projects.filter((project) => {
      if (statusFilter !== "all" && project.status !== statusFilter)
        return false;
      if (!needle) return true;
      return [
        project.project_no,
        project.name,
        project.customer_id ? customerById.get(project.customer_id) : null,
        project.province,
        project.district,
        project.external_reference_no,
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
          <Plus className="mr-2 h-4 w-4" /> Yeni Proje
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Yeni proje / şantiye oluştur</DialogTitle>
          <DialogDescription>
            Projeye bir veya birden fazla süreç ekleyin. Proje numarası ve görev
            listeleri otomatik hazırlanır.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <section className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Müşteri / Firma
              <Select
                value={form.customerId || "none"}
                onValueChange={(customerId) =>
                  setForm({
                    ...form,
                    customerId: customerId === "none" ? "" : customerId,
                    showToCustomer:
                      customerId === "none" ? false : form.showToCustomer,
                  })
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Müşteri seçin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Müşterisiz proje</SelectItem>
                  {data.customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Proje Adı <span className="text-destructive">*</span>
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder="Örn. Denizli Fabrika Elektrik Projesi"
              />
            </label>
          </section>

          <section>
            <p className="mb-2 text-sm font-bold">
              Proje Süreçleri <span className="text-destructive">*</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {projectTypeOptions.map((option) => {
                const checked = form.processes.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-[14px] border p-3 transition-colors ${
                      checked
                        ? "border-primary bg-primary/10"
                        : "border-border bg-muted/20"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          toggleProcess(option.value, value === true)
                        }
                      />
                      <div>
                        <p className="text-sm font-bold">{option.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {option.description}
                        </p>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Yönlendiren mimar / mimarlık ofisi
              <Input value={form.referringArchitect} onChange={(event) => setForm({ ...form, referringArchitect: event.target.value })} placeholder="Örn. Ayşe Yılmaz · ABC Mimarlık" />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Dış Referans Numarası
              <Input
                value={form.externalReference}
                onChange={(event) =>
                  setForm({ ...form, externalReference: event.target.value })
                }
                placeholder="Varsa kurum / müşteri numarası"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              İl
              <Input
                value={form.province}
                onChange={(event) =>
                  setForm({ ...form, province: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              İlçe
              <Input
                value={form.district}
                onChange={(event) =>
                  setForm({ ...form, district: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Mahalle
              <Input
                value={form.neighborhood}
                onChange={(event) =>
                  setForm({ ...form, neighborhood: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium"><span>Teklif bedeli (KDV hariç)</span><Input inputMode="decimal" value={form.quotedAmount} onChange={(event) => setForm({ ...form, quotedAmount: event.target.value })} placeholder="Örn. 250000" /></label>
            <label className="grid gap-1.5 text-sm font-medium"><span>Sözleşme / onaylanan bedel (KDV hariç)</span><Input inputMode="decimal" value={form.contractAmount} onChange={(event) => setForm({ ...form, contractAmount: event.target.value })} placeholder="Örn. 235000" /></label>
            <label className="grid gap-1.5 text-sm font-medium">
              Ada
              <Input
                value={form.blockNo}
                onChange={(event) =>
                  setForm({ ...form, blockNo: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Parsel
              <Input
                value={form.parcelNo}
                onChange={(event) =>
                  setForm({ ...form, parcelNo: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Alan (m²)
              <Input
                inputMode="decimal"
                value={form.area}
                onChange={(event) =>
                  setForm({ ...form, area: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              NES Proje Sorumlusu
              <Select
                value={form.managerId}
                onValueChange={(managerId) => setForm({ ...form, managerId })}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Henüz atama</SelectItem>
                  {data.managers.map((manager) => (
                    <SelectItem key={manager.id} value={manager.id}>
                      {manager.full_name || "İsimsiz yönetici"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Başlangıç Tarihi
              <Input
                type="date"
                value={form.startDate}
                onChange={(event) =>
                  setForm({ ...form, startDate: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Hedef Bitiş Tarihi
              <Input
                type="date"
                value={form.targetEndDate}
                onChange={(event) =>
                  setForm({ ...form, targetEndDate: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Proje Durumu
              <Select
                value={form.status}
                onValueChange={(status: ProjectStatus) =>
                  setForm({ ...form, status })
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projectStatusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </section>

          <section className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-medium">
              Proje Açıklaması
              <Textarea
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder="Projenin kapsamı ve önemli bilgiler"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Yönetici Notu
              <Textarea
                value={form.adminNotes}
                onChange={(event) =>
                  setForm({ ...form, adminNotes: event.target.value })
                }
                placeholder="Yalnızca yöneticilerin göreceği not"
              />
            </label>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/30 p-4">
              <div>
                <p className="text-sm font-bold">Müşteri panelinde göster</p>
                <p className="text-xs text-muted-foreground">
                  Müşteri erişimi sonraki aşamada açılacak; seçim şimdiden kayıt
                  edilir.
                </p>
              </div>
              <Switch
                checked={form.showToCustomer}
                disabled={!form.customerId}
                onCheckedChange={(showToCustomer) =>
                  setForm({ ...form, showToCustomer })
                }
              />
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button
            onClick={() => createProject.mutate()}
            disabled={
              !form.name.trim() ||
              form.processes.length === 0 ||
              createProject.isPending
            }
          >
            {createProject.isPending ? "Oluşturuluyor..." : "Projeyi Oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        title="Projeler ve Şantiyeler"
        description="Müşteri, kurum onayları ve saha adımlarını tek proje altında takip edin."
        actions={createButton}
      />

      {data.projects.length > 0 ? (
        <section className="surface-panel mb-5 space-y-3 p-4 sm:p-5">
          <div>
            <h2 className="font-black">Proje Portföyü</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Taslak, aktif ve tamamlanan proje/şantiye kayıtlarını filtreleyin.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
            <Search className="h-5 w-5 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Proje no, ad, müşteri veya konum ara..."
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={statusFilter === "all" ? "default" : "outline"}
              onClick={() => setStatusFilter("all")}
            >
              Tümü ({data.projects.length})
            </Button>
            {projectStatusOptions.map((option) => {
              const count = data.projects.filter(
                (project) => project.status === option.value,
              ).length;
              return (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={
                    statusFilter === option.value ? "default" : "outline"
                  }
                  onClick={() => setStatusFilter(option.value)}
                >
                  {option.label} ({count})
                </Button>
              );
            })}
          </div>
        </section>
      ) : null}

      {data.projects.length === 0 ? (
        <EmptyState
          title="Henüz proje oluşturulmadı"
          description="İlk proje kaydını açtığınızda seçtiğiniz süreçlerin bütün görevleri otomatik hazırlanır."
          action={createButton}
        />
      ) : filteredProjects.length === 0 ? (
        <EmptyState title="Seçtiğiniz filtreyle eşleşen proje bulunamadı" />
      ) : (
        <section className="surface-panel p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="font-black">Proje ve Şantiye Kayıtları</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Bir projeyi açarak süreçlerini, görevlerini ve belgelerini
              yönetin.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {filteredProjects.map((project) => {
              const projectProcesses = processesByProject.get(project.id) ?? [];
              const projectTasks = tasksByProject.get(project.id) ?? [];
              const processProgresses = projectProcesses.map((process) => ({
                ...process,
                progress: projectApprovedProgress(
                  projectTasks.filter((task) => task.process_id === process.id),
                ),
              }));
              const location = [
                project.province,
                project.district,
                project.neighborhood,
              ]
                .filter(Boolean)
                .join(" / ");
              return (
                <Link
                  key={project.id}
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  className="surface-panel group block p-5 transition-colors hover:border-primary/60 hover:bg-accent/25"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="rounded-lg bg-primary/15 p-2.5 text-highlight">
                        <FolderKanban className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-black tracking-wider text-highlight">
                          {project.project_no}
                        </p>
                        <h2 className="mt-1 truncate text-lg font-black">
                          {project.name}
                        </h2>
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      {projectStatusLabel[project.status]}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-highlight" />
                      <span className="truncate">
                        {project.customer_id
                          ? customerById.get(project.customer_id) || "Müşteri"
                          : "Müşterisiz proje"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-highlight" />
                      <span>
                        {formatProjectDate(project.target_end_date)} hedef
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-highlight" />
                      <span className="truncate">
                        {location || "Konum girilmedi"}
                      </span>
                    </div>
                    <div className="truncate text-xs">
                      Sorumlu:{" "}
                      {managerById.get(project.manager_id ?? "") || "Atanmadı"}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {projectProcesses.map((process) => (
                      <Badge key={process.id} variant="secondary">
                        {projectTypeLabel[process.process_type]}
                      </Badge>
                    ))}
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {processProgresses.map((process) => (
                      <div
                        key={process.id}
                        className="rounded-lg border border-border/60 bg-background/30 p-3"
                      >
                        <div className="flex items-start justify-between gap-2 text-xs">
                          <span className="font-bold">
                            {projectTypeLabel[process.process_type]}
                          </span>
                          <span className="shrink-0 font-black text-highlight">
                            %{process.progress.percentage}
                          </span>
                        </div>
                        <Progress
                          value={process.progress.percentage}
                          className="mt-2 h-2"
                        />
                        <p className="mt-2 text-xs text-muted-foreground">
                          {process.progress.completed}/{process.progress.total}{" "}
                          görev
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-1 text-sm font-bold text-highlight">
                    Projeyi aç
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {pageQuery.error ? (
        <p className="mt-4 text-sm text-destructive">
          {errorMessage(pageQuery.error)}
        </p>
      ) : null}
    </>
  );
}
