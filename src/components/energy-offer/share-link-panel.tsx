// Teklif paylaşım linki: oluştur / güncelle / kopyala / iptal et ve
// müşterinin açılış kayıtları.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Link2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import { Button } from "@/components/ui/button";

type LinkRow = {
  id: string;
  token: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  view_count: number;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  offer_share_views: { viewed_at: string; user_agent: string | null }[];
};

const dt = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

function device(ua: string | null) {
  if (!ua) return "";
  if (/iPhone|iPad/i.test(ua)) return "iPhone/iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh/i.test(ua)) return "Mac";
  return "";
}

function shareUrl(token: string) {
  return `${window.location.origin}/teklif/${token}`;
}

export function ShareLinkPanel({
  offerId,
  prepare,
}: {
  offerId: string | undefined;
  /** Teklifi kaydeder ve müşteri dosyasının HTML'ini döndürür; kontrol
   * hatası varsa null döner (mesajı kendisi gösterir). */
  prepare: () => Promise<string | null>;
}) {
  const queryClient = useQueryClient();
  const key = ["offer-share-links", offerId];
  const linksQuery = useQuery({
    queryKey: key,
    enabled: Boolean(offerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offer_share_links")
        .select(
          "id, token, created_at, updated_at, revoked_at, view_count, first_viewed_at, last_viewed_at, offer_share_views(viewed_at, user_agent)",
        )
        .eq("offer_id", offerId as string)
        .order("created_at", { ascending: false })
        .order("viewed_at", {
          referencedTable: "offer_share_views",
          ascending: false,
        })
        .limit(5, { referencedTable: "offer_share_views" });
      if (error) throw error;
      return (data ?? []) as LinkRow[];
    },
  });
  const active = linksQuery.data?.find((link) => !link.revoked_at);

  const publish = useMutation({
    mutationFn: async () => {
      if (!offerId) throw new Error("Önce teklifi kaydedin.");
      const html = await prepare();
      if (!html) return null;
      if (active) {
        const { error } = await supabase
          .from("offer_share_links")
          .update({ html, updated_at: new Date().toISOString() })
          .eq("id", active.id);
        if (error) throw error;
        return { token: active.token, updated: true };
      }
      const { data, error } = await supabase
        .from("offer_share_links")
        .insert({ offer_id: offerId, html })
        .select("token")
        .single();
      if (error) throw error;
      return { token: data.token, updated: false };
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ["offers-page"] });
      const url = shareUrl(result.token);
      try {
        await navigator.clipboard.writeText(url);
        toast.success(
          result.updated
            ? "Link güncellendi (aynı adres) ve panoya kopyalandı."
            : "Link oluşturuldu ve panoya kopyalandı.",
        );
      } catch {
        toast.success(
          result.updated ? "Link güncellendi." : "Link oluşturuldu.",
        );
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("offer_share_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ["offers-page"] });
      toast.success("Link iptal edildi; müşteri artık açamaz.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <section className="surface-panel grid gap-2 p-5 text-sm">
      <h2 className="mb-1 flex items-center gap-2 font-black">
        <Link2 className="h-4 w-4" /> Müşteri linki
      </h2>
      {!offerId ? (
        <p className="text-xs text-muted-foreground">
          Link oluşturmak için önce teklifi kaydedin.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Müşteri dosyası giriş gerektirmeyen bir bağlantıyla paylaşılır;
            müşterinin açıp açmadığı burada görünür. Teklifi değiştirirseniz
            "Linki güncelle" ile aynı adres yeni sürümü gösterir. Maliyet
            bilgisi linke girmez.
          </p>
          {active ? (
            <div className="grid gap-2 rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Eye
                  className={`h-4 w-4 ${active.view_count > 0 ? "text-emerald-600" : "text-muted-foreground"}`}
                />
                {active.view_count > 0 ? (
                  <span>
                    <b>Müşteri açtı</b> · {active.view_count} kez
                  </span>
                ) : (
                  <span className="text-muted-foreground">Henüz açılmadı</span>
                )}
              </div>
              {active.view_count > 0 ? (
                <p className="text-xs text-muted-foreground">
                  İlk: {dt(active.first_viewed_at)} · Son:{" "}
                  {dt(active.last_viewed_at)}
                </p>
              ) : null}
              {active.offer_share_views.length > 0 ? (
                <ul className="text-xs text-muted-foreground">
                  {active.offer_share_views.map((view) => (
                    <li key={view.viewed_at}>
                      {dt(view.viewed_at)} {device(view.user_agent)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-[11px] text-muted-foreground">
                Oluşturma {dt(active.created_at)} · son güncelleme{" "}
                {dt(active.updated_at)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        shareUrl(active.token),
                      );
                      toast.success("Link kopyalandı.");
                    } catch {
                      toast.message(shareUrl(active.token));
                    }
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Kopyala
                </Button>
                <Button asChild type="button" size="sm" variant="outline">
                  <a
                    href={shareUrl(active.token)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Aç
                  </a>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => publish.mutate()}
                  disabled={publish.isPending}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  {publish.isPending ? "..." : "Linki güncelle"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => revoke.mutate(active.id)}
                  disabled={revoke.isPending}
                >
                  <XCircle className="mr-1.5 h-3.5 w-3.5" /> İptal et
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              onClick={() => publish.mutate()}
              disabled={publish.isPending || linksQuery.isLoading}
            >
              <Link2 className="mr-2 h-4 w-4" />
              {publish.isPending ? "Hazırlanıyor..." : "Link oluştur"}
            </Button>
          )}
          {linksQuery.error ? (
            <p className="text-xs text-destructive">
              {errorMessage(linksQuery.error)}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
