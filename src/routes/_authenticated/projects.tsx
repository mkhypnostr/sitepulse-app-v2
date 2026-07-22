import { useState } from "react";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
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
import {
  formatProjectDate,
  projectProgress,
  projectStatusLabel,
  projectStatusOptions,
  projectTypeLabel,
  projectTypeOptions,
  type ProjectStatus,
  type ProjectType,
} from "@/lib/projects";
import { AccessDenied, EmptyState, LoadingState, PageHeader } from "@/components/page-states";
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
  locationUrl: "",
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [form, setForm] = useState(initialForm);

  const pageQuery = useQuery({
    queryKey: ["projects-page"],
    enabled: role === "admin",
    queryFn: async () => {
      const [projectsResult, customersResult, rolesResult, processesResult, tasksResult] =
        await Promise.all([
          supabase.from("projects").select("*").order("created_at", { ascending: false }),
          supabase.from("customers").select("id, name").order("name"),
          supabase.from("user_roles").select("user_id").eq("role", "admin"),
          supabase.from("project_processes").select("project_id, process_type, position"),
          supabase.from("project_tasks").select("project_id, status"),
        ]);

      if (projectsResult.error) throw projectsResult.error;
      if (customersResult.error) throw customersResult.error;
      if (rolesResult.error) throw rolesResult.error;
      if (processesResult.error) throw processesResult.error;
      if (tasksResult.error) throw tasksResult.error;

      const managerIds = rolesResult.data.map((item) => item.user_id);
      const managersResult = managerIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", managerIds)
            .order("full_name")
        : { data: [], error: null };
      if (managersResult.error) throw managersResult.error;

      return {
        projects: projectsResult.data,
        customers: customersResult.data,
        managers: managersResult.data ?? [],
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
      if (parsedArea !== undefined && (!Number.isFinite(parsedArea) || parsedArea <= 0)) {
        throw new Error("Alan bilgisini sıfırdan büyük bir sayı olarak girin");
      }
      if (form.locationUrl.trim()) {
        try {
          const parsedLocation = new URL(form.locationUrl.trim());
          if (!["http:", "https:"].includes(parsedLocation.protocol)) throw new Error();
        } catch {
          throw new Error("Harita konumunu Google Maps veya başka bir güvenli bağlantı olarak girin");
        }
      }

      const { data, error } = await supabase.rpc("create_project_with_workflow", {
        target_customer_id: form.customerId,
        project_name: form.name.trim(),
        selected_processes: form.processes,
        project_external_reference_no: form.externalReference.trim() || undefined,
        project_location_url: form.locationUrl.trim() || undefined,
        project_province: form.province.trim() || undefined,
        project_district: form.district.trim() || undefined,
        project_neighborhood: form.neighborhood.trim() || undefined,
        project_block_no: form.blockNo.trim() || undefined,
        project_parcel_no: form.parcelNo.trim() || undefined,
        project_area: parsedArea,
        target_manager_id: form.managerId === "none" ? undefined : form.managerId,
        project_start_date: form.startDate || undefined,
        project_target_end_date: form.targetEndDate || undefined,
        project_state: form.status,
        visible_to_customer: form.showToCustomer,
        project_description: form.description.trim() || undefined,
        project_admin_notes: form.adminNotes.trim() || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (projectId) => {
      await queryClient.invalidateQueries({ queryKey: ["projects-page"] });
      setOpen(false);
      setForm(initialForm);
      toast.success("Proje ve görev adımları oluşturuldu");
      navigate({ to: "/projects/$projectId", params: { projectId } });
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

  if (role !== "admin") return <AccessDenied />;
  if (pageQuery.isLoading) return <LoadingState label="Projeler yükleniyor..." />;

  const data = pageQuery.data ?? {
    projects: [],
    customers: [],
    managers: [],
    processes: [],
    tasks: [],
  };
  const customerById = new Map(data.customers.map((item) => [item.id, item.name]));
  const managerById = new Map(data.managers.map((item) => [item.id, item.full_name]));
  const processesByProject = new Map<string, ProjectType[]>();
  data.processes
    .sort((a, b) => a.position - b.position)
    .forEach((item) => {
      const list = processesByProject.get(item.project_id) ?? [];
      list.push(item.process_type);
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
    if (!needle) return data.projects;
    return data.projects.filter((project) =>
      [
        project.project_no,
        project.name,
        customerById.get(project.customer_id),
        project.province,
        project.district,
        project.external_reference_no,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr-TR")
        .includes(needle),
    );
  })();

  const createButton = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-12 font-bold" disabled={data.customers.length === 0}>
          <Plus className="mr-2 h-4 w-4" /> Yeni Proje
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Yeni proje / şantiye oluştur</DialogTitle>
          <DialogDescription>
            Projeye bir veya birden fazla süreç ekleyin. Proje numarası ve görev listeleri
            otomatik hazırlanır.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <section className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Müşteri / Firma <span className="text-destructive">*</span>
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
            <label className="grid gap-1.5 text-sm font-medium">
              Proje Adı <span className="text-destructive">*</span>
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
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
                    className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                      checked ? "border-primary bg-primary/10" : "border-border bg-muted/20"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => toggleProcess(option.value, value === true)}
                      />
                      <div>
                        <p className="text-sm font-bold">{option.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Harita Konum Bağlantısı
              <Input
                value={form.locationUrl}
                onChange={(event) => setForm({ ...form, locationUrl: event.target.value })}
                placeholder="Google Maps konum bağlantısını yapıştırın"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Dış Referans Numarası
              <Input
                value={form.externalReference}
                onChange={(event) => setForm({ ...form, externalReference: event.target.value })}
                placeholder="Varsa kurum / müşteri numarası"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              İl
              <Input
                value={form.province}
                onChange={(event) => setForm({ ...form, province: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              İlçe
              <Input
                value={form.district}
                onChange={(event) => setForm({ ...form, district: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              Mahalle
              <Input
                value={form.neighborhood}
                onChange={(event) => setForm({ ...form, neighborhood: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Ada
              <Input
                value={form.blockNo}
                onChange={(event) => setForm({ ...form, blockNo: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Parsel
              <Input
                value={form.parcelNo}
                onChange={(event) => setForm({ ...form, parcelNo: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Alan (m²)
              <Input
                inputMode="decimal"
                value={form.area}
                onChange={(event) => setForm({ ...form, area: event.target.value })}
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
                onChange={(event) => setForm({ ...form, startDate: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Hedef Bitiş Tarihi
              <Input
                type="date"
                value={form.targetEndDate}
                onChange={(event) => setForm({ ...form, targetEndDate: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Proje Durumu
              <Select
                value={form.status}
                onValueChange={(status: ProjectStatus) => setForm({ ...form, status })}
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
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Projenin kapsamı ve önemli bilgiler"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Yönetici Notu
              <Textarea
                value={form.adminNotes}
                onChange={(event) => setForm({ ...form, adminNotes: event.target.value })}
                placeholder="Yalnızca yöneticilerin göreceği not"
              />
            </label>
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-4">
              <div>
                <p className="text-sm font-bold">Müşteri panelinde göster</p>
                <p className="text-xs text-muted-foreground">
                  Müşteri erişimi sonraki aşamada açılacak; seçim şimdiden kayıt edilir.
                </p>
              </div>
              <Switch
                checked={form.showToCustomer}
                onCheckedChange={(showToCustomer) => setForm({ ...form, showToCustomer })}
              />
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button
            onClick={() => createProject.mutate()}
            disabled={
              !form.customerId ||
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
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <Search className="h-5 w-5 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Proje no, ad, müşteri veya konum ara..."
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>
      ) : null}

      {data.projects.length === 0 ? (
        <EmptyState
          title="Henüz proje oluşturulmadı"
          description="İlk proje kaydını açtığınızda seçtiğiniz süreçlerin bütün görevleri otomatik hazırlanır."
          action={createButton}
        />
      ) : filteredProjects.length === 0 ? (
        <EmptyState title="Aramanızla eşleşen proje bulunamadı" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredProjects.map((project) => {
            const progress = projectProgress(
              (tasksByProject.get(project.id) ?? []).map((task) => task.status),
            );
            const location = [project.province, project.district, project.neighborhood]
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
                    <div className="rounded-xl bg-primary/15 p-2.5 text-primary">
                      <FolderKanban className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black tracking-wider text-primary">
                        {project.project_no}
                      </p>
                      <h2 className="mt-1 truncate text-lg font-black">{project.name}</h2>
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {projectStatusLabel[project.status]}
                  </Badge>
                </div>

                <div className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    <span className="truncate">{customerById.get(project.customer_id) || "Müşteri"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <span>{formatProjectDate(project.target_end_date)} hedef</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span className="truncate">{location || "Konum girilmedi"}</span>
                  </div>
                  <div className="truncate text-xs">
                    Sorumlu: {managerById.get(project.manager_id ?? "") || "Atanmadı"}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {(processesByProject.get(project.id) ?? []).map((process) => (
                    <Badge key={process} variant="secondary">
                      {projectTypeLabel[process]}
                    </Badge>
                  ))}
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-bold">Görev ilerlemesi</span>
                    <span className="text-muted-foreground">
                      {progress.completed}/{progress.total} · %{progress.percentage}
                    </span>
                  </div>
                  <Progress value={progress.percentage} className="h-2" />
                </div>

                <div className="mt-4 flex items-center justify-end gap-1 text-sm font-bold text-primary">
                  Projeyi aç
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {pageQuery.error ? (
        <p className="mt-4 text-sm text-destructive">{errorMessage(pageQuery.error)}</p>
      ) : null}
    </>
  );
}
