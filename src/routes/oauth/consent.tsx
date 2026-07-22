import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type AuthorizationDetails = {
  authorization_id?: string;
  redirect_url?: string;
  redirect_uri?: string;
  scope?: string;
  client?: { name?: string };
};

export const Route = createFileRoute("/oauth/consent")({
  validateSearch: (search: Record<string, unknown>) => ({
    authorization_id:
      typeof search.authorization_id === "string" ? search.authorization_id : undefined,
  }),
  component: OAuthConsentPage,
});

const scopeLabels: Record<string, string> = {
  openid: "Kimliğinizi doğrulama",
  email: "E-posta adresinizi görme",
  profile: "Ad ve profil bilginizi görme",
};

function OAuthConsentPage() {
  const { authorization_id: authorizationId } = Route.useSearch();
  const { user, role, loading: authLoading } = useAuth();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    if (!authorizationId) {
      setError("Bağlantı isteği bulunamadı.");
      setLoading(false);
      return;
    }

    if (!user) {
      const returnPath = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
      window.location.assign(`/?redirect=${encodeURIComponent(returnPath)}`);
      return;
    }

    async function loadDetails() {
      const { data, error: detailsError } = await supabase.auth.oauth.getAuthorizationDetails(
        authorizationId!,
      );

      if (detailsError) {
        setError(detailsError.message);
      } else if (data && "redirect_url" in data && !("authorization_id" in data)) {
        window.location.assign(data.redirect_url);
        return;
      } else {
        setDetails(data as AuthorizationDetails);
      }
      setLoading(false);
    }

    loadDetails();
  }, [authLoading, authorizationId, user]);

  async function decide(decision: "approve" | "deny") {
    if (!authorizationId || submitting) return;
    setSubmitting(true);
    setError(null);

    const response =
      decision === "approve"
        ? await supabase.auth.oauth.approveAuthorization(authorizationId)
        : await supabase.auth.oauth.denyAuthorization(authorizationId);

    if (response.error) {
      setError(response.error.message);
      setSubmitting(false);
      return;
    }
    window.location.assign(response.data.redirect_url);
  }

  const scopes = details?.scope?.split(" ").filter(Boolean) ?? [];

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-950">
      <Card className="w-full max-w-xl border-slate-200 bg-white shadow-xl shadow-slate-200/60">
        <CardHeader className="space-y-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <img
              src="/app-icon.svg"
              alt="NES Enerji"
              className="h-12 w-12 rounded-xl border border-slate-200 bg-white"
            />
            <div>
              <p className="font-black tracking-wide">NES ENERJİ</p>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#0046a4]">
                Güvenli bağlantı
              </p>
            </div>
          </div>
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#0046a4]">
              <ShieldCheck className="h-4 w-4" /> Yönetici onayı
            </div>
            <CardTitle className="text-2xl font-black text-slate-950">
              NES Kullanıcı Yönetimi bağlantısı
            </CardTitle>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {details?.client?.name || "ChatGPT"} NES hesabınıza güvenli erişim istiyor.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          {loading || authLoading ? (
            <p className="py-8 text-center font-semibold text-slate-500">
              Bağlantı isteği kontrol ediliyor...
            </p>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : role !== "admin" ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
              Bu bağlantıyı yalnızca NES Enerji yöneticisi onaylayabilir. Giriş yapılan hesap:
              <strong className="ml-1">{user?.email}</strong>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-black text-slate-900">İstenen temel izinler</p>
                <ul className="mt-3 space-y-2">
                  {scopes.map((scope) => (
                    <li key={scope} className="flex items-center gap-2 text-sm text-slate-600">
                      <Check className="h-4 w-4 text-emerald-600" />
                      {scopeLabels[scope] ?? scope}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl bg-blue-50 p-4 text-sm leading-6 text-slate-600">
                Kullanıcı oluşturma gibi yazma işlemleri için ChatGPT ayrıca açık onayınızı ister.
                Bağlantı yalnızca yönetici hesabınızla çalışır.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => decide("deny")}
                  className="h-12 border-slate-300"
                >
                  <X className="mr-2 h-5 w-5" /> Reddet
                </Button>
                <Button
                  type="button"
                  disabled={submitting}
                  onClick={() => decide("approve")}
                  className="h-12 bg-[#0046a4] font-bold text-white hover:bg-[#00377f]"
                >
                  <ShieldCheck className="mr-2 h-5 w-5" />
                  {submitting ? "Onaylanıyor..." : "Bağlantıya İzin Ver"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
