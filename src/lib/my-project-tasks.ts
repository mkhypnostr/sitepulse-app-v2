import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Taşerona atanmış proje görevlerini okuyan sorgu (sekme sayacı için de). */
export function useMyProjectTasks(
  userId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["my-project-tasks", userId],
    enabled: enabled && Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_tasks")
        .select("*")
        .eq("responsible_id", userId!)
        .order("planned_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
