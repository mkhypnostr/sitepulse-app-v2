import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage, roleLabels, type AppRole } from "@/lib/domain";
import { AccessDenied, EmptyState, LoadingState, PageHeader } from "@/components/page-states";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPage,
});

function TeamPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const teamQuery = useQuery({
    queryKey: ["team"],
    enabled: role === "admin",
    queryFn: async () => {
      const [{ data: profiles, error: profileError }, { data: roles, error: roleError }] =
        await Promise.all([
          supabase.from("profiles").select("*").order("full_name"),
          supabase.from("user_roles").select("user_id, role"),
        ]);
      if (profileError) throw profileError;
      if (roleError) throw roleError;
      const roleByUser = new Map(roles.map((item) => [item.user_id, item.role]));
      return profiles.map((profile) => ({
        ...profile,
        role: roleByUser.get(profile.id) ?? ("customer" as const),
      }));
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: AppRole }) => {
      const { error } = await supabase.rpc("set_user_role", {
        target_user_id: userId,
        new_role: newRole,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["team"] });
      toast.success("Kullanıcı rolü güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (role !== "admin") return <AccessDenied />;
  if (teamQuery.isLoading) return <LoadingState />;

  const members = teamQuery.data ?? [];
  return (
    <>
      <PageHeader
        title="Ekip ve Yetkiler"
        description="Supabase Auth üzerinden oluşturulan kullanıcıların uygulama rollerini yönetin."
      />
      {members.length === 0 ? (
        <EmptyState
          title="Kullanıcı profili bulunamadı"
          description="Önce Supabase Authentication → Users bölümünden kullanıcı oluşturun. Profil otomatik oluşacaktır."
        />
      ) : (
        <div className="surface-panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kullanıcı</TableHead>
                <TableHead>Firma</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead className="w-56">Rol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-bold">
                    {member.full_name || "İsimsiz kullanıcı"}
                  </TableCell>
                  <TableCell>{member.company_name || "—"}</TableCell>
                  <TableCell>{member.phone || "—"}</TableCell>
                  <TableCell>
                    <Select
                      value={member.role}
                      onValueChange={(newRole: AppRole) =>
                        roleMutation.mutate({ userId: member.id, newRole })
                      }
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(roleLabels) as AppRole[]).map((itemRole) => (
                          <SelectItem key={itemRole} value={itemRole}>
                            {roleLabels[itemRole]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-primary" /> Kullanıcılar kayıt olurken yönetici rolü
        seçemez.
      </div>
    </>
  );
}
