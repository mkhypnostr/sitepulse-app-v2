// GES saha modeli: konum, çatı yüzeyleri, panel yerleşimi ve PVGIS üretimi.
// Saf hesaplar; harita ve arayüzden bağımsızdır.

export type LatLon = [number, number];

/** Montaj: "cati" panel çatıya paralel (kiremit/trapez), "sehpa" düz çatı
 * veya arazide eğimli sehpa (sıralar arası gölge boşluğu gerekir). */
export type MountType = "cati" | "sehpa";

export type RoofFace = {
  id: string;
  name: string;
  points: LatLon[];
  /** Panel eğimi, derece. */
  tilt: number;
  /** PVGIS yönü: 0 güney, -90 doğu, 90 batı, ±180 kuzey. */
  azimuth: number;
  /** Kenarlardan bırakılan boşluk, m (yangın/bakım yolu, saçak). */
  setbackM: number;
  mount: MountType;
  /** Dikey (uzun kenar eğim yönünde) yerleşim. */
  portrait: boolean;
  /** Dizilim açısı, derece (doğuya göre saat yönünün tersi). null = en uzun
   * kenara paralel. */
  alignDeg: number | null;
};

export type PvgisResult = {
  lat: number;
  lon: number;
  tilt: number;
  azimuth: number;
  lossPct: number;
  /** Yıllık kWh/kWp. */
  kwhPerKwp: number;
  /** 12 ayın kWh/kWp üretimi. */
  monthlyPerKwp: number[];
  /** Işınım veritabanı (ör. PVGIS-SARAH3). */
  db: string;
  fetchedAt: string;
};

export type SiteConfig = {
  lat: number | null;
  lon: number | null;
  /** Yüzey çizilmemişse PVGIS'e giden eğim/yön. */
  tilt: number;
  azimuth: number;
  /** Sistem kayıpları (kablo, inverter, kirlenme), %. PVGIS önerisi 14. */
  lossPct: number;
  panelLengthM: number;
  panelWidthM: number;
  faces: RoofFace[];
  /** Son alınan PVGIS sonucu (yüzeyler varsa panel sayısına göre ağırlıklı). */
  pvgis: PvgisResult | null;
};

export const defaultSite: SiteConfig = {
  lat: null,
  lon: null,
  tilt: 25,
  azimuth: 0,
  lossPct: 14,
  panelLengthM: 2.278,
  panelWidthM: 1.134,
  faces: [],
  pvgis: null,
};

/** Katalogda ölçü olmadığı için panel gücünden tipik boyut (m). */
export function panelSizeForPower(powerW: number): [number, number] {
  if (powerW >= 680) return [2.384, 1.303];
  if (powerW >= 500) return [2.278, 1.134];
  if (powerW >= 420) return [1.903, 1.134];
  return [1.722, 1.134];
}

export const AZIMUTH_PRESETS: [number, string][] = [
  [0, "Güney"],
  [-45, "Güneydoğu"],
  [45, "Güneybatı"],
  [-90, "Doğu"],
  [90, "Batı"],
  [-135, "Kuzeydoğu"],
  [135, "Kuzeybatı"],
  [180, "Kuzey"],
];

export function azimuthLabel(azimuth: number) {
  const exact = AZIMUTH_PRESETS.find(([value]) => value === azimuth);
  return exact ? exact[1] : `${azimuth}°`;
}

// ---------------------------------------------------------------- geometri

type Pt = { x: number; y: number };

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON = 111_320;

/** Enlem/boylamı ilk noktaya göre yerel metre koordinatına çevirir. */
export function toLocal(points: LatLon[], origin?: LatLon) {
  const [lat0, lon0] = origin ?? points[0] ?? [0, 0];
  const k = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG_LON;
  return {
    pts: points.map(([lat, lon]) => ({
      x: (lon - lon0) * k,
      y: (lat - lat0) * M_PER_DEG_LAT,
    })),
    back: (p: Pt): LatLon => [lat0 + p.y / M_PER_DEG_LAT, lon0 + p.x / k],
  };
}

