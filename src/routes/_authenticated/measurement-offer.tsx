import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Download,
  Eye,
  HardDriveUpload,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { formatTRY } from "@/lib/format";
import { htmlToPdf } from "@/lib/html-to-pdf";
import {
  calculateMeasurementOffer,
  defaultMeasurementOffer,
  measurementOfferFileName,
  measurementOfferHtml,
  type MeasurementOfferInput,
} from "@/lib/measurement-offer";
import { blobToBase64 } from "@/lib/send-channels";
import { AccessDenied, PageHeader } from "@/components/page-states";
import { SendDialog, type SendTarget } from "@/components/send/send-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

// Sahada (telefondan) ölçüm teklifi: EMO 2026 birim fiyatları ve iskonto ile
// anında hesap, iki sayfalık PDF (Teklif + Ek-1 Şartlar), Drive'a kayıt.
// Fiyat içerdiği için yalnız yönetici açar.

export const Route = createFileRoute("/_authenticated/measurement-offer")({
  component: MeasurementOfferPage,
});

const DRAFT_KEY = "nes-measurement-offer-draft";

function loadDraft(): MeasurementOfferInput {
  const fresh = defaultMeasurementOffer();
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as Partial<MeasurementOfferInput>;
    return { ...fresh, ...saved };
  } catch {
    return fresh;
  }
}

