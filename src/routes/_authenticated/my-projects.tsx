import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { AccessDenied, LoadingState, PageHeader } from "@/components/page-states";
import { JobList } from "@/components/job-list";

export const Route = createFileRoute("/_authenticated/my-projects")({
  component: MyProjectsPage,
});

function MyProjectsPage() {
  const { role } = useAuth();
  const query = useQuery({
    queryKey: ["my-projects"],
    enabled: role === "customer",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*, customers(name)")
        .order("scheduled_at");
      if (error) throw error;
      return data;
    },
  });

  if (role !== "customer") return <AccessDenied />;
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <p className="text-destructive">{errorMessage(query.error)}</p>;

  return (
    <>
      <PageHeader
        title="Projelerim"
        description="Yönetici tarafından paylaşılmış proje ilerlemeleri ve saha fotoğrafları."
      />
      <JobList orders={query.data ?? []} emptyLabel="Size açılmış proje bulunmuyor" />
    </>
  );
}
