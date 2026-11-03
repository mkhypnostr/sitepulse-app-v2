import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

// Taşeron iş tarifi: yalnız NES (yönetici, teknik ofis) ve işe atanan taşeron
// görür. Kayıt ayrı tabloda durur; müşteri RLS gereği hiç okuyamaz.

export function WorkOrderInstructionsCard({
  workOrderId,
  canEdit,
}: {
  workOrderId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const query = useQuery({
    queryKey: ["work-order-instructions", workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_instructions")
        .select("body, updated_at")
        .eq("work_order_id", workOrderId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const body = query.data?.body?.trim() ?? "";

  useEffect(() => {
    if (!editing) setDraft(body);
  }, [body, editing]);

  const save = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("work_order_instructions").upsert({
        work_order_id: workOrderId,
        body: draft.trim(),
        updated_by: auth.user?.id ?? null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["work-order-instructions", workOrderId],
      });
      setEditing(false);
      toast.success("Taşeron iş tarifi kaydedildi");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (query.isLoading || query.isError) return null;
  if (!body && !canEdit) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" /> Taşeron iş tarifi
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Müşteri görmez; yalnız NES ve atanan taşeron.
          </p>
        </div>
        {canEdit && !editing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            {body ? "Düzenle" : "Ekle"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              rows={5}
              maxLength={4000}
              onChange={(e) => setDraft(e.target.value)}
              className="text-base"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setEditing(false)}
                disabled={save.isPending}
              >
                Vazgeç
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm">
            {body || "Henüz yazılmadı."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
