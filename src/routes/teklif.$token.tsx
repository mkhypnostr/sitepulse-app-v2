import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Müşteriye gönderilen teklif linki. Giriş gerekmez; içerik
// get_shared_offer RPC'si ile yalnız doğru token'la gelir. Açılış RPC
// içinde kaydedilir (NES yöneticisi açarsa sayılmaz).
export const Route = createFileRoute("/teklif/$token")({
  head: () => ({
    meta: [
      { title: "Teklif — NES Enerji" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SharedOfferPage,
});

/** Dar ekranda A4 sayfaları ekrana sığdırır; içerik kum havuzunda
 * (sandbox) çalıştığı için betik dosyanın içine eklenir. */
const FIT_SCRIPT =
  "<script>(function(){function f(){var w=window.innerWidth;document.body.style.zoom=w<820?String(w/820):'';}f();addEventListener('resize',f);})();</script>";

function SharedOfferPage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "error"; message: string }
    | { kind: "ready"; html: string; title: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc("get_shared_offer", {
        p_token: token,
        p_user_agent: navigator.userAgent.slice(0, 300),
      });
      if (cancelled) return;
      if (error) {
        setState({ kind: "error", message: error.message });
        return;
      }
      const row = data?.[0];
      if (!row) {
        setState({ kind: "missing" });
        return;
      }
      document.title = `${row.offer_no} — ${row.title}`;
      setState({
        kind: "ready",
        title: `${row.offer_no} — ${row.title}`,
        html: row.html.replace("</body>", `${FIT_SCRIPT}</body>`),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === "ready") {
    return (
      <iframe
        title={state.title}
        srcDoc={state.html}
        sandbox="allow-scripts allow-modals allow-popups"
        className="fixed inset-0 h-full w-full border-0 bg-[#e6eaeb]"
      />
    );
  }
  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f6f7] p-6 text-center text-[#1f2324]">
      <div className="max-w-sm">
        <img
          src="/nes-enerji-logo.png"
          alt="NES Enerji"
          className="mx-auto mb-6 h-12 w-auto"
        />
        {state.kind === "loading" ? (
          <p className="text-[#5a6566]">Teklif yükleniyor...</p>
        ) : state.kind === "missing" ? (
          <>
            <h1 className="text-lg font-bold">Teklif bulunamadı</h1>
            <p className="mt-2 text-sm text-[#5a6566]">
              Bağlantı hatalı ya da teklif güncellenip yeni bağlantı gönderilmiş
              olabilir. Lütfen NES Enerji ile iletişime geçin: 0 554 610 24 16 ·
              info@nesgrup.com
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold">Teklif açılamadı</h1>
            <p className="mt-2 text-sm text-[#5a6566]">
              Lütfen sayfayı yenileyin. Sorun sürerse NES Enerji ile iletişime
              geçin: 0 554 610 24 16
            </p>
          </>
        )}
      </div>
    </main>
  );
}
