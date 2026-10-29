import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Leaflet from "leaflet";
import { LocateFixed } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { isEnergyOfferConfig } from "@/lib/energy-offer";
import { extractMapCoordinates } from "@/lib/map-location";
import { isOperationalManager } from "@/lib/permissions";
import { stageLabels, type SalesStage } from "@/lib/sales";
import {
  AccessDenied,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/map")({
  component: MapPage,
});

type Layer = "project" | "work_order" | "lead" | "offer";

type Point = {
  id: string;
  layer: Layer;
  lat: number;
  lon: number;
  title: string;
  subtitle: string;
  href: string;
};

const layerInfo: Record<Layer, { label: string; color: string }> = {
  project: { label: "Projeler", color: "#2563eb" },
  work_order: { label: "İş emirleri", color: "#f59e0b" },
  lead: { label: "Satış fırsatları", color: "#10b981" },
  offer: { label: "Teklifler", color: "#a855f7" },
};

const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

async function resolveUrl(url: string | null) {
  if (!url) return null;
  const direct = extractMapCoordinates(url);
  if (direct) return direct;
  try {
    const { data } = await supabase.functions.invoke<{
      latitude: number | null;
      longitude: number | null;
    }>("resolve-map-location", { body: { url } });
    if (data?.latitude != null && data?.longitude != null) {
      return { latitude: data.latitude, longitude: data.longitude };
    }
  } catch {
    // Çözülemeyen bağlantı haritada gösterilmez.
  }
  return null;
}

