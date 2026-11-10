import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calculator,
  ClipboardList,
  Download,
  Eye,
  FileSpreadsheet,
  LoaderCircle,
  RotateCcw,
  Send,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { formatTRY } from "@/lib/format";
import { htmlToPdf } from "@/lib/html-to-pdf";
import { NES_COMPANY } from "@/lib/nes-company";
import {
  EXTRAS,
  GES_OPTIONS,
  GES_TIERS,
  GES_TIER_LABEL,
  KVA_BANDS,
  SITE_LABEL,
  SITE_TYPES,
  TIERS,
  TIER_LABEL,
  calculateMaintenanceOffer,
  optionAvailable,
  optionSale,
  defaultMaintenanceOffer,
  emptyPrices,
  gesUnitSale as gesSale,
  maintenanceOfferFileName,
  maintenanceOfferHtml,
  normalizePrices,
  type MaintenanceOfferInput,
  type GesTier,
  type MaintenancePrices,
  type Tier,
} from "@/lib/maintenance-offer";
import { AccessDenied, PageHeader } from "@/components/page-states";
import { SendDialog, type SendTarget } from "@/components/send/send-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

// Bakım paketleri teklifi:
//  - GES bakımı: Standart / Premium / Premium Plus; çatı veya arazi, kWp başına.
//    Fiyat = taşeron maliyeti × (1 + NES kârı) ya da elle girilen müşteri fiyatı.
//  - Trafo merkezi bakımı (Temel / Standart / Premium), ayrı kalem elektrik
//    işletme sorumluluğu ve ek hizmetler.
// Çıktılar: müşteri PDF'i (teklif + Ek-1 şartname + Ek-2 sözleşme), müşteri
// Excel'i, iç maliyet Excel'i ve taşeron fiyat talebi. İç maliyet müşteri
// dosyalarına hiç girmez. Finansal veri: yalnız yönetici.

export const Route = createFileRoute("/_authenticated/maintenance-offer")({
  component: MaintenanceOfferPage,
});

const DRAFT_KEY = "nes-maintenance-offer-draft";
const PRICES_KEY = ["maintenance-price-list"];

function loadDraft(): MaintenanceOfferInput {
  const fresh = defaultMaintenanceOffer();
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as Partial<MaintenanceOfferInput>;
    return {
      ...fresh,
      ...saved,
      // Yeni taslakta teklif no ve tarih güncel kalsın.
      offerNo: saved.offerNo || fresh.offerNo,
      ges: {
        ...fresh.ges,
        ...saved.ges,
        // Eski taslaklar (Temel/Standart/Premium) yeni paketlere uyarlanır.
        tier: GES_TIERS.includes(saved.ges?.tier as GesTier)
          ? (saved.ges?.tier as GesTier)
          : fresh.ges.tier,
        site: SITE_TYPES.includes(saved.ges?.site as "cati")
          ? saved.ges!.site
          : fresh.ges.site,
        options: { ...fresh.ges.options, ...saved.ges?.options },
      },
      trafo: { ...fresh.trafo, ...saved.trafo },
      extras: { ...fresh.extras, ...saved.extras },
    };
  } catch {
    return fresh;
  }
}

