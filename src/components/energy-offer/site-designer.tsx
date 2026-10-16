// GES saha tasarımı: konum arama, uydu haritasında çatı yüzeyi çizimi,
// otomatik panel yerleşimi ve PVGIS üretim tahmini.
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import {
  Check,
  CloudSun,
  Layers,
  MapPin,
  PenLine,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import { extractMapCoordinates, safeMapUrl } from "@/lib/map-location";
import {
  AZIMUTH_PRESETS,
  combinePvgis,
  layoutSite,
  panelSizeForPower,
  type LatLon,
  type PvgisResult,
  type RoofFace,
  type SiteConfig,
} from "@/lib/solar-site";
import { Field, NumField } from "@/components/energy-offer/fields";
import { fmtNum } from "@/components/energy-offer/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Props = {
  site: SiteConfig;
  onChange: (site: SiteConfig) => void;
  /** Seçili panelin gücü (W); 0 = panel seçilmedi. */
  panelW: number;
  currentPanelCount: number;
  defaultMount: RoofFace["mount"];
  onApplyPanelCount: (count: number) => void;
  onPvgis: (result: PvgisResult) => void;
  onLocationLabel: (label: string) => void;
};

type SearchHit = { label: string; lat: number; lon: number };

const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTR = "Uydu görüntüsü © Esri, Maxar, Earthstar Geographics";
const STREET_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const STREET_ATTR = "© OpenStreetMap katkıcıları";

let faceSeed = 0;
function newFaceId() {
  faceSeed += 1;
  return `f${Date.now().toString(36)}${faceSeed}`;
}

function centroid(points: LatLon[]): LatLon {
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lon = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [lat, lon];
}