function MapPage() {
  const { role } = useAuth();
  const canView = isOperationalManager(role);
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const libRef = useRef<typeof Leaflet | null>(null);
  const groupRef = useRef<Leaflet.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState<Record<Layer, boolean>>({
    project: true,
    work_order: true,
    lead: true,
    offer: true,
  });

  const dataQuery = useQuery({
    queryKey: ["map-page", isAdmin],
    enabled: canView,
    queryFn: async () => {
      const [projects, orders, leads, offers] = await Promise.all([
        supabase
          .from("projects")
          .select(
            "id, project_no, name, location_url, district, province, status",
          )
          .neq("status", "cancelled"),
        supabase
          .from("work_orders")
          .select("id, work_order_no, title, location_url, location, status")
          .not("status", "in", "(cancelled)"),
        isAdmin
          ? supabase
              .from("sales_leads")
              .select("id, title, stage, location, latitude, longitude")
          : Promise.resolve({ data: [], error: null }),
        isAdmin
          ? supabase
              .from("offers")
              .select("id, offer_no, title, status, module_config")
              .not("status", "in", "(lost,cancelled)")
          : Promise.resolve({ data: [], error: null }),
      ]);
      for (const r of [projects, orders, leads, offers]) {
        if (r.error) throw r.error;
      }
      const points: Point[] = [];
      const missing: { layer: Layer; title: string }[] = [];

      const projectCoords = await Promise.all(
        (projects.data ?? []).map((p) => resolveUrl(p.location_url)),
      );
      (projects.data ?? []).forEach((p, i) => {
        const c = projectCoords[i];
        if (!c) {
          missing.push({ layer: "project", title: p.name });
          return;
        }
        points.push({
          id: p.id,
          layer: "project",
          lat: c.latitude,
          lon: c.longitude,
          title: `${p.project_no ?? ""} ${p.name}`.trim(),
          subtitle: [p.district, p.province].filter(Boolean).join(" / "),
          href: `/projects/${p.id}`,
        });
      });

      const orderCoords = await Promise.all(
        (orders.data ?? []).map((o) => resolveUrl(o.location_url)),
      );
      (orders.data ?? []).forEach((o, i) => {
        const c = orderCoords[i];
        if (!c) {
          missing.push({ layer: "work_order", title: o.title });
          return;
        }
        points.push({
          id: o.id,
          layer: "work_order",
          lat: c.latitude,
          lon: c.longitude,
          title: o.title,
          subtitle: o.location ?? "",
          href: `/work-orders`,
        });
      });

      for (const l of (leads.data ?? []) as {
        id: string;
        title: string;
        stage: SalesStage;
        location: string | null;
        latitude: number | null;
        longitude: number | null;
      }[]) {
        if (l.latitude == null || l.longitude == null) {
          missing.push({ layer: "lead", title: l.title });
          continue;
        }
        points.push({
          id: l.id,
          layer: "lead",
          lat: l.latitude,
          lon: l.longitude,
          title: l.title,
          subtitle: `${stageLabels[l.stage]}${l.location ? ` · ${l.location}` : ""}`,
          href: `/sales?leadId=${l.id}`,
        });
      }

      for (const o of (offers.data ?? []) as {
        id: string;
        offer_no: string;
        title: string;
        module_config: unknown;
      }[]) {
        if (!isEnergyOfferConfig(o.module_config)) continue;
        const site = (
          o.module_config as {
            site?: { lat: number | null; lon: number | null };
          }
        ).site;
        if (site?.lat == null || site?.lon == null) continue;
        points.push({
          id: o.id,
          layer: "offer",
          lat: site.lat,
          lon: site.lon,
          title: `${o.offer_no} ${o.title}`,
          subtitle: "Teklif",
          href: `/energy-offer?offerId=${o.id}`,
        });
      }

      const leadsToGeocode = (
        (leads.data ?? []) as {
          id: string;
          location: string | null;
          latitude: number | null;
        }[]
      ).filter(
        (l) => l.latitude == null && (l.location ?? "").trim().length > 2,
      );

      return { points, missing, leadsToGeocode };
    },
  });

  // Konum metni olan fırsatlar için adres araması (Nominatim, saniyede 1).
  const geocode = useMutation({
    mutationFn: async () => {
      const list = dataQuery.data?.leadsToGeocode ?? [];
      let found = 0;
      for (const lead of list.slice(0, 30)) {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
            q: `${lead.location}, Türkiye`,
            format: "json",
            limit: "1",
            countrycodes: "tr",
          }).toString()}`,
        );
        if (response.ok) {
          const rows = (await response.json()) as {
            lat: string;
            lon: string;
          }[];
          if (rows[0]) {
            const { error } = await supabase
              .from("sales_leads")
              .update({
                latitude: Number(rows[0].lat),
                longitude: Number(rows[0].lon),
              })
              .eq("id", lead.id);
            if (!error) found += 1;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      return { found, total: Math.min(list.length, 30) };
    },
    onSuccess: async ({ found, total }) => {
      await queryClient.invalidateQueries({ queryKey: ["map-page"] });
      toast.success(`${total} fırsattan ${found} tanesinin konumu bulundu.`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !containerRef.current || mapRef.current) return;
      libRef.current = L;
      const map = L.map(containerRef.current, {
        center: [37.2153, 28.3636],
        zoom: 9,
        preferCanvas: true,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap katkıcıları",
      }).addTo(map);
      groupRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [canView]);

  const points = useMemo(
    () => (dataQuery.data?.points ?? []).filter((p) => visible[p.layer]),
    [dataQuery.data, visible],
  );

  useEffect(() => {
    const L = libRef.current;
    const group = groupRef.current;
    const map = mapRef.current;
    if (!L || !group || !map || !ready) return;
    group.clearLayers();
    for (const p of points) {
      L.circleMarker([p.lat, p.lon], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: layerInfo[p.layer].color,
        fillOpacity: 0.95,
      })
        .bindPopup(
          `<b>${esc(p.title)}</b><br><span style="color:#666">${esc(layerInfo[p.layer].label)}${p.subtitle ? ` · ${esc(p.subtitle)}` : ""}</span><br><a href="${esc(p.href)}">Kaydı aç →</a>`,
        )
        .addTo(group);
    }
    if (points.length > 0) {
      map.fitBounds(
        L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number])),
        { padding: [40, 40], maxZoom: 13 },
      );
    }
  }, [points, ready]);

  if (!canView) return <AccessDenied />;

  const counts = (layer: Layer) =>
    (dataQuery.data?.points ?? []).filter((p) => p.layer === layer).length;
  const missing = dataQuery.data?.missing ?? [];
  const toGeocode = dataQuery.data?.leadsToGeocode.length ?? 0;

  return (
    <>
      <PageHeader
        title="Harita"
        description="Projeler, iş emirleri, satış fırsatları ve teklifler tek haritada. Ziyaret planlarken yakın işleri birlikte görün."
        actions={
          isAdmin && toGeocode > 0 ? (
            <Button
              variant="outline"
              className="h-11"
              onClick={() => geocode.mutate()}
              disabled={geocode.isPending}
              title="Konum metni olan ama haritada yeri olmayan fırsatlar için adres araması yapar (OpenStreetMap)."
            >
              <LocateFixed className="mr-2 h-4 w-4" />
              {geocode.isPending
                ? "Konumlar aranıyor..."
                : `${toGeocode} fırsatın konumunu bul`}
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {(Object.keys(layerInfo) as Layer[])
          .filter(
            (layer) => isAdmin || layer === "project" || layer === "work_order",
          )
          .map((layer) => (
            <button
              key={layer}
              type="button"
              onClick={() => setVisible((v) => ({ ...v, [layer]: !v[layer] }))}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${visible[layer] ? "border-border bg-card" : "border-dashed border-border opacity-50"}`}
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: layerInfo[layer].color }}
              />
              {layerInfo[layer].label} ({counts(layer)})
            </button>
          ))}
      </div>
      {dataQuery.isLoading ? (
        <LoadingState label="Konumlar yükleniyor..." />
      ) : null}
      {dataQuery.error ? (
        <p className="mb-2 text-sm text-destructive">
          {errorMessage(dataQuery.error)}
        </p>
      ) : null}
      <div
        ref={containerRef}
        className="z-0 h-[65vh] min-h-[360px] w-full overflow-hidden rounded-lg border border-border bg-muted"
      />
      {missing.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Haritada konumu olmayan {missing.length} kayıt var (konum bağlantısı
          veya konum bilgisi eksik):{" "}
          {missing
            .slice(0, 8)
            .map((m) => m.title)
            .join(", ")}
          {missing.length > 8 ? "…" : ""}
        </p>
      ) : null}
    </>
  );
}
