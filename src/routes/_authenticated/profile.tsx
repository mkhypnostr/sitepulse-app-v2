import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage, roleLabels } from "@/lib/domain";
import { LoadingState, PageHeader } from "@/components/page-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

const PHONE_PREFIX = "+90";

function digitsFromPhone(phone: string | null) {
  if (!phone) return "";
  const cleaned = phone.replace(/[^\d+]/g, "");
  const withoutPrefix = cleaned.startsWith(PHONE_PREFIX)
    ? cleaned.slice(PHONE_PREFIX.length)
    : cleaned.replace(/^0/, "");
  return withoutPrefix.slice(0, 10);
}

function ProfilePage() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [phoneDigits, setPhoneDigits] = useState("");
  const [initialized, setInitialized] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["my-profile", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, phone, company_name")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (profileQuery.data && !initialized) {
      setPhoneDigits(digitsFromPhone(profileQuery.data.phone));
      setInitialized(true);
    }
  }, [profileQuery.data, initialized]);

  const savePhone = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Oturum bulunamadı.");
      if (phoneDigits.length !== 10) {
        throw new Error(
          "Telefon numarası 10 haneli olmalıdır (örn. 5xx xxx xx xx).",
        );
      }
      const fullPhone = `${PHONE_PREFIX}${phoneDigits}`;
      const { error } = await supabase
        .from("profiles")
        .update({ phone: fullPhone })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["my-profile", user?.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["current-profile", user?.id],
      });
      toast.success("Telefon numaranız kaydedildi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (profileQuery.isLoading)
    return <LoadingState label="Profil yükleniyor..." />;
  if (profileQuery.error) {
    return (
      <p className="surface-panel p-5 text-destructive">
        {errorMessage(profileQuery.error)}
      </p>
    );
  }

  const profile = profileQuery.data;

  return (
    <>
      <PageHeader
        title="Profilim"
        description="Hesap bilgilerinizi görüntüleyin ve iletişim numaranızı güncelleyin."
      />
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Hesap Bilgileri</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Ad Soyad
            </span>
            <span className="font-bold text-foreground">
              {profile?.full_name || "—"}
            </span>
          </div>
          <div className="grid gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Rol
            </span>
            <span className="font-bold text-foreground">
              {role ? roleLabels[role] : "—"}
            </span>
          </div>
          {profile?.company_name ? (
            <div className="grid gap-1">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Firma
              </span>
              <span className="font-bold text-foreground">
                {profile.company_name}
              </span>
            </div>
          ) : null}

          <label className="grid gap-2 text-sm font-bold text-foreground">
            Telefon Numarası
            <div className="flex gap-2">
              <span className="flex h-9 shrink-0 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-bold text-muted-foreground">
                {PHONE_PREFIX}
              </span>
              <Input
                type="tel"
                inputMode="numeric"
                placeholder="5xx xxx xx xx"
                value={phoneDigits}
                onChange={(event) =>
                  setPhoneDigits(
                    event.target.value.replace(/\D/g, "").slice(0, 10),
                  )
                }
                maxLength={10}
              />
            </div>
          </label>

          <p className="flex items-start gap-2 rounded-lg border border-highlight/30 bg-highlight/5 p-3 text-xs leading-relaxed text-muted-foreground">
            <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-highlight" />
            WhatsApp üzerinden görev bildirimleri alabilmeniz için bu alanın
            dolu ve doğru olması gerekir.
          </p>

          <Button
            type="button"
            onClick={() => savePhone.mutate()}
            disabled={savePhone.isPending || phoneDigits.length !== 10}
            className="w-full sm:w-auto"
          >
            {savePhone.isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