export function SiteDesigner({
  site,
  onChange,
  panelW,
  currentPanelCount,
  defaultMount,
  onApplyPanelCount,
  onPvgis,
  onLocationLabel,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const libRef = useRef<typeof Leaflet | null>(null);
  const overlayRef = useRef<Leaflet.LayerGroup | null>(null);
  const baseRef = useRef<{
    satellite: Leaflet.TileLayer;
    street: Leaflet.TileLayer;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [base, setBase] = useState<"satellite" | "street">("satellite");
  const [drawing, setDrawing] = useState<LatLon[] | null>(null);
  const drawingRef = useRef<LatLon[] | null>(null);
  const siteRef = useRef(site);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [fetchingPvgis, setFetchingPvgis] = useState(false);

  siteRef.current = site;
  drawingRef.current = drawing;

  const layout = useMemo(() => layoutSite(site), [site]);
  const kwp = (layout.total * panelW) / 1000;

  // Haritayı yalnız tarayıcıda, bir kez kur.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !containerRef.current || mapRef.current) return;
      libRef.current = L;
      const center: LatLon =
        siteRef.current.lat !== null && siteRef.current.lon !== null
          ? [siteRef.current.lat, siteRef.current.lon]
          : (siteRef.current.faces[0]?.points[0] ?? [37.2153, 28.3636]);
      const zoom =
        siteRef.current.lat !== null || siteRef.current.faces.length ? 19 : 12;
      const map = L.map(containerRef.current, {
        center,
        zoom,
        maxZoom: 21,
        preferCanvas: true,
      });
      const satellite = L.tileLayer(SATELLITE_URL, {
        maxZoom: 21,
        maxNativeZoom: 19,
        attribution: SATELLITE_ATTR,
      });
      const street = L.tileLayer(STREET_URL, {
        maxZoom: 21,
        maxNativeZoom: 19,
        attribution: STREET_ATTR,
      });
      satellite.addTo(map);
      baseRef.current = { satellite, street };
      overlayRef.current = L.layerGroup().addTo(map);
      map.on("click", (event: Leaflet.LeafletMouseEvent) => {
        const current = drawingRef.current;
        if (!current) return;
        setDrawing([...current, [event.latlng.lat, event.latlng.lng]]);
      });
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Altlık harita.
  useEffect(() => {
    const map = mapRef.current;
    const layers = baseRef.current;
    if (!map || !layers) return;
    const [on, off] =
      base === "satellite"
        ? [layers.satellite, layers.street]
        : [layers.street, layers.satellite];
    if (map.hasLayer(off)) map.removeLayer(off);
    if (!map.hasLayer(on)) on.addTo(map);
  }, [base, ready]);

  // Çizim sırasında çift tıklama yakınlaştırmasın.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawing) {
      map.doubleClickZoom.disable();
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = "";
    }
  }, [drawing, ready]);

  // Yüzeyler, paneller, konum ve çizim katmanı.
  useEffect(() => {
    const L = libRef.current;
    const group = overlayRef.current;
    if (!L || !group || !ready) return;
    group.clearLayers();
    site.faces.forEach((face, index) => {
      const isSelected = face.id === selected;
      L.polygon(face.points, {
        color: isSelected ? "#f59e0b" : "#38bdf8",
        weight: isSelected ? 3 : 2,
        fillOpacity: 0.08,
      })
        .on("click", () => {
          if (!drawingRef.current) setSelected(face.id);
        })
        .bindTooltip(face.name || `Yüzey ${index + 1}`, { sticky: true })
        .addTo(group);
      const faceLayout = layout.faces[index];
      for (const rect of faceLayout?.panels ?? []) {
        L.polygon(rect, {
          color: "#cbd5e1",
          weight: 0.6,
          fillColor: "#1e3a5f",
          fillOpacity: 0.85,
          interactive: false,
        }).addTo(group);
      }
      if (isSelected) {
        face.points.forEach((point, pointIndex) => {
          L.marker(point, {
            draggable: true,
            icon: L.divIcon({
              className: "",
              html: '<div style="width:12px;height:12px;border-radius:9999px;background:#f59e0b;border:2px solid #fff;box-shadow:0 0 2px #000"></div>',
              iconSize: [12, 12],
              iconAnchor: [6, 6],
            }),
          })
            .on("dragend", (event: Leaflet.LeafletEvent) => {
              const { lat, lng } = (event.target as Leaflet.Marker).getLatLng();
              updateFace(face.id, {
                points: face.points.map((p, i) =>
                  i === pointIndex ? [lat, lng] : p,
                ),
              });
            })
            .addTo(group);
        });
      }
    });
    if (drawing && drawing.length > 0) {
      L.polyline(drawing, { color: "#f59e0b", dashArray: "4 4" }).addTo(group);
      for (const point of drawing) {
        L.circleMarker(point, {
          radius: 4,
          color: "#f59e0b",
          fillOpacity: 1,
          interactive: false,
        }).addTo(group);
      }
    }
    if (site.lat !== null && site.lon !== null) {
      L.marker([site.lat, site.lon], {
        draggable: true,
        icon: L.divIcon({
          className: "",
          html: '<div style="transform:translate(-50%,-100%);color:#dc2626;filter:drop-shadow(0 1px 1px #000)"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg></div>',
          iconSize: [0, 0],
        }),
        title: "Proje konumu (sürükleyebilirsiniz)",
      })
        .on("dragend", (event: Leaflet.LeafletEvent) => {
          const { lat, lng } = (event.target as Leaflet.Marker).getLatLng();
          onChange({ ...siteRef.current, lat, lon: lng, pvgis: null });
        })
        .addTo(group);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, layout, drawing, selected, ready]);

  function updateFace(id: string, patch: Partial<RoofFace>) {
    const current = siteRef.current;
    onChange({
      ...current,
      pvgis: null,
      faces: current.faces.map((face) =>
        face.id === id ? { ...face, ...patch } : face,
      ),
    });
  }

  function flyTo(lat: number, lon: number, label?: string) {
    onChange({ ...siteRef.current, lat, lon, pvgis: null });
    mapRef.current?.setView([lat, lon], 19);
    if (label) onLocationLabel(label);
    setHits([]);
  }

  async function search() {
    const text = query.trim();
    if (!text) return;
    const pair = text.match(
      /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/,
    );
    if (pair) {
      flyTo(
        Number(pair[1].replace(",", ".")),
        Number(pair[2].replace(",", ".")),
      );
      return;
    }
    setSearching(true);
    try {
      if (safeMapUrl(text)) {
        const direct = extractMapCoordinates(text);
        if (direct) {
          flyTo(direct.latitude, direct.longitude);
          return;
        }
        const { data, error } = await supabase.functions.invoke<{
          latitude: number | null;
          longitude: number | null;
        }>("resolve-map-location", { body: { url: text } });
        if (error) throw error;
        if (data?.latitude == null || data?.longitude == null) {
          throw new Error("Bağlantıdan konum çıkarılamadı.");
        }
        flyTo(data.latitude, data.longitude);
        return;
      }
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
          q: text,
          format: "json",
          limit: "5",
          countrycodes: "tr",
          "accept-language": "tr",
        }).toString()}`,
      );
      if (!response.ok) throw new Error(`Arama HTTP ${response.status}`);
      const rows = (await response.json()) as {
        display_name: string;
        lat: string;
        lon: string;
      }[];
      if (rows.length === 0) {
        toast.error(
          "Adres bulunamadı; Google Maps bağlantısı da yapıştırabilirsiniz.",
        );
      }
      setHits(
        rows.map((row) => ({
          label: row.display_name,
          lat: Number(row.lat),
          lon: Number(row.lon),
        })),
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSearching(false);
    }
  }

  function finishDrawing() {
    if (!drawing || drawing.length < 3) {
      toast.error("Yüzey için en az 3 köşe tıklayın.");
      return;
    }
    const current = siteRef.current;
    const face: RoofFace = {
      id: newFaceId(),
      name: `Yüzey ${current.faces.length + 1}`,
      points: drawing,
      tilt: defaultMount === "sehpa" ? 25 : 20,
      azimuth: current.azimuth,
      setbackM: defaultMount === "sehpa" ? 1 : 0.3,
      mount: defaultMount,
      portrait: true,
      alignDeg: null,
    };
    const [lat, lon] = centroid(drawing);
    const [len, wid] =
      current.faces.length === 0 && panelW > 0
        ? panelSizeForPower(panelW)
        : [current.panelLengthM, current.panelWidthM];
    onChange({
      ...current,
      lat: current.lat ?? lat,
      lon: current.lon ?? lon,
      panelLengthM: len,
      panelWidthM: wid,
      faces: [...current.faces, face],
      pvgis: null,
    });
    setSelected(face.id);
    setDrawing(null);
  }

  async function fetchPvgis() {
    const current = siteRef.current;
    if (current.lat === null || current.lon === null) {
      toast.error("Önce konumu seçin (arama veya haritada yüzey çizerek).");
      return;
    }
    const counts = new Map(layout.faces.map((f) => [f.faceId, f.count]));
    const targets =
      current.faces.length > 0 && layout.total > 0
        ? current.faces
            .filter((face) => (counts.get(face.id) ?? 0) > 0)
            .map((face) => ({
              tilt: face.tilt,
              azimuth: face.azimuth,
              weight: counts.get(face.id) ?? 0,
            }))
        : [{ tilt: current.tilt, azimuth: current.azimuth, weight: 1 }];
    // Aynı eğim/yöndeki yüzeyler tek istekte birleşir.
    const merged = new Map<
      string,
      { tilt: number; azimuth: number; weight: number }
    >();
    for (const t of targets) {
      const key = `${t.tilt}|${t.azimuth}`;
      const prev = merged.get(key);
      merged.set(key, prev ? { ...prev, weight: prev.weight + t.weight } : t);
    }
    setFetchingPvgis(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Oturum bulunamadı.");
      const parts: { result: PvgisResult; weight: number }[] = [];
      for (const target of [...merged.values()].slice(0, 6)) {
        const params = new URLSearchParams({
          lat: String(current.lat),
          lon: String(current.lon),
          tilt: String(target.tilt),
          azimuth: String(target.azimuth),
          loss: String(current.lossPct),
        });
        const response = await fetch(`/api/pvgis?${params.toString()}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const body = (await response.json()) as PvgisResult & {
          error?: string;
        };
        if (!response.ok || body.error) {
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        parts.push({ result: body, weight: target.weight });
      }
      const result = combinePvgis(parts);
      if (!result) throw new Error("PVGIS sonucu birleştirilemedi.");
      onChange({ ...siteRef.current, pvgis: result });
      onPvgis(result);
      toast.success(
        `PVGIS (${result.db}): yıllık ${fmtNum(result.kwhPerKwp, 0)} kWh/kWp. Özgül üretim güncellendi.`,
      );
    } catch (error) {
      toast.error(`PVGIS: ${errorMessage(error)}`);
    } finally {
      setFetchingPvgis(false);
    }
  }

  const selectedFace = site.faces.find((face) => face.id === selected);

  return (
    <div className="mt-4 grid gap-3 rounded-md border border-border p-4">
      <div>
        <h3 className="flex items-center gap-2 font-bold">
          <MapPin className="h-4 w-4" /> Saha, çatı yerleşimi ve PVGIS üretimi
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Adresi arayın veya Google Maps bağlantısı yapıştırın. "Yüzey çiz" ile
          çatının köşelerine sırayla tıklayın, "Bitir"e basın; paneller kenar
          boşluğuna göre otomatik yerleşir. Köşeleri sürükleyerek
          düzeltebilirsiniz. Uydu görüntüsü güncel olmayabilir; keşifte ölçüyle
          doğrulayın.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={query}
          placeholder="Adres, '37.21, 28.36' veya Google Maps bağlantısı"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="h-10 shrink-0"
          onClick={() => void search()}
          disabled={searching}
        >
          <Search className="mr-1.5 h-4 w-4" />
          {searching ? "Aranıyor..." : "Bul"}
        </Button>
      </div>
      {hits.length > 0 ? (
        <div className="grid gap-1 rounded-md border border-border p-1 text-sm">
          {hits.map((hit) => (
            <button
              key={`${hit.lat},${hit.lon}`}
              type="button"
              className="rounded px-2 py-1.5 text-left hover:bg-muted"
              onClick={() =>
                flyTo(
                  hit.lat,
                  hit.lon,
                  hit.label.split(",").slice(0, 3).join(",").trim(),
                )
              }
            >
              {hit.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {drawing ? (
          <>
            <Button type="button" size="sm" onClick={finishDrawing}>
              <Check className="mr-1.5 h-4 w-4" /> Bitir ({drawing.length} köşe)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDrawing(drawing.slice(0, -1))}
              disabled={drawing.length === 0}
            >
              <Undo2 className="mr-1.5 h-4 w-4" /> Son köşeyi geri al
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setDrawing(null)}
            >
              <X className="mr-1.5 h-4 w-4" /> İptal
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setSelected(null);
              setDrawing([]);
            }}
          >
            <PenLine className="mr-1.5 h-4 w-4" /> Yüzey çiz
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setBase((b) => (b === "satellite" ? "street" : "satellite"))
          }
        >
          <Layers className="mr-1.5 h-4 w-4" />
          {base === "satellite" ? "Sokak haritası" : "Uydu"}
        </Button>
      </div>

      <div
        ref={containerRef}
        className="z-0 h-[420px] w-full overflow-hidden rounded-md border border-border bg-muted"
      />

      {site.faces.length > 0 ? (
        <div className="grid gap-2">
          {site.faces.map((face, index) => {
            const count = layout.faces[index]?.count ?? 0;
            const area = layout.faces[index]?.areaM2 ?? 0;
            return (
              <button
                key={face.id}
                type="button"
                onClick={() => setSelected(face.id)}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm ${face.id === selected ? "border-amber-500 bg-amber-500/10" : "border-border"}`}
              >
                <span className="font-semibold">{face.name}</span>
                <span className="text-xs text-muted-foreground">
                  {fmtNum(area, 0)} m² · {count} panel ·{" "}
                  {fmtNum((count * panelW) / 1000)} kWp · eğim {face.tilt}° ·{" "}
                  {AZIMUTH_PRESETS.find(([v]) => v === face.azimuth)?.[1] ??
                    `${face.azimuth}°`}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {selectedFace ? (
        <div className="grid gap-3 rounded-md bg-muted/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Yüzey adı">
            <Input
              value={selectedFace.name}
              maxLength={40}
              onChange={(e) =>
                updateFace(selectedFace.id, { name: e.target.value })
              }
            />
          </Field>
          <Field label="Montaj">
            <Select
              value={selectedFace.mount}
              onValueChange={(v) =>
                updateFace(selectedFace.id, {
                  mount: v as RoofFace["mount"],
                })
              }
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cati">Çatıya paralel</SelectItem>
                <SelectItem value="sehpa">Sehpa (düz çatı / arazi)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Panel eğimi (°)"
            hint={
              selectedFace.mount === "cati"
                ? "Çatı eğimi; kiremit çatıda tipik 15–30"
                : "Sehpa açısı; Muğla için 25–30"
            }
          >
            <NumField
              value={selectedFace.tilt}
              onChange={(v) =>
                updateFace(selectedFace.id, {
                  tilt: Math.min(60, Math.max(0, Math.round(v))),
                })
              }
            />
          </Field>
          <Field label="Yön">
            <Select
              value={String(selectedFace.azimuth)}
              onValueChange={(v) =>
                updateFace(selectedFace.id, { azimuth: Number(v) })
              }
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AZIMUTH_PRESETS.map(([value, label]) => (
                  <SelectItem key={value} value={String(value)}>
                    {label}
                  </SelectItem>
                ))}
                {AZIMUTH_PRESETS.some(
                  ([value]) => value === selectedFace.azimuth,
                ) ? null : (
                  <SelectItem value={String(selectedFace.azimuth)}>
                    {selectedFace.azimuth}°
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kenar boşluğu (m)" hint="Saçak, yangın/bakım yolu">
            <NumField
              value={selectedFace.setbackM}
              onChange={(v) =>
                updateFace(selectedFace.id, {
                  setbackM: Math.min(10, Math.max(0, v)),
                })
              }
            />
          </Field>
          <Field label="Dizilim açısı (°)" hint="Boş = en uzun kenara paralel">
            <NumField
              value={selectedFace.alignDeg ?? 0}
              placeholder="otomatik"
              onChange={(v) =>
                updateFace(selectedFace.id, {
                  alignDeg: v === 0 ? null : Math.round(v),
                })
              }
            />
          </Field>
          <label className="flex items-center gap-3 self-end pb-2 text-sm font-medium">
            <Switch
              checked={selectedFace.portrait}
              onCheckedChange={(portrait) =>
                updateFace(selectedFace.id, { portrait })
              }
            />
            Dikey panel
          </label>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              className="h-10 text-destructive"
              onClick={() => {
                onChange({
                  ...site,
                  pvgis: null,
                  faces: site.faces.filter((f) => f.id !== selectedFace.id),
                });
                setSelected(null);
              }}
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Yüzeyi sil
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field
          label="Panel boyu (m)"
          hint={panelW ? `${panelW} Wp için tipik` : undefined}
        >
          <NumField
            value={site.panelLengthM}
            onChange={(v) =>
              onChange({
                ...site,
                panelLengthM: Math.max(0, v),
                pvgis: site.pvgis,
              })
            }
          />
        </Field>
        <Field label="Panel eni (m)">
          <NumField
            value={site.panelWidthM}
            onChange={(v) =>
              onChange({
                ...site,
                panelWidthM: Math.max(0, v),
                pvgis: site.pvgis,
              })
            }
          />
        </Field>
        <Field label="Sistem kaybı (%)" hint="PVGIS önerisi 14">
          <NumField
            value={site.lossPct}
            onChange={(v) =>
              onChange({
                ...site,
                lossPct: Math.min(50, Math.max(0, v)),
                pvgis: null,
              })
            }
          />
        </Field>
        {site.faces.length === 0 ? (
          <>
            <Field label="Eğim (°)" hint="Yüzey çizilmezse PVGIS için">
              <NumField
                value={site.tilt}
                onChange={(v) =>
                  onChange({
                    ...site,
                    tilt: Math.min(60, Math.max(0, Math.round(v))),
                    pvgis: null,
                  })
                }
              />
            </Field>
            <Field label="Yön">
              <Select
                value={String(site.azimuth)}
                onValueChange={(v) =>
                  onChange({ ...site, azimuth: Number(v), pvgis: null })
                }
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AZIMUTH_PRESETS.map(([value, label]) => (
                    <SelectItem key={value} value={String(value)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-3 text-sm">
        {site.faces.length > 0 ? (
          <>
            <span>
              Sığan: <b>{layout.total} panel</b>
              {panelW > 0 ? ` = ${fmtNum(kwp)} kWp` : ""} · çatı alanı{" "}
              {fmtNum(layout.areaM2, 0)} m²
              {currentPanelCount !== layout.total
                ? ` (teklifte ${currentPanelCount} panel var)`
                : " (teklifle aynı)"}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                layout.total === 0 || currentPanelCount === layout.total
              }
              onClick={() => onApplyPanelCount(layout.total)}
            >
              Panel adedini teklife aktar
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">
            Henüz çatı yüzeyi yok; PVGIS yalnız konum, eğim ve yönle de çalışır.
          </span>
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => void fetchPvgis()}
          disabled={fetchingPvgis || site.lat === null}
        >
          <CloudSun className="mr-1.5 h-4 w-4" />
          {fetchingPvgis ? "PVGIS hesaplıyor..." : "PVGIS üretimini al"}
        </Button>
        {site.pvgis ? (
          <span className="text-xs text-muted-foreground">
            Son PVGIS: {fmtNum(site.pvgis.kwhPerKwp, 0)} kWh/kWp ·{" "}
            {site.pvgis.db} · eğim {site.pvgis.tilt}° · kayıp %
            {site.pvgis.lossPct}
          </span>
        ) : site.lat !== null ? (
          <span className="text-xs text-amber-700">
            Konum/yüzey değişti; PVGIS'i yeniden alın.
          </span>
        ) : null}
      </div>
    </div>
  );
}