export function polygonArea(pts: Pt[]) {
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function faceAreaM2(face: RoofFace) {
  if (face.points.length < 3) return 0;
  return polygonArea(toLocal(face.points).pts);
}

function rotate(p: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function pointInPolygon(p: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToBoundary(p: Pt, poly: Pt[]) {
  let min = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    min = Math.min(min, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return min;
}

/** En uzun kenarın açısı (radyan). */
export function longestEdgeAngle(pts: Pt[]) {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) {
      best = len;
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  return angle;
}

/** Kış gündönümü öğle güneşinde (en düşük güneş) sıralar arası gölge
 * boşluğu, m. */
export function shadowGapM(slopeLengthM: number, tiltDeg: number, lat: number) {
  const sunAlt = Math.max(10, 90 - Math.abs(lat) - 23.44);
  const height = slopeLengthM * Math.sin((tiltDeg * Math.PI) / 180);
  return height / Math.tan((sunAlt * Math.PI) / 180);
}

export type PanelRect = LatLon[];

export type FaceLayout = {
  faceId: string;
  count: number;
  areaM2: number;
  /** Paneller, her biri 4 köşe (enlem, boylam). */
  panels: PanelRect[];
  /** Yerel metre koordinatında çatı ve paneller (dosyadaki çizim için). */
  local: { roof: Pt[]; panels: Pt[][] };
};

const PANEL_GAP_M = 0.02;

/** Bir çatı yüzeyine panelleri ızgara düzeninde yerleştirir. Her panelin
 * köşeleri ve kenar ortaları poligonun içinde ve kenarlara en az
 * `setbackM` uzaklıkta olmalı; birkaç ızgara kaydırması denenip en çok
 * panel sığan seçilir. Uzunluklar haritadaki yatay izdüşümdür; eğimli
 * panelin izdüşümü uzunluk × cos(eğim) alınır. */
export function layoutFace(
  face: RoofFace,
  panelLengthM: number,
  panelWidthM: number,
  lat: number,
): FaceLayout {
  const empty: FaceLayout = {
    faceId: face.id,
    count: 0,
    areaM2: 0,
    panels: [],
    local: { roof: [], panels: [] },
  };
  if (face.points.length < 3 || !(panelLengthM > 0) || !(panelWidthM > 0)) {
    return empty;
  }
  const { pts, back } = toLocal(face.points);
  const areaM2 = polygonArea(pts);
  const angle =
    face.alignDeg === null
      ? longestEdgeAngle(pts)
      : (face.alignDeg * Math.PI) / 180;
  const poly = pts.map((p) => rotate(p, -angle));

  const slope = face.portrait ? panelLengthM : panelWidthM;
  const across = face.portrait ? panelWidthM : panelLengthM;
  const cosTilt = Math.cos((face.tilt * Math.PI) / 180);
  const depth = slope * cosTilt;
  const rowGap =
    face.mount === "sehpa"
      ? Math.max(PANEL_GAP_M, shadowGapM(slope, face.tilt, lat))
      : PANEL_GAP_M;
  const pitchX = across + PANEL_GAP_M;
  const pitchY = depth + rowGap;

  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const setback = Math.max(0, face.setbackM);

  const fits = (x: number, y: number) => {
    const samples: Pt[] = [
      { x, y },
      { x: x + across, y },
      { x: x + across, y: y + depth },
      { x, y: y + depth },
      { x: x + across / 2, y },
      { x: x + across / 2, y: y + depth },
      { x, y: y + depth / 2 },
      { x: x + across, y: y + depth / 2 },
    ];
    for (const s of samples) {
      if (!pointInPolygon(s, poly)) return false;
      if (setback > 0 && distToBoundary(s, poly) < setback - 1e-6) return false;
    }
    // İçbükey köşe panelin içine girmesin.
    for (const v of poly) {
      if (v.x > x && v.x < x + across && v.y > y && v.y < y + depth) {
        return false;
      }
    }
    return true;
  };

  let best: Pt[][] = [];
  const steps = [0, 0.25, 0.5, 0.75];
  for (const fx of steps) {
    for (const fy of steps) {
      const rects: Pt[][] = [];
      for (let y = minY + fy * pitchY; y + depth <= maxY + 1e-9; y += pitchY) {
        for (
          let x = minX + fx * pitchX;
          x + across <= maxX + 1e-9;
          x += pitchX
        ) {
          if (fits(x, y)) {
            rects.push([
              { x, y },
              { x: x + across, y },
              { x: x + across, y: y + depth },
              { x, y: y + depth },
            ]);
          }
        }
      }
      if (rects.length > best.length) best = rects;
    }
  }
  const panelsLocal = best.map((rect) => rect.map((p) => rotate(p, angle)));
  return {
    faceId: face.id,
    count: best.length,
    areaM2,
    panels: panelsLocal.map((rect) => rect.map(back)),
    local: { roof: pts, panels: panelsLocal },
  };
}

export function layoutSite(site: SiteConfig) {
  const lat = site.lat ?? site.faces[0]?.points[0]?.[0] ?? 37;
  const faces = site.faces.map((face) =>
    layoutFace(face, site.panelLengthM, site.panelWidthM, lat),
  );
  return {
    faces,
    total: faces.reduce((sum, face) => sum + face.count, 0),
    areaM2: faces.reduce((sum, face) => sum + face.areaM2, 0),
  };
}

/** Yerleşimi tek bir SVG plan çizimine dönüştürür (teklif dosyası için).
 * Tüm yüzeyler ilk yüzeyin ilk noktasına göre ortak koordinatta çizilir. */
export function layoutSvg(site: SiteConfig, maxPanels?: number) {
  const origin = site.faces[0]?.points[0];
  if (!origin) return "";
  const lat = site.lat ?? origin[0];
  const shapes: { roof: Pt[]; panels: Pt[][] }[] = [];
  let remaining = maxPanels ?? Infinity;
  for (const face of site.faces) {
    const layout = layoutFace(face, site.panelLengthM, site.panelWidthM, lat);
    const { pts } = toLocal(face.points, origin);
    const panels = layout.panels
      .slice(0, Math.max(0, remaining))
      .map((rect) => toLocal(rect, origin).pts);
    remaining -= panels.length;
    shapes.push({ roof: pts, panels });
  }
  const all = shapes.flatMap((shape) => shape.roof);
  if (all.length === 0) return "";
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const pad = 1.5;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  // SVG'de y aşağı doğru artar; kuzey yukarıda kalsın diye ters çevrilir.
  const fmt = (p: Pt) =>
    `${(p.x - minX + pad).toFixed(2)},${(maxY - p.y + pad).toFixed(2)}`;
  const roofStroke = (Math.max(w, h) / 300).toFixed(3);
  const panelStroke = (Math.max(w, h) / 900).toFixed(3);
  // Önce tüm çatılar, sonra paneller: komşu yüzey panelleri örtmesin.
  const body =
    shapes
      .map(
        (shape) =>
          `<polygon points="${shape.roof.map(fmt).join(" ")}" fill="#dfe9ea" stroke="#5f7474" stroke-width="${roofStroke}"/>`,
      )
      .join("") +
    shapes
      .flatMap((shape) => shape.panels)
      .map(
        (rect) =>
          `<polygon points="${rect.map(fmt).join(" ")}" fill="#1f3b57" stroke="#9fb4c8" stroke-width="${panelStroke}"/>`,
      )
      .join("");
  const scaleLen = Math.max(1, Math.round(w / 5));
  const sw = Math.max(w, h) / 300;
  const scale = `<g stroke="#222" stroke-width="${sw.toFixed(3)}"><line x1="${pad}" y1="${(h - pad / 2).toFixed(2)}" x2="${(pad + scaleLen).toFixed(2)}" y2="${(h - pad / 2).toFixed(2)}"/></g><text x="${(pad + scaleLen + sw * 4).toFixed(2)}" y="${(h - pad / 2 + sw * 3).toFixed(2)}" font-size="${(Math.max(w, h) / 45).toFixed(2)}" fill="#222">${scaleLen} m</text>`;
  const north = `<text x="${(w - pad).toFixed(2)}" y="${(pad * 1.1).toFixed(2)}" font-size="${(Math.max(w, h) / 30).toFixed(2)}" text-anchor="end" fill="#222">K ↑</text>`;
  return `<svg viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}" xmlns="http://www.w3.org/2000/svg" font-family="Ubuntu,Arial,sans-serif">${body}${scale}${north}</svg>`;
}

// ---------------------------------------------------------------- PVGIS

export const PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc";

export type PvgisQuery = {
  lat: number;
  lon: number;
  tilt: number;
  azimuth: number;
  lossPct: number;
};

export function validPvgisQuery(q: Partial<PvgisQuery>): q is PvgisQuery {
  return (
    typeof q.lat === "number" &&
    typeof q.lon === "number" &&
    typeof q.tilt === "number" &&
    typeof q.azimuth === "number" &&
    typeof q.lossPct === "number" &&
    q.lat >= -60 &&
    q.lat <= 72 &&
    q.lon >= -180 &&
    q.lon <= 180 &&
    q.tilt >= 0 &&
    q.tilt <= 90 &&
    q.azimuth >= -180 &&
    q.azimuth <= 180 &&
    q.lossPct >= 0 &&
    q.lossPct <= 50
  );
}

export function pvgisRequestUrl(q: PvgisQuery, base = PVGIS_URL) {
  const params = new URLSearchParams({
    lat: q.lat.toFixed(5),
    lon: q.lon.toFixed(5),
    peakpower: "1",
    loss: String(q.lossPct),
    angle: String(q.tilt),
    aspect: String(q.azimuth),
    outputformat: "json",
  });
  return `${base}?${params.toString()}`;
}

/** PVGIS PVcalc JSON yanıtından 1 kWp için aylık ve yıllık üretim. */
export function parsePvgis(
  json: unknown,
  q: PvgisQuery,
  fetchedAt = new Date().toISOString(),
): PvgisResult | null {
  const data = json as {
    inputs?: { meteo_data?: { radiation_db?: string } };
    outputs?: {
      monthly?: { fixed?: { month: number; E_m: number }[] };
      totals?: { fixed?: { E_y?: number } };
    };
  };
  const monthly = data.outputs?.monthly?.fixed;
  if (!Array.isArray(monthly) || monthly.length !== 12) return null;
  const ordered = [...monthly].sort((a, b) => a.month - b.month);
  const monthlyPerKwp = ordered.map((m) => Math.round(Number(m.E_m) * 10) / 10);
  if (monthlyPerKwp.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const yearly = Number(data.outputs?.totals?.fixed?.E_y);
  return {
    ...q,
    kwhPerKwp: Math.round(
      Number.isFinite(yearly) && yearly > 0
        ? yearly
        : monthlyPerKwp.reduce((s, v) => s + v, 0),
    ),
    monthlyPerKwp,
    db: data.inputs?.meteo_data?.radiation_db ?? "PVGIS",
    fetchedAt,
  };
}

/** Yüzey sonuçlarını panel sayısına göre ağırlıklandırıp tek sonuç yapar. */
export function combinePvgis(
  parts: { result: PvgisResult; weight: number }[],
): PvgisResult | null {
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  if (parts.length === 0 || !(total > 0)) return null;
  const monthly = Array.from({ length: 12 }, (_, i) =>
    parts.reduce(
      (sum, part) => sum + (part.result.monthlyPerKwp[i] * part.weight) / total,
      0,
    ),
  ).map((v) => Math.round(v * 10) / 10);
  const first = parts[0].result;
  const weighted = (key: "tilt" | "azimuth") =>
    Math.round(
      parts.reduce((sum, part) => sum + part.result[key] * part.weight, 0) /
        total,
    );
  return {
    ...first,
    tilt: weighted("tilt"),
    azimuth: weighted("azimuth"),
    kwhPerKwp: Math.round(monthly.reduce((s, v) => s + v, 0)),
    monthlyPerKwp: monthly,
  };
}
