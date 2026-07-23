import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { AccessDenied, LoadingState, PageHeader } from "@/components/page-states";
import { JobList } from "@/components/job-list";

export const Route = createFileRoute("/_authenticated/my-jobs")({
  component: MyJobsPage,
});

function MyJobsPage() {
  const { role } = useAuth();
  const query = useQuery({
    queryKey: ["my-jobs"],
    enabled: role === "contractor",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*, customers(name), projects(name, project_no)")
        .order("scheduled_at");
      if (error) throw error;
      return data;
    },
  });

  if (role !== "contractor") return <AccessDenied />;
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <p className="text-destructive">{errorMessage(query.error)}</p>;

  return (
    <>
      <PageHeader
        title="Bana Atanan Görevler"
        description="İlerleme, fotoğraf ve kullanılan malzeme girişlerini görev detayı üzerinden yapın."
      />
      <JobList orders={query.data ?? []} emptyLabel="Size atanmış görev bulunmuyor" />
    </>
  );
}
