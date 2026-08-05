import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, FileText, History, Paperclip, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { formatDate, formatTRY } from "@/lib/format";
import { AccessDenied, EmptyState, LoadingState, PageHeader } from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/approvals")({
  component: ApprovalsPage,
});

const TERMINAL_WORK_ORDER_STATUSES = '("completed","cancelled","not_applicable")';
const TERMINAL_TASK_STATUSES = ["completed", "cancelled", "not_applicable"];

type WorkOrderRef = {
  id: string;
  work_order_no: number | null;
  title: string;
  project_id: string | null;
  customer_id: string | null;
  projects: { name: string; project_no: string } | null;
  customers: { name: string } | null;
};

type PendingCompletion = {
  id: string;
  work_order_id: string;
  note: string;
  submitted_by: string;
  submitted_at: string;
  work_orders: WorkOrderRef | null;
};

type PendingProgress = {
  id: string;
  work_order_id: string;
  pct: number;
  note: string | null;
  contractor_id: string;
  created_at: string;
  evidence_photo_id: string | null;
  work_orders: WorkOrderRef | null;
};

type PendingProjectTaskSubmission = {
  id: string;
  project_task_id: string;
  proposed_pct: number;
  note: string;
  submitted_by: string;
  submitted_at: string;
  project_tasks: {
    id: string;
    task_name: string;
    phase_name: string;
    project_id: string;
    projects: { name: string; project_no: string } | null;
  } | null;
};

type OverdueWorkOrder = WorkOrderRef & {
  scheduled_at: string;
  status: string;
};

type OverdueProjectTask = {
  id: string;
  task_name: string;
  phase_name: string;
  project_id: string;
  status: string;
  planned_date: string | null;
  approved_progress_pct: number;
  responsible_id: string | null;
  projects: { name: string; project_no: string } | null;
};

type OverdueIndependentTask = {
  id: string;
  title: string;
  project_id: string | null;
  customer_id: string | null;
  status: string;
  planned_date: string | null;
  assigned_to: string | null;
  projects: { name: string; project_no: string } | null;
};

type CompletionEvidencePhoto = {
  id: string;
  signedUrl: string | null;
  isDocument: boolean;
  caption: string | null;
};

type ActivityLogRow = {
  id: string;
  entity_type: string;
  action: string;
  actor_id: string | null;
  created_at: string;
  project_id: string | null;
  work_order_id: string | null;
};

function isOverdue(date: string | null | undefined) {
  if (!date) return false;
  return new Date(date).getTime() < Date.now();
}

function isTrackedProjectTask(task: OverdueProjectTask) {
  return (
    Boolean(task.responsible_id) ||
    task.approved_progress_pct > 0 ||
    ["in_progress", "external_approval", "revision_required", "blocked", "completed"].includes(task.status)
  );
}

const actionLabel: Record<string, string> = {
  created: "oluşturdu",
  updated: "güncelledi",
  deleted: "sildi",
};

