import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, History, Paperclip, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import { useAuth } from "@/lib/auth-context";
import { formatProjectDateTime } from "@/lib/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

type ProjectTask = Database["public"]["Tables"]["project_tasks"]["Row"];
type Submission = Database["public"]["Tables"]["project_task_progress_submissions"]["Row"];

const submissionLabel = {
  pending: "Yönetici onayında",
  approved: "Onaylandı",
  revision_requested: "Revizyon istendi",
} as const;

export function ProjectTaskProgress({
  task,
  canSubmit,
  canReview,
}: {
  task: ProjectTask;
  canSubmit: boolean;
  canReview: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [proposedPct, setProposedPct] = useState(
    String(Math.min(100, Math.max(task.approved_progress_pct + 5, 5))),
  );
  const [note, setNote] = useState("");
  const [actualDate, setActualDate] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    setProposedPct(String(Math.min(100, Math.max(task.approved_progress_pct + 5, 5))));
  }, [task.approved_progress_pct]);

  const submissionsQuery = useQuery({
    queryKey: ["project-task-progress-submissions", task.id],
    queryFn: async () => {
      const submissionsResult = await supabase
        .from("project_task_progress_submissions")
        .select("*")
        .eq("project_task_id", task.id)
        .order("submitted_at", { ascending: false });
      if (submissionsResult.error) throw submissionsResult.error;

      const userIds = [
        ...new Set(
          submissionsResult.data.flatMap(
            (item) => [item.submitted_by, item.reviewed_by].filter(Boolean) as string[],
          ),
        ),
      ];
      const profilesResult = userIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;

      return {
        submissions: submissionsResult.data,
        profileById: new Map((profilesResult.data ?? []).map((item) => [item.id, item.full_name])),
      };
    },
  });

  const evidenceQuery = useQuery({
    queryKey: ["project-task-evidence", task.id],
    enabled: Boolean(task.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_task_evidence")
        .select("*")
        .eq("project_task_id", task.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const pendingSubmission = useMemo(
    () => submissionsQuery.data?.submissions.find((item) => item.status === "pending"),
    [submissionsQuery.data?.submissions],
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-task-progress-submissions", task.id] }),
      queryClient.invalidateQueries({ queryKey: ["project-task-evidence", task.id] }),
      queryClient.invalidateQueries({ queryKey: ["project-detail", task.project_id] }),
      queryClient.invalidateQueries({ queryKey: ["my-project-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["projects-page"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };

  const submitProgress = useMutation({
    mutationFn: async () => {
      const pct = Number(proposedPct);
      if (
        !Number.isInteger(pct) ||
        pct <= task.approved_progress_pct ||
        pct > 100 ||
        pct % 5 !== 0
      ) {
        throw new Error(
          `İlerleme %${task.approved_progress_pct} değerinden yüksek ve 5'in katı olmalıdır.`,
        );
      }
      if (note.trim().length < 10)
        throw new Error("Yapılan iş açıklaması en az 10 karakter olmalıdır.");
      const { error } = await supabase.rpc("submit_project_task_progress", {
        target_task_id: task.id,
        proposed_progress: pct,
        progress_note: note.trim(),
        actual_on: actualDate || undefined,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setNote("");
      setActualDate("");
      await refresh();
      toast.success("İlerleme yönetici onayına gönderildi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const reviewProgress = useMutation({
    mutationFn: async ({ submission, approve }: { submission: Submission; approve: boolean }) => {
      const reviewNote = reviewNotes[submission.id]?.trim() || undefined;
      if (!approve && !reviewNote) throw new Error("Revizyon nedenini yazın.");
      const { error } = await supabase.rpc("review_project_task_progress", {
        target_submission_id: submission.id,
        approve_submission: approve,
        decision_note: reviewNote,
      });
      if (error) throw error;
    },
    onSuccess: async (_data, variables) => {
      await refresh();
      toast.success(variables.approve ? "İlerleme onaylandı" : "Revizyon istendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const submissions = submissionsQuery.data?.submissions ?? [];
  const evidence = evidenceQuery.data ?? [];
  const readyEvidence = evidence.filter(
    (item) => item.submission_id === null && item.uploaded_by === user?.id,
  );
  const evidenceCountBySubmission = new Map<string, number>();
  evidence.forEach((item) => {
    if (!item.submission_id) return;
    evidenceCountBySubmission.set(
      item.submission_id,
      (evidenceCountBySubmission.get(item.submission_id) ?? 0) + 1,
    );
  });
  const profileById = submissionsQuery.data?.profileById ?? new Map<string, string>();
  const submissionFormVisible =
    canSubmit &&
    !pendingSubmission &&
    task.approved_progress_pct < 100 &&
    task.status !== "not_applicable";
  const proposedPctNumber = Number(proposedPct);
  const submissionInputValid =
    Number.isInteger(proposedPctNumber) &&
    proposedPctNumber > task.approved_progress_pct &&
    proposedPctNumber <= 100 &&
    proposedPctNumber % 5 === 0 &&
    note.trim().length >= 10 &&
    readyEvidence.length > 0;

  return (
    <div className="mt-4 rounded-xl border border-border bg-muted/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
            Onaylı Görev İlerlemesi
          </p>
          <p className="mt-1 text-2xl font-black text-highlight">%{task.approved_progress_pct}</p>
        </div>
        {pendingSubmission ? (
          <Badge className="border-destructive/50 bg-destructive/15 text-destructive animate-pulse">
            <Clock3 className="mr-1 h-3.5 w-3.5" /> %{pendingSubmission.proposed_pct} onay bekliyor
          </Badge>
        ) : task.approved_progress_pct === 100 ? (
          <Badge className="border-success/40 bg-success/15 text-success">
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Tamamlandı
          </Badge>
        ) : null}
      </div>
      <Progress value={task.approved_progress_pct} className="mt-3 h-2.5" />

      {pendingSubmission && canReview ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-black">%{pendingSubmission.proposed_pct} ilerleme talebi</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {profileById.get(pendingSubmission.submitted_by) || "Kullanıcı"} ·{" "}
                {formatProjectDateTime(pendingSubmission.submitted_at)}
              </p>
            </div>
            <Badge variant="outline" className="border-destructive/40 text-destructive">
              Onay Bekliyor
            </Badge>
          </div>
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-background/50 p-3 text-sm">
            {pendingSubmission.note}
          </p>
          <Textarea
            value={reviewNotes[pendingSubmission.id] ?? ""}
            onChange={(event) =>
              setReviewNotes((current) => ({
                ...current,
                [pendingSubmission.id]: event.target.value,
              }))
            }
            placeholder="Onay notu (isteğe bağlı) veya revizyon nedeni"
            className="mt-3 min-h-20"
          />
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                reviewProgress.mutate({ submission: pendingSubmission, approve: false })
              }
              disabled={reviewProgress.isPending}
              className="border-warning/40 text-warning"
            >
              <RotateCcw className="mr-2 h-4 w-4" /> Revizyon İste
            </Button>
            <Button
              type="button"
              onClick={() =>
                reviewProgress.mutate({ submission: pendingSubmission, approve: true })
              }
              disabled={reviewProgress.isPending}
              className="bg-success text-success-foreground hover:bg-success/85"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" /> Onayla ve %{pendingSubmission.proposed_pct}{" "}
              Yap
            </Button>
          </div>
        </div>
      ) : null}

      {submissionFormVisible ? (
        <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-4">
          <p className="font-black">İlerlemeyi onaya gönder</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Onay verilene kadar proje yüzdesi değişmez. Fotoğraf veya belge ve en az 10
            karakterlik açıklama zorunludur.
          </p>
          <p
            className={
              readyEvidence.length
                ? "mt-2 flex items-center gap-1.5 text-xs font-semibold text-success"
                : "mt-2 flex items-center gap-1.5 text-xs font-semibold text-destructive"
            }
          >
            <Paperclip className="h-3.5 w-3.5" />
            {readyEvidence.length
              ? `${readyEvidence.length} kanıt dosyası hazır; gönderimde bu kayda bağlanacak.`
              : "Fotoğraf veya belge eklemeden ilerleme gönderilemez."}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-bold">
              Önerilen İlerleme (%)
              <Input
                type="number"
                min={Math.min(100, task.approved_progress_pct + 5)}
                max={100}
                step={5}
                value={proposedPct}
                onChange={(event) => setProposedPct(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs font-bold">
              Gerçekleşen Tarih (isteğe bağlı)
              <Input
                type="date"
                value={actualDate}
                onChange={(event) => setActualDate(event.target.value)}
              />
            </label>
          </div>
          <label className="mt-3 grid gap-1 text-xs font-bold">
            Yapılan İşin Açıklaması
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Ne yapıldı, sahadaki durum nedir, hangi belge eklendi?"
              minLength={10}
              className="min-h-24"
            />
          </label>
          <Button
            type="button"
            className="mt-3 w-full sm:w-auto"
            onClick={() => submitProgress.mutate()}
            disabled={submitProgress.isPending || evidenceQuery.isLoading || !submissionInputValid}
          >
            <Send className="mr-2 h-4 w-4" />
            {submitProgress.isPending ? "Gönderiliyor..." : "Yönetici Onayına Gönder"}
          </Button>
        </div>
      ) : null}

      {submissions.length ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-muted-foreground">
            <History className="h-3.5 w-3.5" /> İşlem Geçmişi
          </p>
          <div className="mt-2 space-y-2">
            {submissions.map((submission) => (
              <div
                key={submission.id}
                className="rounded-lg border border-border bg-background/45 p-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-black">
                    %{submission.proposed_pct} · {submissionLabel[submission.status]}
                  </span>
                  <span className="text-muted-foreground">
                    {formatProjectDateTime(submission.submitted_at)}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  Gönderen: {profileById.get(submission.submitted_by) || "Kullanıcı"}
                </p>
                {(evidenceCountBySubmission.get(submission.id) ?? 0) > 0 ? (
                  <p className="mt-1 flex items-center gap-1 text-highlight">
                    <Paperclip className="h-3.5 w-3.5" /> Kanıt: {evidenceCountBySubmission.get(submission.id)} dosya
                  </p>
                ) : null}
                {submission.reviewed_by ? (
                  <p
                    className={
                      submission.status === "approved"
                        ? "mt-1 text-success"
                        : "mt-1 text-warning"
                    }
                  >
                    {submission.status === "approved" ? "Onaylayan" : "İnceleyen"}:{" "}
                    {profileById.get(submission.reviewed_by) || "Yönetici"} ·{" "}
                    {formatProjectDateTime(submission.reviewed_at)}
                  </p>
                ) : null}
                {submission.review_note ? (
                  <p className="mt-2 whitespace-pre-wrap">{submission.review_note}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
