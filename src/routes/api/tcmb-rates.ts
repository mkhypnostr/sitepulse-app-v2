import { createFileRoute } from "@tanstack/react-router";
import { parseTcmbXml, TCMB_TODAY_URL } from "@/lib/tcmb";

// TCMB tarayıcıdan doğrudan okunamıyor (CORS yok); kur bülteni sunucuda
// alınıp JSON olarak verilir. Veri herkese açık olduğundan oturum istenmez.
export const Route = createFileRoute("/api/tcmb-rates")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const response = await fetch(TCMB_TODAY_URL, {
            headers: { accept: "application/xml,text/xml" },
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok) {
            return Response.json(
              { error: `TCMB yanıt vermedi (HTTP ${response.status}).` },
              { status: 502 },
            );
          }
          const rates = parseTcmbXml(await response.text());
          if (!rates) {
            return Response.json(
              { error: "TCMB kur bülteni okunamadı." },
              { status: 502 },
            );
          }
          return Response.json(rates, {
            headers: {
              "cache-control": "public, max-age=900, s-maxage=900",
            },
          });
        } catch {
          return Response.json(
            { error: "TCMB'ye bağlanılamadı." },
            { status: 502 },
          );
        }
      },
    },
  },
});