function ApprovalsPage() {
  const { role, user } = useAuth();
  const queryClient = useQueryClient();
  const canAccess = role === "admin" || role === "technical_office" || role === "contractor";
  const isAdmin = role === "admin";
  const isTechnicalOffice = role === "technical_office";
  const isContractor = role === "contractor";
  // Proje görevi onayını admin ve teknik ofis verebilir (review_project_task_progress
  // can_manage_projects kontrolü yapar); iş bitirme ve saha ilerleme onayı yalnızca
  // yöneticiye özeldir (review_work_completion / review_progress_update admin ister).
  const canManageProjectApprovals = isAdmin || isTechnicalOffice;

  const query = useQuery({
    queryKey: ["approvals", role, user?.id],
    enabled: canAccess && Boolean(user?.id),
    queryFn: async () => {
      const overdueOrdersQuery = supabase
        .from("work_orders")
        .select(
          "id, work_order_no, title, scheduled_at, status, project_id, customer_id, projects(name, project_no), customers(name)",
        )
        .lt("scheduled_at", new Date().toISOString())
        .not("status", "in", TERMINAL_WORK_ORDER_STATUSES)
        .order("scheduled_at", { ascending: true });

      let projectTasksQuery = supabase
        .from("project_tasks")
        .select(
          "id, task_name, phase_name, project_id, status, planned_date, approved_progress_pct, responsible_id, projects(name, project_no)",
        )
        .order("planned_date", { ascending: true, nullsFirst: false });
      if (isContractor && user) projectTasksQuery = projectTasksQuery.eq("responsible_id", user.id);

      let independentTasksQuery = supabase
        .from("operational_tasks")
        .select(
          "id, title, project_id, customer_id, status, planned_date, assigned_to, projects(name, project_no)",
        )
        .order("planned_date", { ascending: true, nullsFirst: false });
      if (isContractor && user) independentTasksQuery = independentTasksQuery.eq("assigned_to", user.id);

      let completionsQuery = supabase
        .from("work_completion_submissions")
        .select(
          "id, work_order_id, note, submitted_by, submitted_at, work_orders(id, work_order_no, title, project_id, customer_id, projects(name, project_no), customers(name))",
        )
        .eq("status", "pending")
        .order("submitted_at", { ascending: false });
      if (isContractor && user) completionsQuery = completionsQuery.eq("submitted_by", user.id);

      let progressQuery = supabase
        .from("progress_updates")
        .select(
          "id, work_order_id, pct, note, contractor_id, created_at, evidence_photo_id, work_orders(id, work_order_no, title, project_id, customer_id, projects(name, project_no), customers(name))",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (isContractor && user) progressQuery = progressQuery.eq("contractor_id", user.id);

      let projectTaskSubmissionsQuery = supabase
        .from("project_task_progress_submissions")
        .select(
          "id, project_task_id, proposed_pct, note, submitted_by, submitted_at, project_tasks(id, task_name, phase_name, project_id, projects(name, project_no))",
        )
        .eq("status", "pending")
        .order("submitted_at", { ascending: false });
      if (isContractor && user) projectTaskSubmissionsQuery = projectTaskSubmissionsQuery.eq("submitted_by", user.id);

      const [
        overdueOrdersResult,
        overdueProjectTasksResult,
        overdueIndependentResult,
        completionsResult,
        progressResult,
        projectTaskSubmissionsResult,
        activityResult,
      ] = await Promise.all([
        overdueOrdersQuery,
        projectTasksQuery,
        independentTasksQuery,
        completionsQuery,
        progressQuery,
        projectTaskSubmissionsQuery,
        isAdmin
          ? supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(30)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (overdueOrdersResult.error) throw overdueOrdersResult.error;
      if (overdueProjectTasksResult.error) throw overdueProjectTasksResult.error;
      if (overdueIndependentResult.error) throw overdueIndependentResult.error;
      if (completionsResult.error) throw completionsResult.error;
      if (progressResult.error) throw progressResult.error;
      if (projectTaskSubmissionsResult.error) throw projectTaskSubmissionsResult.error;
      if (activityResult.error) throw activityResult.error;

      const completions = (completionsResult.data ?? []) as unknown as PendingCompletion[];
      const progressItems = (progressResult.data ?? []) as unknown as PendingProgress[];
      const projectTaskSubmissions =
        (projectTaskSubmissionsResult.data ?? []) as unknown as PendingProjectTaskSubmission[];
      const overdueOrders = (overdueOrdersResult.data ?? []) as unknown as OverdueWorkOrder[];
      const overdueProjectTasksRaw = (overdueProjectTasksResult.data ?? []) as unknown as OverdueProjectTask[];
      const overdueIndependentRaw = (overdueIndependentResult.data ?? []) as unknown as OverdueIndependentTask[];
      const activityLogs = (activityResult.data ?? []) as ActivityLogRow[];

      const overdueProjectTasks = overdueProjectTasksRaw.filter(
        (task) => isTrackedProjectTask(task) && isOverdue(task.planned_date) && !TERMINAL_TASK_STATUSES.includes(task.status),
      );
      const overdueIndependentTasks = overdueIndependentRaw.filter(
        (task) => isOverdue(task.planned_date) && !TERMINAL_TASK_STATUSES.includes(task.status),
      );

      const completionIds = completions.map((item) => item.id);
      const projectSubmissionIds = projectTaskSubmissions.map((item) => item.id);
      const [completionEvidenceResult, projectEvidenceResult] = await Promise.all([
        completionIds.length
          ? supabase
              .from("work_completion_evidence")
              .select("submission_id, photos(id, storage_path, is_document, caption)")
              .in("submission_id", completionIds)
          : Promise.resolve({ data: [], error: null }),
        projectSubmissionIds.length
          ? supabase.from("project_task_evidence").select("submission_id").in("submission_id", projectSubmissionIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (completionEvidenceResult.error) throw completionEvidenceResult.error;
      if (projectEvidenceResult.error) throw projectEvidenceResult.error;

      // İş bitirme kartlarında kanıt önizlemesi (fotoğraf thumbnail / PDF linki)
      // gösterebilmek için sadece sayım değil, imzalı URL ile birlikte fotoğraf
      // kaydını da tutuyoruz.
      const completionEvidenceRows = (completionEvidenceResult.data ?? []) as unknown as Array<{
        submission_id: string;
        photos: { id: string; storage_path: string; is_document: boolean; caption: string | null } | null;
      }>;
      const completionEvidenceBySubmission = new Map<string, CompletionEvidencePhoto[]>();
      await Promise.all(
        completionEvidenceRows.map(async (row) => {
          if (!row.submission_id || !row.photos) return;
          const { data, error } = await supabase.storage
            .from("work-photos")
            .createSignedUrl(row.photos.storage_path, 3600);
          const list = completionEvidenceBySubmission.get(row.submission_id) ?? [];
          list.push({
            id: row.photos.id,
            signedUrl: error ? null : data.signedUrl,
            isDocument: row.photos.is_document,
            caption: row.photos.caption,
          });
          completionEvidenceBySubmission.set(row.submission_id, list);
        }),
      );

      const projectEvidenceCount = new Map<string, number>();
      for (const row of projectEvidenceResult.data ?? []) {
        if (!row.submission_id) continue;
        projectEvidenceCount.set(row.submission_id, (projectEvidenceCount.get(row.submission_id) ?? 0) + 1);
      }

      let financialsByOrderId = new Map<
        string,
        { customer_labor_amount: number; customer_material_amount: number; contractor_labor_amount: number }
      >();
      if (isAdmin) {
        const orderIds = [...new Set(completions.map((item) => item.work_order_id))];
        if (orderIds.length) {
          const { data, error } = await supabase
            .from("work_order_financials")
            .select("work_order_id, customer_labor_amount, customer_material_amount, contractor_labor_amount")
            .in("work_order_id", orderIds);
          if (error) throw error;
          financialsByOrderId = new Map(data.map((row) => [row.work_order_id, row]));
        }
      }

      const userIds = new Set<string>();
      completions.forEach((item) => userIds.add(item.submitted_by));
      progressItems.forEach((item) => userIds.add(item.contractor_id));
      projectTaskSubmissions.forEach((item) => userIds.add(item.submitted_by));
      activityLogs.forEach((item) => item.actor_id && userIds.add(item.actor_id));
      const profilesResult = userIds.size
        ? await supabase.from("profiles").select("id, full_name").in("id", [...userIds])
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;
      const profileNameById = new Map(profilesResult.data.map((item) => [item.id, item.full_name]));

      return {
        completions,
        progressItems,
        projectTaskSubmissions,
        overdueOrders,
        overdueProjectTasks,
        overdueIndependentTasks,
        activityLogs,
        completionEvidenceBySubmission,
        projectEvidenceCount,
        financialsByOrderId,
        profileNameById,
      };
    },
  });

  const invalidateEverything = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["approvals"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["job-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["project-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["unified-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-work-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["projects-page"] }),
      queryClient.invalidateQueries({ queryKey: ["my-jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["my-projects"] }),
      queryClient.invalidateQueries({ queryKey: ["my-project-tasks"] }),
    ]);
  };

  const reviewProgress = useMutation({
    mutationFn: async ({ id, approve, note }: { id: string; approve: boolean; note: string }) => {
      const { error } = await supabase.rpc("review_progress_update", {
        target_progress_update_id: id,
        approve_update: approve,
        manager_review_note: note.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: invalidateEverything,
    onError: (error) => alert(errorMessage(error)),
  });

  const reviewCompletion = useMutation({
    mutationFn: async ({ workOrderId, approve, note }: { workOrderId: string; approve: boolean; note: string }) => {
      const { error } = await supabase.rpc("review_work_completion", {
        target_work_order_id: workOrderId,
        approve_completion: approve,
        manager_review_note: note.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: invalidateEverything,
    onError: (error) => alert(errorMessage(error)),
  });

  const reviewProjectTaskSubmission = useMutation({
    mutationFn: async ({ id, approve, note }: { id: string; approve: boolean; note: string }) => {
      const { error } = await supabase.rpc("review_project_task_progress", {
        target_submission_id: id,
        approve_submission: approve,
        decision_note: note.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: invalidateEverything,
    onError: (error) => alert(errorMessage(error)),
  });

  if (!canAccess) return <AccessDenied />;
  if (query.isLoading) return <LoadingState label="Onay ve uyarı verileri yükleniyor..." />;
  if (query.error) return <p className="surface-panel p-5 text-destructive">{errorMessage(query.error)}</p>;

  const data = query.data ?? {
    completions: [],
    progressItems: [],
    projectTaskSubmissions: [],
    overdueOrders: [],
    overdueProjectTasks: [],
    overdueIndependentTasks: [],
    activityLogs: [],
    completionEvidenceBySubmission: new Map<string, CompletionEvidencePhoto[]>(),
    projectEvidenceCount: new Map<string, number>(),
    financialsByOrderId: new Map<
      string,
      { customer_labor_amount: number; customer_material_amount: number; contractor_labor_amount: number }
    >(),
    profileNameById: new Map<string, string | null>(),
  };

  const pendingCount =
    data.completions.length + data.progressItems.length + data.projectTaskSubmissions.length;
  const overdueCount =
    data.overdueOrders.length + data.overdueProjectTasks.length + data.overdueIndependentTasks.length;

  return (
    <>
      <PageHeader
        title="Onay ve Uyarı Merkezi"
        description="Onay bekleyen kayıtlar ve süresi geçen görevler tek ekranda. Her karta tıklayarak ilgili kayda doğrudan gidin."
      />

      <section className="surface-panel mt-6 p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-highlight" />
          <div>
            <h2 className="text-lg font-black">Onay Bekleyenler</h2>
            <p className="text-sm text-muted-foreground">
              {canManageProjectApprovals
                ? "Karar sizi bekliyor. Onaylayın veya açıklama yazarak revizyona gönderin."
                : "Gönderdiğiniz kayıtların onay durumu."}{" "}
              · {pendingCount} kayıt
            </p>
          </div>
        </div>
        {pendingCount === 0 ? (
          <EmptyState title="Onay bekleyen kayıt yok" description="Yeni bir gönderim yapıldığında burada görünecek." />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {data.completions.map((item) => {
              const order = item.work_orders;
              return (
                <PendingCard
                  key={`completion-${item.id}`}
                  category="İş Bitirme Onayı"
                  title={order ? `#${order.work_order_no ?? "—"} · ${order.title}` : "Saha görevi"}
                  relation={
                    order?.project_id
                      ? `Proje: ${order.projects?.name ?? "Proje"}`
                      : order?.customer_id
                        ? `Müşteri: ${order.customers?.name ?? "Müşteri"}`
                        : "Bağımsız saha görevi"
                  }
                  note={item.note}
                  submittedBy={data.profileNameById.get(item.submitted_by) ?? "Kullanıcı"}
                  submittedAt={item.submitted_at}
                  evidence={data.completionEvidenceBySubmission.get(item.id) ?? []}
                  href={order ? `/jobs/${order.id}#completion-approval` : undefined}
                  extra={
                    isAdmin && data.financialsByOrderId.has(item.work_order_id) ? (
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="secondary">
                          Satış İşçilik: {formatTRY(data.financialsByOrderId.get(item.work_order_id)?.customer_labor_amount)}
                        </Badge>
                        <Badge variant="secondary">
                          Satış Malzeme: {formatTRY(data.financialsByOrderId.get(item.work_order_id)?.customer_material_amount)}
                        </Badge>
                        <Badge variant="outline">
                          Taşeron İşçilik: {formatTRY(data.financialsByOrderId.get(item.work_order_id)?.contractor_labor_amount)}
                        </Badge>
                      </div>
                    ) : null
                  }
                  actions={
                    isAdmin ? (
                      <ReviewActions
                        pending={reviewCompletion.isPending}
                        onApprove={() =>
                          reviewCompletion.mutate({ workOrderId: item.work_order_id, approve: true, note: "" })
                        }
                        onReject={(note) =>
                          reviewCompletion.mutate({ workOrderId: item.work_order_id, approve: false, note })
                        }
                      />
                    ) : null
                  }
                />
              );
            })}
            {data.progressItems.map((item) => {
              const order = item.work_orders;
              return (
                <PendingCard
                  key={`progress-${item.id}`}
                  category="Saha İlerleme Onayı"
                  title={order ? `#${order.work_order_no ?? "—"} · ${order.title}` : "Saha görevi"}
                  relation={
                    order?.project_id
                      ? `Proje: ${order.projects?.name ?? "Proje"} · %${item.pct} ilerleme onayı`
                      : `%${item.pct} ilerleme onayı`
                  }
                  note={item.note}
                  submittedBy={data.profileNameById.get(item.contractor_id) ?? "Kullanıcı"}
                  submittedAt={item.created_at}
                  evidenceCount={item.evidence_photo_id ? 1 : 0}
                  href={order ? `/jobs/${order.id}#progress-approval` : undefined}
                  actions={
                    isAdmin ? (
                      <ReviewActions
                        pending={reviewProgress.isPending}
                        onApprove={() => reviewProgress.mutate({ id: item.id, approve: true, note: "" })}
                        onReject={(note) => reviewProgress.mutate({ id: item.id, approve: false, note })}
                      />
                    ) : null
                  }
                />
              );
            })}
            {data.projectTaskSubmissions.map((item) => {
              const task = item.project_tasks;
              return (
                <PendingCard
                  key={`project-task-${item.id}`}
                  category="Proje Görevi Onayı"
                  title={task?.task_name ?? "Proje görevi"}
                  relation={`${task?.projects?.name ?? "Proje"} · ${task?.phase_name ?? ""} · %${item.proposed_pct} onay bekliyor`}
                  note={item.note}
                  submittedBy={data.profileNameById.get(item.submitted_by) ?? "Kullanıcı"}
                  submittedAt={item.submitted_at}
                  evidenceCount={data.projectEvidenceCount.get(item.id) ?? 0}
                  href={task ? `/projects/${task.project_id}#task-${task.id}` : undefined}
                  actions={
                    canManageProjectApprovals ? (
                      <ReviewActions
                        pending={reviewProjectTaskSubmission.isPending}
                        onApprove={() =>
                          reviewProjectTaskSubmission.mutate({ id: item.id, approve: true, note: "" })
                        }
                        onReject={(note) =>
                          reviewProjectTaskSubmission.mutate({ id: item.id, approve: false, note })
                        }
                      />
                    ) : null
                  }
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="surface-panel mt-6 p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <div>
            <h2 className="text-lg font-black">Geciken Kayıtlar</h2>
            <p className="text-sm text-muted-foreground">
              Planlanan tarihi geçmiş, henüz kapanmamış kayıtlar · {overdueCount} kayıt
            </p>
          </div>
        </div>
        {overdueCount === 0 ? (
          <EmptyState title="Geciken kayıt yok" description="Planlanan tarihi geçen açık kayıt bulunmuyor." />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {data.overdueOrders.map((order) => (
              <OverdueCard
                key={`order-${order.id}`}
                category="Saha Görevi"
                title={`#${order.work_order_no ?? "—"} · ${order.title}`}
                relation={
                  order.project_id
                    ? `Proje: ${order.projects?.name ?? "Proje"}`
                    : order.customer_id
                      ? `Müşteri: ${order.customers?.name ?? "Müşteri"}`
                      : "Bağımsız saha görevi"
                }
                plannedDate={order.scheduled_at}
                href={`/jobs/${order.id}`}
              />
            ))}
            {data.overdueProjectTasks.map((task) => (
              <OverdueCard
                key={`project-task-${task.id}`}
                category="Proje Görevi"
                title={task.task_name}
                relation={`${task.projects?.name ?? "Proje"} · ${task.phase_name}`}
                plannedDate={task.planned_date}
                href={`/projects/${task.project_id}#task-${task.id}`}
              />
            ))}
            {data.overdueIndependentTasks.map((task) => (
              <OverdueCard
                key={`independent-${task.id}`}
                category="Bağımsız Görev"
                title={task.title}
                relation={task.project_id ? `Proje: ${task.projects?.name ?? "Proje"}` : "Bağımsız operasyon görevi"}
                plannedDate={task.planned_date}
                href={`/tasks#operational-${task.id}`}
              />
            ))}
          </div>
        )}
      </section>

      {isAdmin ? (
        <section className="surface-panel mt-6 p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <History className="h-5 w-5 text-highlight" />
            <div>
              <h2 className="text-lg font-black">Aktivite Geçmişi</h2>
              <p className="text-sm text-muted-foreground">Sistemdeki son 30 değişiklik kaydı.</p>
            </div>
          </div>
          {data.activityLogs.length === 0 ? (
            <EmptyState title="Aktivite kaydı yok" description="Henüz bir değişiklik kaydedilmedi." />
          ) : (
            <div className="grid gap-2">
              {data.activityLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/20 px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-bold">{data.profileNameById.get(log.actor_id ?? "") ?? "Sistem"}</span>{" "}
                    {log.entity_type} kaydını {actionLabel[log.action] ?? log.action}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDate(log.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}

function ReviewActions({
  pending,
  onApprove,
  onReject,
}: {
  pending: boolean;
  onApprove: () => void;
  onReject: (note: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  if (rejecting) {
    return (
      <div className="mt-3 grid gap-2">
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Revizyon gerekçesini yazın (zorunlu)"
          className="min-h-16 text-sm"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(false)}>
            Vazgeç
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending || note.trim().length === 0}
            onClick={() => onReject(note)}
          >
            <XCircle className="mr-1.5 h-3.5 w-3.5" /> Revizyona Gönder
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex justify-end gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(true)}>
        Revize İste
      </Button>
      <Button type="button" size="sm" disabled={pending} onClick={onApprove}>
        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Onayla
      </Button>
    </div>
  );
}

function PendingCard({
  category,
  title,
  relation,
  note,
  submittedBy,
  submittedAt,
  evidenceCount,
  evidence,
  href,
  extra,
  actions,
}: {
  category: string;
  title: string;
  relation: string;
  note: string | null;
  submittedBy: string;
  submittedAt: string;
  evidenceCount?: number;
  evidence?: CompletionEvidencePhoto[];
  href?: string;
  extra?: ReactNode;
  actions?: ReactNode;
}) {
  const resolvedEvidenceCount = evidence ? evidence.length : (evidenceCount ?? 0);
  return (
    <div className="surface-panel border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wide text-destructive">{category}</p>
          {href ? (
            <a href={href} className="mt-1 block font-black hover:text-highlight">
              {title}
            </a>
          ) : (
            <p className="mt-1 font-black">{title}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{relation}</p>
        </div>
        <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
      </div>
      {note ? <p className="mt-2 rounded-lg bg-background/40 p-2 text-xs text-muted-foreground">{note}</p> : null}
      {evidence && evidence.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {evidence.map((item) =>
            item.isDocument ? (
              <a
                key={item.id}
                href={item.signedUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/40 px-2 py-1.5 text-xs font-bold text-highlight hover:bg-background/60"
              >
                <FileText className="h-3.5 w-3.5" /> Belgeyi Aç
              </a>
            ) : (
              <a
                key={item.id}
                href={item.signedUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="block h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border/70 bg-background/40"
              >
                {item.signedUrl ? (
                  <img
                    src={item.signedUrl}
                    alt={item.caption || "Kanıt fotoğrafı"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                    —
                  </span>
                )}
              </a>
            ),
          )}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {submittedBy} · {formatDate(submittedAt)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          <span className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/40 px-2 py-1 font-bold text-foreground">
            <Paperclip className="h-3.5 w-3.5 text-highlight" /> {resolvedEvidenceCount} kanıt
          </span>
        </div>
      </div>
      {href ? (
        <a href={href} className="mt-2 block text-xs font-bold text-highlight">
          Kaydı aç →
        </a>
      ) : null}
      {actions}
    </div>
  );
}

function OverdueCard({
  category,
  title,
  relation,
  plannedDate,
  href,
}: {
  category: string;
  title: string;
  relation: string;
  plannedDate: string | null;
  href: string;
}) {
  return (
    <a
      href={href}
      className="surface-panel block border-warning/40 bg-warning/5 p-4 transition-colors hover:bg-warning/10"
    >
      <p className="text-xs font-black uppercase tracking-wide text-warning">
        {category} GECİKTİ
      </p>
      <p className="mt-1 font-black">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{relation}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Planlanan tarih: {plannedDate ? formatDate(plannedDate) : "—"}
      </p>
    </a>
  );
}