function MaintenanceOfferPage() {
  const { role } = useAuth();
  const [form, setForm] = useState<MaintenanceOfferInput>(() =>
    typeof window === "undefined" ? defaultMaintenanceOffer() : loadDraft(),
  );
  const [busy, setBusy] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [sendTarget, setSendTarget] = useState<SendTarget | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);

  const pricesQuery = useQuery({
    queryKey: PRICES_KEY,
    enabled: role === "admin",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_price_list")
        .select("prices, updated_at")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return {
        prices: normalizePrices(data?.prices),
        updatedAt: data?.updated_at ?? null,
      };
    },
  });
  const prices = pricesQuery.data?.prices ?? emptyPrices();
  const pricesEmpty = useMemo(() => isEmptyPriceList(prices), [prices]);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      // Taslak saklanamazsa sayfa yine çalışır.
    }
  }, [form]);

  const result = useMemo(
    () => calculateMaintenanceOffer(form, prices),
    [form, prices],
  );

  if (role && role !== "admin") return <AccessDenied />;

  const set = <K extends keyof MaintenanceOfferInput>(
    key: K,
    value: MaintenanceOfferInput[K],
  ) => setForm((f) => ({ ...f, [key]: value }));
  const setGes = (patch: Partial<MaintenanceOfferInput["ges"]>) =>
    setForm((f) => ({ ...f, ges: { ...f.ges, ...patch } }));
  const setTrafo = (patch: Partial<MaintenanceOfferInput["trafo"]>) =>
    setForm((f) => ({ ...f, trafo: { ...f.trafo, ...patch } }));

  const fileName = maintenanceOfferFileName(form);
  const html = () =>
    maintenanceOfferHtml(form, prices, result, window.location.origin);

  function validate() {
    if (!form.customerName.trim()) {
      toast.error("Müşteri / firma adını yazın.");
      return false;
    }
    if (!form.ges.enabled && !form.trafo.enabled && !form.isEnabled) {
      toast.error("En az bir hizmet seçin.");
      return false;
    }
    if (form.ges.enabled && form.ges.kwp <= 0) {
      toast.error("GES kurulu gücünü (kWp) girin.");
      return false;
    }
    if ((form.trafo.enabled || form.isEnabled) && result.isKva <= 0) {
      toast.error("Trafo gücünü (kVA) girin.");
      return false;
    }
    if (result.net <= 0) {
      toast.error("Fiyat listesi boş görünüyor. Önce fiyatları girin.");
      setPriceOpen(true);
      return false;
    }
    return true;
  }

  const makePdf = () => htmlToPdf(html(), fileName);

  function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function downloadInternal(kind: "cost" | "subcontractor") {
    if (kind === "subcontractor" && (!form.ges.enabled || form.ges.kwp <= 0)) {
      toast.error("Taşeron talebi için GES bakımını açıp kWp girin.");
      return;
    }
    setBusy(true);
    try {
      const mod = await import("@/lib/maintenance-offer-excel");
      const base = fileName.replace(/_Bakim_Teklifi\.pdf$/i, "");
      if (kind === "cost") {
        const blob = await mod.buildMaintenanceCostWorkbook({
          form,
          prices,
          result,
          logoUrl: NES_COMPANY.logoPath,
        });
        saveBlob(blob, `${base}_IC_MALIYET.xlsx`);
      } else {
        const blob = await mod.buildSubcontractorRequestWorkbook({
          form,
          prices,
          logoUrl: NES_COMPANY.logoPath,
        });
        saveBlob(blob, `${form.offerNo}-T_Taseron_Fiyat_Talebi.xlsx`);
      }
    } catch (e) {
      toast.error(errorMessage(e) || "Excel hazırlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadExcel() {
    if (!validate()) return;
    setBusy(true);
    try {
      const { buildMaintenanceOfferWorkbook } =
        await import("@/lib/maintenance-offer-excel");
      const blob = await buildMaintenanceOfferWorkbook({
        form,
        prices,
        result,
        logoUrl: NES_COMPANY.logoPath,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, ".xlsx");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      toast.error(errorMessage(e) || "Excel hazırlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    if (!validate()) return;
    setBusy(true);
    try {
      const file = await makePdf();
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF hazırlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  function openSend() {
    if (!validate()) return;
    setSendTarget({
      kind: "offer",
      title: `${form.offerNo} bakım teklifi`,
      subject: `Bakım paketleri fiyat teklifi: ${form.offerNo}`,
      message: [
        `Merhaba, ${form.customerName.trim()} için bakım paketleri teklifimiz ektedir.`,
        `Yıllık toplam (KDV dahil): ${formatTRY(result.grandTotal)}`,
        `Teklif ${form.validityDays} gün geçerlidir.`,
      ].join("\n"),
      makeFile: makePdf,
    });
  }

  return (
    <div className="pb-44 lg:pb-8">
      <PageHeader
        title="Bakım Paketleri"
        description="GES bakımı (Standart / Premium / Premium Plus, çatı veya arazi), trafo merkezi bakımı ve ayrı kalem işletme sorumluluğu. Fiyatlar taşeron maliyeti ve kâr oranından hesaplanır; teklif, teknik şartname ve sözleşme tek çıktıda."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPriceOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" /> Fiyat listesi
            </Button>
            <Button
              variant="ghost"
              onClick={() => setForm(defaultMaintenanceOffer())}
            >
              <RotateCcw className="mr-2 h-4 w-4" /> Yeni teklif
            </Button>
          </div>
        }
      />

      {pricesEmpty && !pricesQuery.isLoading ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <span>
            Fiyat listesi henüz girilmedi. Paket fiyatlarını bir kez girin;
            sonraki tekliflerde otomatik kullanılır.
          </span>
          <Button size="sm" onClick={() => setPriceOpen(true)}>
            Fiyatları gir
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <section className="surface-panel space-y-3 p-4">
            <h3 className="font-bold">Müşteri</h3>
            <Field label="Müşteri / firma">
              <Input
                value={form.customerName}
                onChange={(e) => set("customerName", e.target.value)}
                className="h-11 text-base"
                autoComplete="organization"
              />
            </Field>
            <Field label="Tesis adı ve adresi">
              <Input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                className="h-11 text-base"
                placeholder="örn. Yatağan GES-2, Turgutlu mevkii, Yatağan / Muğla"
              />
            </Field>
            <Field label="Taşeron talebinde görünecek konum (müşteri adı olmadan)">
              <Input
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                className="h-11 text-base"
                placeholder="örn. Muğla / Yatağan"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Yetkili kişi">
                <Input
                  value={form.contactPerson}
                  onChange={(e) => set("contactPerson", e.target.value)}
                  className="h-11 text-base"
                />
              </Field>
              <Field label="Telefon / e-posta">
                <Input
                  value={form.contactInfo}
                  onChange={(e) => set("contactInfo", e.target.value)}
                  className="h-11 text-base"
                />
              </Field>
              <Field label="Teklif no">
                <Input
                  value={form.offerNo}
                  onChange={(e) => set("offerNo", e.target.value)}
                  className="h-11 text-base"
                />
              </Field>
              <Field label="Teklif tarihi">
                <Input
                  type="date"
                  value={form.offerDate}
                  onChange={(e) => set("offerDate", e.target.value)}
                  className="h-11 text-base"
                />
              </Field>
            </div>
          </section>

          <ServiceSection
            title="GES bakımı"
            enabled={form.ges.enabled}
            onToggle={(v) => setGes({ enabled: v })}
          >
            <div className="grid grid-cols-2 gap-2">
              {SITE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={form.ges.site === t}
                  onClick={() => setGes({ site: t })}
                  className={`h-11 rounded-xl border text-sm font-semibold transition-colors ${
                    form.ges.site === t
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {SITE_LABEL[t]} GES
                </button>
              ))}
            </div>
            <TierPicker
              tiers={GES_TIERS}
              labels={GES_TIER_LABEL}
              value={form.ges.tier}
              onChange={(t) => setGes({ tier: t })}
              amounts={
                Object.fromEntries(
                  GES_TIERS.map((t) => [t, result.ges[t].yearly]),
                ) as Record<GesTier, number>
              }
            />
            <div className="grid grid-cols-3 gap-3">
              <Field label="Kurulu güç (kWp)">
                <NumInput
                  value={form.ges.kwp}
                  onChange={(v) => setGes({ kwp: v })}
                />
              </Field>
              <Field label="İnverter adedi">
                <NumInput
                  value={form.ges.inverters}
                  onChange={(v) => setGes({ inverters: v })}
                />
              </Field>
              <Field label="Panel adedi">
                <NumInput
                  value={form.ges.panels}
                  onChange={(v) => setGes({ panels: v })}
                />
              </Field>
            </div>
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-sm font-semibold">Opsiyonel hizmetler</p>
              {GES_OPTIONS.map((o) => {
                const available = optionAvailable(o.key, form.ges.tier);
                return (
                  <div
                    key={o.key}
                    className="flex items-center justify-between gap-3 py-1"
                  >
                    <span className="min-w-0 text-sm">
                      {o.label}
                      <span className="block text-xs text-muted-foreground">
                        {available
                          ? `${formatTRY(optionSale(prices, o.key))} / ${o.unit}`
                          : "Premium Plus pakete dahil"}
                      </span>
                    </span>
                    {available ? (
                      <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {o.qtyLabel}
                        <NumInput
                          className="w-20"
                          value={form.ges.options[o.key]}
                          aria-label={`${o.label} miktarı`}
                          onChange={(v) =>
                            setGes({
                              options: { ...form.ges.options, [o.key]: v },
                            })
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </ServiceSection>

          <ServiceSection
            title="Trafo merkezi bakımı"
            enabled={form.trafo.enabled}
            onToggle={(v) => setTrafo({ enabled: v })}
          >
            <TierPicker
              tiers={TIERS}
              labels={TIER_LABEL}
              value={form.trafo.tier}
              onChange={(t) => setTrafo({ tier: t })}
              amounts={result.trafoTiers}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Trafo gücü (kVA)">
                <NumInput
                  value={form.trafo.kva}
                  onChange={(v) => setTrafo({ kva: v })}
                />
              </Field>
              <Field label="Adet">
                <NumInput
                  value={form.trafo.count}
                  onChange={(v) => setTrafo({ count: Math.max(1, v) })}
                />
              </Field>
              <Field label="Gerilim">
                <Input
                  value={form.trafo.voltage}
                  onChange={(e) => setTrafo({ voltage: e.target.value })}
                  className="h-11 text-base"
                />
              </Field>
              <Field label="Tip">
                <Input
                  value={form.trafo.kind}
                  onChange={(e) => setTrafo({ kind: e.target.value })}
                  className="h-11 text-base"
                />
              </Field>
            </div>
          </ServiceSection>

          <ServiceSection
            title="Elektrik işletme sorumluluğu (ayrı kalem)"
            enabled={form.isEnabled}
            onToggle={(v) => set("isEnabled", v)}
          >
            <Field label="Kurulu trafo gücü (kVA) · boşsa trafo bilgisinden alınır">
              <NumInput value={form.isKva} onChange={(v) => set("isKva", v)} />
            </Field>
            <p className="text-sm text-muted-foreground">
              Kademe: {KVA_BANDS[result.isBand].label} ·{" "}
              {formatTRY(result.isMonthly)} / ay
              {result.isDiscountApplied
                ? ` (paket indirimi %${Math.round(result.isDiscountApplied * 1000) / 10} uygulandı)`
                : ""}
            </p>
          </ServiceSection>

          <section className="surface-panel space-y-1 p-4">
            <h3 className="mb-2 font-bold">Trafo / genel ek hizmetler</h3>
            {EXTRAS.map((x) => (
              <div
                key={x.key}
                className="flex items-center justify-between gap-3 py-1"
              >
                <span className="min-w-0 text-sm">
                  {x.label}
                  <span className="block text-xs text-muted-foreground">
                    {formatTRY(prices.extras[x.key])} / {x.unit}
                  </span>
                </span>
                <NumInput
                  className="w-24"
                  value={form.extras[x.key]}
                  aria-label={`${x.label} miktarı`}
                  onChange={(v) =>
                    set("extras", { ...form.extras, [x.key]: v })
                  }
                />
              </div>
            ))}
          </section>

          <section className="surface-panel space-y-3 p-4">
            <h3 className="font-bold">Teklif koşulları</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="İskonto (%)">
                <PctInput
                  value={form.discount}
                  onChange={(v) => set("discount", v)}
                />
              </Field>
              <Field label="KDV (%)">
                <PctInput
                  value={form.vatRate}
                  onChange={(v) => set("vatRate", v)}
                />
              </Field>
              <Field label="Geçerlilik (gün)">
                <NumInput
                  value={form.validityDays}
                  onChange={(v) => set("validityDays", v)}
                />
              </Field>
              <Field label="Ödeme">
                <Input
                  value={form.payment}
                  onChange={(e) => set("payment", e.target.value)}
                  className="h-11 text-base"
                />
              </Field>
            </div>
          </section>
        </div>

        <aside
          id="bakim-ozet"
          className="scroll-mt-24 space-y-4 lg:sticky lg:top-4 lg:self-start"
        >
          <section className="surface-panel space-y-3 p-4">
            <h3 className="font-bold">Teklif özeti</h3>
            {result.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Hizmet seçip tesis bilgisini girdikçe kalemler burada görünür.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {result.lines.map((l) => (
                  <li key={l.key} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      {l.label}
                      <span className="block text-xs text-muted-foreground">
                        {l.detail}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatTRY(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <dl className="space-y-1 border-t border-border pt-3 text-sm">
              {result.discountAmount > 0 ? (
                <Row
                  label="İskonto"
                  value={`-${formatTRY(result.discountAmount)}`}
                />
              ) : null}
              <Row
                label="Yıllık toplam (KDV hariç)"
                value={formatTRY(result.net)}
                strong
              />
              <Row label="KDV" value={formatTRY(result.vat)} />
              <Row
                label="Genel toplam"
                value={formatTRY(result.grandTotal)}
                strong
              />
            </dl>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              <Button
                variant="outline"
                className="h-11"
                onClick={() => setPreviewHtml(html())}
              >
                <Eye className="mr-2 h-4 w-4" /> Önizle
              </Button>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => void downloadPdf()}
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                PDF
              </Button>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => void downloadExcel()}
                disabled={busy}
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
              </Button>
              <Button className="h-11" onClick={openSend} disabled={busy}>
                <Send className="mr-2 h-4 w-4" /> Gönder
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              PDF ve Excel müşteriye gider: teklif, Ek-1 teknik şartname ve Ek-2
              sözleşme. İç maliyet bunlarda yer almaz.
            </p>
          </section>

          <section className="surface-panel space-y-3 border-destructive/30 p-4">
            <h3 className="font-bold">
              İç maliyet{" "}
              <span className="text-xs font-normal text-destructive">
                müşteriye gitmez
              </span>
            </h3>
            {form.ges.enabled ? (
              <ul className="space-y-1.5 text-sm">
                {GES_TIERS.map((t) => {
                  const g = result.ges[t];
                  const profit = g.yearly - g.yearlyCost;
                  return (
                    <li
                      key={t}
                      className={`flex justify-between gap-2 ${t === form.ges.tier ? "font-semibold" : "text-muted-foreground"}`}
                    >
                      <span>{GES_TIER_LABEL[t]}</span>
                      <span className="tabular-nums">
                        {formatTRY(g.yearlyCost)} → {formatTRY(g.yearly)}
                        {g.yearly > 0
                          ? ` · %${Math.round((profit / g.yearly) * 100)}`
                          : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <dl className="space-y-1 border-t border-border pt-2 text-sm">
              <Row
                label="Taşeron maliyeti (bilinen)"
                value={formatTRY(result.knownCost)}
              />
              <Row
                label="Brüt kâr"
                value={formatTRY(result.knownSale - result.knownCost)}
                strong
              />
            </dl>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              <Button
                variant="outline"
                className="h-11"
                onClick={() => void downloadInternal("cost")}
                disabled={busy}
              >
                <Calculator className="mr-2 h-4 w-4" /> İç maliyet Excel
              </Button>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => void downloadInternal("subcontractor")}
                disabled={busy}
              >
                <ClipboardList className="mr-2 h-4 w-4" /> Taşeron talebi
              </Button>
            </div>
          </section>
        </aside>
      </div>

      <div className="fixed bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] left-3 right-20 z-30 flex items-center justify-between gap-2 rounded-full border border-border bg-background/95 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur lg:hidden">
        <span className="min-w-0 leading-tight">
          <span className="block text-[11px] text-muted-foreground">
            Yıllık genel toplam (KDV dahil)
          </span>
          <span className="block font-bold tabular-nums">
            {formatTRY(result.grandTotal)}
          </span>
        </span>
        <Button
          size="sm"
          className="h-10 shrink-0 rounded-full"
          onClick={() =>
            document
              .getElementById("bakim-ozet")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        >
          Çıktı al
        </Button>
      </div>

      <PriceListDialog
        open={priceOpen}
        initial={prices}
        updatedAt={pricesQuery.data?.updatedAt ?? null}
        onClose={() => setPriceOpen(false)}
      />
      <PreviewDialog html={previewHtml} onClose={() => setPreviewHtml(null)} />
      <SendDialog target={sendTarget} onClose={() => setSendTarget(null)} />
    </div>
  );
}

function isEmptyPriceList(p: MaintenancePrices) {
  const values = [
    ...GES_TIERS.flatMap((t) => [
      p.ges[t].costRoof,
      p.ges[t].costLand,
      p.ges[t].saleRoof,
      p.ges[t].saleLand,
      p.ges[t].min,
    ]),
    ...TIERS.flatMap((t) => p.trafo[t]),
    ...p.isMonthly,
  ];
  return values.every((v) => v === 0);
}

// ------------------------------------------------------------ fiyat listesi

function PriceListDialog({
  open,
  initial,
  updatedAt,
  onClose,
}: {
  open: boolean;
  initial: MaintenancePrices;
  updatedAt: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<MaintenancePrices>(initial);
  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  const save = useMutation({
    mutationFn: async (prices: MaintenancePrices) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("maintenance_price_list").upsert({
        id: 1,
        prices: prices as unknown as Json,
        updated_at: new Date().toISOString(),
        updated_by: auth.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: PRICES_KEY });
      toast.success("Fiyat listesi kaydedildi.");
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const GES_KEYS = [
    "costRoof",
    "costLand",
    "margin",
    "saleRoof",
    "saleLand",
    "min",
    "visits",
  ] as const;
  const setGes = (t: GesTier, key: (typeof GES_KEYS)[number], v: number) =>
    setDraft((d) => ({
      ...d,
      ges: { ...d.ges, [t]: { ...d.ges[t], [key]: v } },
    }));
  const setTrafo = (t: Tier, i: number, v: number) =>
    setDraft((d) => ({
      ...d,
      trafo: { ...d.trafo, [t]: d.trafo[t].map((x, j) => (j === i ? v : x)) },
    }));

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bakım paketleri fiyat listesi</DialogTitle>
          <DialogDescription>
            Tutarlar KDV hariç. Bir kez girin; tüm tekliflerde kullanılır.
            {updatedAt
              ? ` Son güncelleme: ${new Date(updatedAt).toLocaleString("tr-TR")}.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <PriceBlock
            title="GES bakımı (₺ / kWp / yıl, KDV hariç)"
            hint="Müşteri fiyatı = taşeron fiyatı × (1 + kâr). Elle fiyat girerseniz o kullanılır. Yıllık bedel asgari bedelin altına düşmez."
          >
            <PriceGrid
              cols={[
                "Taşeron çatı",
                "Taşeron arazi",
                "Kâr %",
                "Elle müşteri çatı",
                "Elle müşteri arazi",
                "Asgari ₺ / yıl",
                "Ziyaret / yıl",
              ]}
              rows={GES_TIERS.map((t) => ({
                label: GES_TIER_LABEL[t],
                values: [
                  draft.ges[t].costRoof,
                  draft.ges[t].costLand,
                  draft.ges[t].margin * 100,
                  draft.ges[t].saleRoof,
                  draft.ges[t].saleLand,
                  draft.ges[t].min,
                  draft.ges[t].visits,
                ],
                onChange: (i, v) =>
                  setGes(t, GES_KEYS[i], i === 2 ? Math.min(v, 1000) / 100 : v),
              }))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Müşteri fiyatı şu an:{" "}
              {GES_TIERS.map(
                (t) =>
                  `${GES_TIER_LABEL[t]} çatı ${formatTRY(gesSale(draft, t, "cati"))} · arazi ${formatTRY(gesSale(draft, t, "arazi"))}`,
              ).join("  |  ")}
            </p>
          </PriceBlock>

          <PriceBlock
            title="GES opsiyonel hizmetler"
            hint="Müşteri fiyatı = taşeron fiyatı × (1 + kâr); elle fiyat girilirse o kullanılır."
          >
            <PriceGrid
              cols={["Taşeron fiyatı", "Kâr %", "Elle müşteri fiyatı"]}
              rows={GES_OPTIONS.map((o) => ({
                label: `${o.label} (${o.unit})`,
                values: [
                  draft.gesOptions[o.key].cost,
                  draft.gesOptions[o.key].margin * 100,
                  draft.gesOptions[o.key].sale,
                ],
                onChange: (i, v) =>
                  setDraft((d) => ({
                    ...d,
                    gesOptions: {
                      ...d.gesOptions,
                      [o.key]: {
                        ...d.gesOptions[o.key],
                        [["cost", "margin", "sale"][i]]:
                          i === 1 ? Math.min(v, 1000) / 100 : v,
                      },
                    },
                  })),
              }))}
            />
          </PriceBlock>

          <PriceBlock
            title="Trafo merkezi bakımı"
            hint="Trafo başına yıllık bedel, kVA kademesine göre. Teklifte adet ile çarpılır."
          >
            <PriceGrid
              cols={KVA_BANDS.map((b) => b.label)}
              rows={TIERS.map((t) => ({
                label: TIER_LABEL[t],
                values: draft.trafo[t],
                onChange: (i, v) => setTrafo(t, i, v),
              }))}
            />
          </PriceBlock>

          <PriceBlock
            title="Elektrik işletme sorumluluğu"
            hint="Aylık bedel, kurulu trafo gücüne göre. EMO en az ücretinin altında olamaz."
          >
            <PriceGrid
              cols={KVA_BANDS.map((b) => b.label)}
              rows={[
                {
                  label: "₺ / ay",
                  values: draft.isMonthly,
                  onChange: (i, v) =>
                    setDraft((d) => ({
                      ...d,
                      isMonthly: d.isMonthly.map((x, j) => (j === i ? v : x)),
                    })),
                },
              ]}
            />
            <label className="mt-2 flex items-center justify-between gap-3 text-sm">
              Bakım paketiyle birlikte alınırsa indirim (%)
              <PctInput
                className="w-24"
                value={draft.isBundleDiscount}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, isBundleDiscount: v }))
                }
              />
            </label>
          </PriceBlock>

          <PriceBlock title="Trafo / genel ek hizmetler (müşteri birim fiyatı)">
            <div className="space-y-1">
              {EXTRAS.map((x) => (
                <label
                  key={x.key}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0">
                    {x.label}
                    <span className="text-muted-foreground"> / {x.unit}</span>
                  </span>
                  <MoneyInput
                    className="w-32"
                    value={draft.extras[x.key]}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        extras: { ...d.extras, [x.key]: v },
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </PriceBlock>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
            {save.isPending ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriceBlock({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="font-semibold">{title}</h4>
      {hint ? (
        <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {children}
    </section>
  );
}

function PriceGrid({
  cols,
  rows,
}: {
  cols: string[];
  rows: {
    label: string;
    values: number[];
    onChange: (index: number, value: number) => void;
  }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr>
            <th className="w-28" />
            {cols.map((c) => (
              <th
                key={c}
                className="px-1 pb-1 text-left text-xs font-medium text-muted-foreground"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-1 pr-2 text-xs font-medium sm:text-sm">
                {r.label}
              </td>
              {r.values.map((v, i) => (
                <td key={i} className="px-1 py-1">
                  <MoneyInput
                    value={v}
                    aria-label={`${r.label} ${cols[i]}`}
                    onChange={(n) => r.onChange(i, n)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------ küçük parçalar

function ServiceSection({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-panel space-y-3 p-4">
      <label className="flex items-center justify-between gap-3">
        <h3 className="font-bold">{title}</h3>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </label>
      {enabled ? children : null}
    </section>
  );
}

function TierPicker<T extends string>({
  tiers,
  labels,
  value,
  onChange,
  amounts,
}: {
  tiers: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (tier: T) => void;
  amounts: Record<T, number>;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiers.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          aria-pressed={value === t}
          className={`rounded-xl border p-2 text-left transition-colors ${
            value === t
              ? "border-primary bg-primary/10"
              : "border-border hover:bg-muted"
          }`}
        >
          <span className="block text-sm font-semibold">{labels[t]}</span>
          <span className="block text-xs tabular-nums text-muted-foreground">
            {amounts[t] > 0 ? `${formatTRY(amounts[t])} / yıl` : "—"}
          </span>
        </button>
      ))}
    </div>
  );
}

function PreviewDialog({
  html,
  onClose,
}: {
  html: string | null;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  return (
    <Dialog open={!!html} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Bakım teklifi önizleme</DialogTitle>
          <DialogDescription>
            Kapak, paketler, fiyat özeti, Ek-1 teknik şartname ve Ek-2 sözleşme.
          </DialogDescription>
        </DialogHeader>
        <iframe
          ref={frameRef}
          title="Bakım teklifi"
          srcDoc={html ?? ""}
          sandbox=""
          className="h-[70vh] w-full rounded-xl border border-border bg-[#e6eaeb]"
        />
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? "font-semibold" : "text-muted-foreground"}>
        {label}
      </dt>
      <dd className={`tabular-nums ${strong ? "font-bold" : ""}`}>{value}</dd>
    </div>
  );
}

function parseNumber(text: string) {
  const n = Number(
    text
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.]/g, ""),
  );
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1_000_000_000) : 0;
}

/** Sayı alanı: yazarken metni korur (virgüllü ondalık), dışarı sayı verir. */
function NumberField({
  value,
  onChange,
  format,
  className = "",
  ...rest
}: {
  value: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  className?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(() => (value ? format(value) : ""));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value ? format(value) : "");
  }, [value, focused, format]);
  return (
    <Input
      {...rest}
      inputMode="decimal"
      value={text}
      placeholder="0"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseNumber(e.target.value));
      }}
      className={`h-11 text-base tabular-nums ${className}`}
    />
  );
}

const plain = (n: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n);

function NumInput(props: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return <NumberField {...props} format={plain} />;
}

function MoneyInput(props: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return <NumberField {...props} format={plain} />;
}

function PctInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <NumberField
      className={className}
      value={value * 100}
      format={plain}
      onChange={(v) => onChange(Math.min(v, 100) / 100)}
    />
  );
}