function MeasurementOfferPage() {
  const { role } = useAuth();
  const [form, setForm] = useState<MeasurementOfferInput>(() =>
    typeof window === "undefined" ? defaultMeasurementOffer() : loadDraft(),
  );
  const [busy, setBusy] = useState<"" | "pdf" | "drive" | "preview">("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [sendTarget, setSendTarget] = useState<SendTarget | null>(null);
  const [driveLink, setDriveLink] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      // Taslak saklanamazsa sayfa yine çalışır.
    }
  }, [form]);

  const result = useMemo(() => calculateMeasurementOffer(form), [form]);

  if (role && role !== "admin") return <AccessDenied />;

  const set = <K extends keyof MeasurementOfferInput>(
    key: K,
    value: MeasurementOfferInput[K],
  ) => {
    setDriveLink(null);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const fileName = measurementOfferFileName(form);
  const html = () => measurementOfferHtml(form, result, window.location.origin);

  function validate() {
    if (!form.customerName.trim()) {
      toast.error("Müşteri / firma adını yazın.");
      return false;
    }
    if (result.netTotal <= 0) {
      toast.error("En az bir ölçüm kalemi girin.");
      return false;
    }
    return true;
  }

  async function makePdf() {
    return htmlToPdf(html(), fileName);
  }

  async function downloadPdf() {
    if (!validate()) return;
    setBusy("pdf");
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
      setBusy("");
    }
  }

  async function saveToDrive() {
    if (!validate()) return;
    if (!navigator.onLine) {
      toast.error("Drive'a kaydetmek için internet gerekli.");
      return;
    }
    setBusy("drive");
    try {
      const file = await makePdf();
      const { data, error } = await supabase.functions.invoke<{
        url: string;
        folder: string;
        replaced: boolean;
      }>("nes-drive-upload", {
        body: {
          kind: "olcum_teklifi",
          file_name: file.name,
          content_base64: await blobToBase64(file),
        },
      });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => ({}));
          throw new Error(body.error ?? "Drive'a kaydedilemedi.");
        }
        throw error;
      }
      if (!data?.url) throw new Error("Drive'a kaydedilemedi.");
      setDriveLink(data.url);
      toast.success(
        data.replaced
          ? `Drive'daki dosya güncellendi (${data.folder})`
          : `Drive'a kaydedildi (${data.folder})`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  function openSend() {
    if (!validate()) return;
    setSendTarget({
      kind: "survey",
      title: `${form.offerNo} ölçüm teklifi`,
      subject: `Ölçüm ve raporlama fiyat teklifi: ${form.offerNo}`,
      message: [
        `Merhaba, ${form.customerName.trim()} için ölçüm ve periyodik kontrol raporlama teklifimiz ektedir.`,
        `Genel toplam (KDV dahil): ${formatTRY(result.grandTotal)}`,
        `Teklif ${form.validityDays} gün geçerlidir.`,
      ].join("\n"),
      makeFile: makePdf,
    });
  }

  function reset() {
    setDriveLink(null);
    setForm(defaultMeasurementOffer());
  }

  const visibleGroups = result.groups.filter((g) => g.net > 0);

  return (
    <div className="pb-44 lg:pb-8">
      <PageHeader
        title="Ölçüm teklifi"
        description="Keşifte doldurun; fiyat EMO 2026 birim fiyatları ve iskonto ile anında hesaplanır. PDF iki sayfadır: teklif ve şartlar."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/measurement-tracking">
                <ArrowLeft className="mr-2 h-4 w-4" /> Ölçüm takibi
              </Link>
            </Button>
            <Button variant="ghost" onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" /> Yeni teklif
            </Button>
          </div>
        }
      />

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
            <Field label="Tesis adresi">
              <Input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                className="h-11 text-base"
                placeholder="örn. Menteşe / Muğla"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
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

          <section className="surface-panel space-y-1 p-4">
            <h3 className="mb-2 font-bold">Saha bilgileri</h3>
            <Counter
              label="Kapalı alan"
              unit="m²"
              value={form.areaM2}
              step={50}
              onChange={(v) => set("areaM2", v)}
            />
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm">Yapı sınıfı</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((c) => (
                  <Button
                    key={c}
                    type="button"
                    size="sm"
                    variant={form.buildingClass === c ? "default" : "outline"}
                    className="h-10 w-10"
                    onClick={() => set("buildingClass", c)}
                  >
                    {c}
                  </Button>
                ))}
              </div>
            </div>
            <Counter
              label="AG topraklama ölçüm noktası"
              value={form.agPoints}
              onChange={(v) => set("agPoints", v)}
            />
            <Counter
              label="YG topraklama ölçüm noktası"
              value={form.ygPoints}
              onChange={(v) => set("ygPoints", v)}
            />
            <Counter
              label="Yıldırımdan korunma tesisatı"
              value={form.lightningCount}
              onChange={(v) => set("lightningCount", v)}
            />
            <Counter
              label="Kaçak akım rölesi (RCD) testi"
              value={form.rcdCount}
              onChange={(v) => set("rcdCount", v)}
            />
            <Counter
              label="Termal kamera ölçüm noktası"
              value={form.thermalCount}
              onChange={(v) => set("thermalCount", v)}
            />
            <Counter
              label="Yalıtım direnci ölçümü"
              value={form.insulationCount}
              onChange={(v) => set("insulationCount", v)}
            />
            <Counter
              label="Aydınlatma (lux) ölçüm noktası"
              value={form.luxCount}
              onChange={(v) => set("luxCount", v)}
            />
            <label className="flex items-center justify-between gap-3 py-2 text-sm">
              Keşif bedeli eklensin
              <Switch
                checked={form.includeSurvey}
                onCheckedChange={(v) => set("includeSurvey", v)}
              />
            </label>
          </section>

          <section className="surface-panel space-y-3 p-4">
            <h3 className="font-bold">Teklif koşulları</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="İskonto (%)">
                <Input
                  inputMode="decimal"
                  value={pctText(form.discount)}
                  onChange={(e) => set("discount", pctValue(e.target.value))}
                  className="h-11 text-base"
                />
              </Field>
              <Field label="KDV (%)">
                <Input
                  inputMode="decimal"
                  value={pctText(form.vatRate)}
                  onChange={(e) => set("vatRate", pctValue(e.target.value))}
                  className="h-11 text-base"
                />
              </Field>
              <Field label="Geçerlilik (gün)">
                <Input
                  inputMode="numeric"
                  value={String(form.validityDays)}
                  onChange={(e) =>
                    set("validityDays", intValue(e.target.value))
                  }
                  className="h-11 text-base"
                />
              </Field>
              <Field label="Rapor teslimi (iş günü)">
                <Input
                  inputMode="numeric"
                  value={String(form.reportDays)}
                  onChange={(e) => set("reportDays", intValue(e.target.value))}
                  className="h-11 text-base"
                />
              </Field>
            </div>
          </section>
        </div>

        <aside
          id="olcum-ozet"
          className="scroll-mt-24 space-y-4 lg:sticky lg:top-4 lg:self-start"
        >
          <section className="surface-panel space-y-3 p-4">
            <h3 className="font-bold">Teklif özeti</h3>
            {visibleGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Saha bilgilerini girdikçe kalemler burada görünür.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {visibleGroups.map((g) => (
                  <li key={g.group} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      {g.service}
                      <span className="block text-xs text-muted-foreground">
                        {g.scope}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatTRY(g.net)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <dl className="space-y-1 border-t border-border pt-3 text-sm">
              <Row label="EMO 2026 liste" value={formatTRY(result.listTotal)} />
              <Row
                label="İskonto"
                value={`-${formatTRY(result.discountAmount)}`}
              />
              <Row
                label="Toplam (KDV hariç)"
                value={formatTRY(result.netTotal)}
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
              <Actions
                busy={busy}
                driveLink={driveLink}
                onPreview={() => setPreviewHtml(html())}
                onPdf={() => void downloadPdf()}
                onDrive={() => void saveToDrive()}
                onSend={openSend}
              />
            </div>
          </section>
        </aside>
      </div>

      {/* Telefonda menü ve asistan düğmesinin üstünde sabit toplam; düğme
          özet ve çıktı bölümüne indirir. */}
      <div className="fixed bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] left-3 right-20 z-30 flex items-center justify-between gap-2 rounded-full border border-border bg-background/95 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur lg:hidden">
        <span className="min-w-0 leading-tight">
          <span className="block text-[11px] text-muted-foreground">
            Genel toplam (KDV dahil)
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
              .getElementById("olcum-ozet")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        >
          Çıktı al
        </Button>
      </div>

      <PreviewDialog html={previewHtml} onClose={() => setPreviewHtml(null)} />
      <SendDialog target={sendTarget} onClose={() => setSendTarget(null)} />
    </div>
  );
}

function Actions({
  busy,
  driveLink,
  onPreview,
  onPdf,
  onDrive,
  onSend,
}: {
  busy: string;
  driveLink: string | null;
  onPreview: () => void;
  onPdf: () => void;
  onDrive: () => void;
  onSend: () => void;
}) {
  const cls = "h-11";
  const icon = "mr-2 h-4 w-4";
  const spin = <LoaderCircle className={`${icon} animate-spin`} />;
  return (
    <>
      <Button variant="outline" className={cls} onClick={onPreview}>
        <Eye className={icon} /> Önizle
      </Button>
      <Button
        variant="outline"
        className={cls}
        onClick={onPdf}
        disabled={Boolean(busy)}
      >
        {busy === "pdf" ? spin : <Download className={icon} />} PDF
      </Button>
      {driveLink ? (
        <Button asChild variant="outline" className={cls}>
          <a href={driveLink} target="_blank" rel="noopener noreferrer">
            <HardDriveUpload className={icon} /> Drive&apos;da aç
          </a>
        </Button>
      ) : (
        <Button
          variant="outline"
          className={cls}
          onClick={onDrive}
          disabled={Boolean(busy)}
        >
          {busy === "drive" ? spin : <HardDriveUpload className={icon} />}{" "}
          Drive&apos;a kaydet
        </Button>
      )}
      <Button className={cls} onClick={onSend} disabled={Boolean(busy)}>
        <Send className={icon} /> Gönder
      </Button>
    </>
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
          <DialogTitle>Ölçüm teklifi önizleme</DialogTitle>
          <DialogDescription>
            İki sayfa: teklif ve Ek-1 şartlar.
          </DialogDescription>
        </DialogHeader>
        <iframe
          ref={frameRef}
          title="Ölçüm teklifi"
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

function Counter({
  label,
  unit,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="min-w-0 text-sm">
        {label}
        {unit ? <span className="text-muted-foreground"> ({unit})</span> : null}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10"
          aria-label={`${label} azalt`}
          onClick={() => onChange(Math.max(0, value - step))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          inputMode="numeric"
          aria-label={label}
          value={value ? String(value) : ""}
          placeholder="0"
          onChange={(e) => onChange(intValue(e.target.value))}
          className="h-10 w-16 text-center text-base tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10"
          aria-label={`${label} artır`}
          onClick={() => onChange(value + step)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function intValue(text: string) {
  const n = parseInt(text.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? Math.min(n, 1_000_000) : 0;
}

function pctText(rate: number) {
  return String(Math.round(rate * 1000) / 10).replace(".", ",");
}

function pctValue(text: string) {
  const n = Number(text.replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), 100) / 100;
}
