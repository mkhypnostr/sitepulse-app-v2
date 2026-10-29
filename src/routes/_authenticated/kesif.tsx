import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FEATURES } from "@/lib/features";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  CloudOff,
  CloudUpload,
  FileText,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Mic,
  MicOff,
  Circle,
  Square,
  Plus,
  Printer,
  Search,
  Send,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { requestPersistentStorage } from "@/lib/offline-db";
import { registerServiceWorker } from "@/lib/push";
import {
  addAudio,
  addPhoto,
  audioUrl,
  removeAudio,
  type SurveyAudioMeta,
  cachedCatalog,
  cachedCustomers,
  deleteLocal,
  getLocal,
  isDirty,
  listLocal,
  newSurvey,
  photoDataUrl,
  photoUrl,
  pullSurveys,
  pushSurvey,
  refreshReferenceCache,
  removePhoto,
  saveLocal,
  surveyUnits,
  syncAll,
  workTypeLabels,
  type CachedCatalogItem,
  type CachedCustomer,
  type Survey,
  type SurveyItem,
  type SurveyPhotoMeta,
  type WorkType,
} from "@/lib/site-survey";
import { surveySheetHtml } from "@/lib/site-survey-document";
import { htmlToPdf } from "@/lib/html-to-pdf";
import { SendDialog, type SendTarget } from "@/components/send/send-dialog";
import { AccessDenied, EmptyState, PageHeader } from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Keşif: sahada (internet olmasa da) tablette doldurulur. Kayıt cihazda
// tutulur, internet gelince kendiliğinden gönderilir. Yönetici
// "Teklifleştir" ile teklif hazırlayıcıya aktarır.
export const Route = createFileRoute("/_authenticated/kesif")({
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search.id === "string" && search.id ? { id: search.id } : {},
  component: KesifPage,
});

const NONE = "__none__";
const dateTr = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function useOnline() {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function KesifPage() {
  const { role } = useAuth();
  const allowed = role === "admin" || role === "technical_office";
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const online = useOnline();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<"idle" | "sending">("idle");

  const reload = useCallback(async () => {
    const list = await listLocal();
    list.sort((a, b) => b.surveyed_at.localeCompare(a.surveyed_at));
    setSurveys(list);
    setLoading(false);
  }, []);

  const sync = useCallback(
    // auto: her değişiklikten sonra sessiz gönderim (durum kartta görünür);
    // manual: "Gönder / yenile" düğmesi; reconnect: internet geri geldi.
    async (mode: "auto" | "manual" | "reconnect" = "auto") => {
      const manual = mode === "manual";
      if (!navigator.onLine) {
        if (manual) toast.message("İnternet yok; kayıtlar cihazda bekliyor.");
        return;
      }
      setSyncState("sending");
      try {
        const { sent, failed } = await syncAll();
        await pullSurveys().catch(() => undefined);
        await refreshReferenceCache().catch(() => undefined);
        if (manual)
          toast.success(
            sent > 0
              ? `${sent} keşif gönderildi.`
              : "Her şey gönderilmiş durumda.",
          );
        else if (mode === "reconnect" && sent > 0)
          toast.success(`İnternet geldi: ${sent} keşif gönderildi.`);
        if (failed > 0 && mode !== "auto")
          toast.error(`${failed} keşif gönderilemedi; tekrar denenecek.`);
      } finally {
        setSyncState("idle");
        await reload();
      }
    },
    [reload],
  );

  // Çevrimdışı kullanım için hazırlık + ilk eşitleme.
  useEffect(() => {
    if (!allowed) return;
    void registerServiceWorker();
    void requestPersistentStorage();
    void reload().then(() => sync());
  }, [allowed, reload, sync]);

  // İnternet geri gelince bekleyenleri gönder.
  const wasOffline = useRef(false);
  useEffect(() => {
    // Yalnız çevrimdışından çevrimiçine geçişte (ilk açılışta değil).
    if (online && allowed && wasOffline.current) void sync("reconnect");
    wasOffline.current = !online;
  }, [online, allowed, sync]);

  if (!allowed) return <AccessDenied />;

  if (id) {
    return (
      <SurveyEditor
        key={id}
        id={id}
        online={online}
        isAdmin={role === "admin"}
        onBack={async () => {
          await reload();
          navigate({ to: "/kesif", search: {} });
        }}
        onChanged={() => {
          void reload();
        }}
        onSync={() => sync()}
      />
    );
  }

  const pending = surveys.filter(isDirty).length;

  return (
    <>
      <PageHeader
        title="Keşif"
        description="Sahada fotoğraf, ölçü, malzeme ve not girin. İnternet yoksa tablette saklanır, internet gelince kendiliğinden gönderilir."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OnlineBadge online={online} />
            <Button
              variant="outline"
              className="h-11"
              disabled={syncState === "sending"}
              onClick={() => sync("manual")}
            >
              {syncState === "sending" ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CloudUpload className="mr-2 h-4 w-4" />
              )}
              Gönder / yenile
            </Button>
            <Button
              className="h-11 font-bold"
              onClick={async () => {
                const s = await saveLocal(newSurvey());
                navigate({ to: "/kesif", search: { id: s.id } });
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Yeni keşif
            </Button>
          </div>
        }
      />
      {pending > 0 ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <CloudOff className="h-4 w-4 shrink-0" />
          {pending} keşif henüz gönderilmedi.{" "}
          {online ? "Gönderiliyor..." : "İnternet gelince gönderilecek."}
        </div>
      ) : null}
      {loading ? null : surveys.length === 0 ? (
        <EmptyState
          title="Henüz keşif yok"
          description="Sahaya çıkmadan önce bu sayfayı internet varken bir kez açın; böylece internetsiz yerde de açılır."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {surveys.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => navigate({ to: "/kesif", search: { id: s.id } })}
              className="surface-panel p-4 text-left transition hover:ring-2 hover:ring-highlight"
            >
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-mono">
                  {s.survey_no ?? "Yeni (numara gönderince)"}
                </span>
                {isDirty(s) ? (
                  <span className="flex items-center gap-1 text-amber-600">
                    <CloudOff className="h-3.5 w-3.5" /> Cihazda
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Gönderildi
                  </span>
                )}
              </div>
              <div className="mt-1 truncate font-bold">
                {s.title || "Adsız keşif"}
              </div>
              <div className="text-xs text-muted-foreground">
                {workTypeLabels[s.work_type]} ·{" "}
                {s.customer_name || "Müşteri yok"}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <Badge variant="outline">{dateTr(s.surveyed_at)}</Badge>
                <Badge variant="outline">{s.photos.length} foto</Badge>
                <Badge variant="outline">{s.items.length} kalem</Badge>
                {s.status === "teklif" ? <Badge>Teklif hazır</Badge> : null}
                {s.status === "tamamlandi" ? (
                  <Badge variant="secondary">Tamamlandı</Badge>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function OnlineBadge({ online }: { online: boolean }) {
  return online ? (
    <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
      <Wifi className="h-3.5 w-3.5" /> Çevrimiçi
    </span>
  ) : (
    <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
      <WifiOff className="h-3.5 w-3.5" /> İnternet yok · cihaza kaydediliyor
    </span>
  );
}

function SurveyEditor({
  id,
  online,
  isAdmin,
  onBack,
  onChanged,
  onSync,
}: {
  id: string;
  online: boolean;
  isAdmin: boolean;
  onBack: () => Promise<void>;
  onChanged: () => void;
  onSync: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [customers, setCustomers] = useState<CachedCustomer[]>([]);
  const [catalog, setCatalog] = useState<CachedCatalogItem[]>([]);
  const [locating, setLocating] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetHtml, setSheetHtml] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [sendTarget, setSendTarget] = useState<SendTarget | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      setSurvey((await getLocal(id)) ?? null);
      setCustomers(await cachedCustomers());
      setCatalog(await cachedCatalog());
    })();
  }, [id]);

  // Her değişiklik cihaza hemen, sunucuya birkaç saniye sonra yazılır.
  const update = useCallback(
    (patch: Partial<Survey> | ((current: Survey) => Partial<Survey>)) => {
      setSurvey((current) => {
        if (!current) return current;
        const next = {
          ...current,
          ...(typeof patch === "function" ? patch(current) : patch),
        };
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
          await saveLocal(next);
          onChanged();
          if (syncTimer.current) clearTimeout(syncTimer.current);
          syncTimer.current = setTimeout(() => {
            if (navigator.onLine) void onSync();
          }, 4000);
        }, 350);
        return next;
      });
    },
    [onChanged, onSync],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    },
    [],
  );

  if (!survey) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" /> Keşif açılıyor...
      </div>
    );
  }
  const s = survey;

  function setItems(items: SurveyItem[]) {
    update({ items });
  }

  async function locate() {
    if (!navigator.geolocation) {
      toast.error("Bu cihaz konum vermiyor.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        update({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          location_accuracy_m: Math.round(pos.coords.accuracy),
        });
        toast.success(`Konum alındı (±${Math.round(pos.coords.accuracy)} m).`);
      },
      (err) => {
        setLocating(false);
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? "Konum izni verilmedi. Tarayıcı ayarlarından izin verin."
            : "Konum alınamadı; açık alanda tekrar deneyin.",
        );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  }

  async function onPhotos(files: FileList | null) {
    if (!files?.length) return;
    let current = s;
    for (const file of Array.from(files)) {
      current = await addPhoto(current, file);
    }
    setSurvey(current);
    onChanged();
    if (navigator.onLine) void onSync();
    toast.success(`${files.length} fotoğraf eklendi.`);
  }

  async function parseNotes() {
    if (!s.notes.trim()) {
      toast.error("Önce notları yazın.");
      return;
    }
    setParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        items?: {
          description: string;
          quantity: number;
          unit: string;
          catalog_item_id: string | null;
          note: string | null;
        }[];
        error?: string;
      }>("survey-assist", { body: { notes: s.notes, work_type: s.work_type } });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => ({}));
          throw new Error(body.error ?? "Asistan notları çeviremedi.");
        }
        throw error;
      }
      const items = (data?.items ?? []).map((i) => ({
        id: crypto.randomUUID(),
        description: i.description,
        quantity: Number(i.quantity) > 0 ? Number(i.quantity) : 1,
        unit: i.unit || "adet",
        catalog_item_id: i.catalog_item_id,
        note: i.note,
      }));
      if (!items.length) {
        toast.message("Notlarda malzeme / iş kalemi bulunamadı.");
        return;
      }
      setItems([...s.items, ...items]);
      toast.success(
        `${items.length} kalem eklendi (${items.filter((i) => i.catalog_item_id).length} tanesi katalogla eşleşti). Kontrol edin.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }

  async function buildSheetHtml() {
    const photos: { url: string; caption: string | null }[] = [];
    for (const p of s.photos) {
      const url = await photoDataUrl(p, 1000).catch(() => null);
      if (url) photos.push({ url, caption: p.caption });
    }
    const customer =
      s.customer_name ||
      customers.find((c) => c.id === s.customer_id)?.name ||
      "";
    return surveySheetHtml(
      { ...s, customer_name: customer },
      photos,
      catalog,
      window.location.origin,
    );
  }

  function openSend() {
    const maps =
      s.latitude != null && s.longitude != null
        ? `https://www.google.com/maps?q=${s.latitude},${s.longitude}`
        : "";
    const name = (s.title || "Keşif").trim();
    const fileName = `${s.survey_no ?? "Kesif"}_${name
      .replace(/[^\wçğıöşüÇĞİÖŞÜ]+/g, "_")
      .slice(0, 50)}.pdf`;
    setSendTarget({
      kind: "survey",
      title: s.survey_no ? `${s.survey_no} keşif föyü` : "Keşif föyü",
      subject: `Keşif föyü: ${name}`,
      message: [
        `Merhaba, ${name} keşif föyü ektedir.`,
        s.location_text ? `Yer: ${s.location_text}` : "",
        maps ? `Konum: ${maps}` : "",
        `${s.items.length} kalem, ${s.photos.length} fotoğraf.`,
      ]
        .filter(Boolean)
        .join("\n"),
      makeFile: async () => htmlToPdf(await buildSheetHtml(), fileName),
    });
  }

  async function openSheet() {
    const photos: { url: string; caption: string | null }[] = [];
    for (const p of s.photos) {
      const url = await photoDataUrl(p, 1000).catch(() => null);
      if (url) photos.push({ url, caption: p.caption });
    }
    const customer =
      s.customer_name ||
      customers.find((c) => c.id === s.customer_id)?.name ||
      "";
    setSheetHtml(
      surveySheetHtml(
        { ...s, customer_name: customer },
        photos,
        catalog,
        window.location.origin,
      ),
    );
  }

  async function convertToOffer() {
    if (!navigator.onLine) {
      toast.error("Teklifleştirmek için internet gerekli.");
      return;
    }
    setConverting(true);
    try {
      await saveLocal(s);
      await pushSurvey((await getLocal(s.id)) ?? s);
      navigate({ to: "/energy-offer", search: { kesif: s.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setConverting(false);
    }
  }

  const catalogName = (cid: string | null) =>
    cid ? catalog.find((c) => c.id === cid)?.name : undefined;

  return (
    <div className="pb-24">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" className="h-11" onClick={() => void onBack()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Keşifler
        </Button>
        <span className="font-mono text-xs text-muted-foreground">
          {s.survey_no ?? "Numara gönderince verilir"}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <OnlineBadge online={online} />
          <Button
            variant="outline"
            className="h-11"
            onClick={() => void openSheet()}
          >
            <Printer className="mr-2 h-4 w-4" /> Keşif föyü
          </Button>
          <Button variant="outline" className="h-11" onClick={openSend}>
            <Send className="mr-2 h-4 w-4" /> Gönder
          </Button>
          {isAdmin ? (
            <Button
              className="h-11 font-bold"
              disabled={!online || converting}
              title={online ? undefined : "İnternet gerekli"}
              onClick={() => void convertToOffer()}
            >
              {converting ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              Teklifleştir
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <section className="surface-panel space-y-3 p-4">
            <Field label="Keşif adı">
              <Input
                value={s.title}
                maxLength={200}
                placeholder="örn. Çardak Petek — şarj istasyonu keşfi"
                onChange={(e) => update({ title: e.target.value })}
                className="h-12 text-base"
              />
            </Field>
            <div>
              <Label className="mb-1 block">İş türü</Label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(workTypeLabels) as WorkType[])
                  .filter((w) => FEATURES.ges || w !== "ges")
                  .map((w) => (
                    <Button
                      key={w}
                      type="button"
                      size="sm"
                      variant={s.work_type === w ? "default" : "outline"}
                      className="h-10"
                      onClick={() => update({ work_type: w })}
                    >
                      {workTypeLabels[w]}
                    </Button>
                  ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Müşteri (kayıtlıysa)">
                <Select
                  value={s.customer_id ?? NONE}
                  onValueChange={(v) => {
                    const c = customers.find((x) => x.id === v);
                    update({
                      customer_id: c ? c.id : null,
                      customer_name: c ? c.name : s.customer_name,
                    });
                  }}
                >
                  <SelectTrigger className="h-12">
                    <SelectValue placeholder="Seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Kayıtlı değil</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Müşteri / firma adı">
                <Input
                  value={s.customer_name ?? ""}
                  maxLength={200}
                  onChange={(e) => update({ customer_name: e.target.value })}
                  className="h-12"
                />
              </Field>
              <Field label="Telefon">
                <Input
                  value={s.contact_phone ?? ""}
                  inputMode="tel"
                  maxLength={40}
                  onChange={(e) => update({ contact_phone: e.target.value })}
                  className="h-12"
                />
              </Field>
              <Field label="Durum">
                <Select
                  value={s.status}
                  onValueChange={(v) =>
                    update({ status: v as Survey["status"] })
                  }
                >
                  <SelectTrigger className="h-12">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="taslak">Devam ediyor</SelectItem>
                    <SelectItem value="tamamlandi">Keşif tamamlandı</SelectItem>
                    <SelectItem value="teklif" disabled>
                      Teklife dönüştü
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </section>

          <section className="surface-panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Konum</h3>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={locating}
                onClick={() => void locate()}
              >
                {locating ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LocateFixed className="mr-2 h-4 w-4" />
                )}
                Konumumu al
              </Button>
            </div>
            <Input
              value={s.location_text ?? ""}
              maxLength={300}
              placeholder="Adres / mahalle / ada-parsel (örn. Çardak, Datça)"
              onChange={(e) => update({ location_text: e.target.value })}
              className="h-12"
            />
            {s.latitude != null && s.longitude != null ? (
              <a
                className="inline-flex items-center gap-1 text-sm text-highlight underline"
                href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin className="h-4 w-4" /> {s.latitude}, {s.longitude}
                {s.location_accuracy_m ? ` (±${s.location_accuracy_m} m)` : ""}
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">
                GPS internetsiz de çalışır; açık alanda daha doğru olur.
              </p>
            )}
          </section>

          <section className="surface-panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Notlar ve ölçüler</h3>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={!online || parsing}
                title={online ? undefined : "İnternet gelince kullanılabilir"}
                onClick={() => void parseNotes()}
              >
                {parsing ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Notlardan kalem çıkar
              </Button>
            </div>
            <Textarea
              value={s.notes}
              rows={9}
              maxLength={20000}
              placeholder={
                "Serbest yazın. Örn:\n22 kW şarj istasyonu otoparka, panodan 35 m\n5x6 NYY kablo 40 m\n4x40A kaçak akım rölesi\nsıva üstü IP65 pano, topraklama ölçülecek"
              }
              onChange={(e) => update({ notes: e.target.value })}
              className="text-base"
            />
            <VoiceTools
              survey={s}
              onAppend={(text) =>
                update((current) => ({
                  notes: current.notes.trim()
                    ? `${current.notes.replace(/\s+$/, "")}\n${text}`
                    : text,
                }))
              }
              onSurvey={(next) => {
                setSurvey(next);
                onChanged();
                if (navigator.onLine) void onSync();
              }}
            />
            <p className="text-xs text-muted-foreground">
              <b>Dikte</b> konuştukça notlara yazar (internet ister).{" "}
              <b>Ses kaydı</b> internetsiz de çalışır; kayıt keşifle saklanır,
              internet gelince gönderilir. &quot;Notlardan kalem çıkar&quot;
              notları malzeme listesine çevirir.
            </p>
          </section>

          <section className="surface-panel space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">Malzeme ve iş kalemleri</h3>
              <div className="flex gap-2">
                {catalog.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setPickerOpen(true)}
                  >
                    <Search className="mr-2 h-4 w-4" /> Katalogdan
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() =>
                    setItems([
                      ...s.items,
                      {
                        id: crypto.randomUUID(),
                        description: "",
                        quantity: 1,
                        unit: "adet",
                        catalog_item_id: null,
                        note: null,
                      },
                    ])
                  }
                >
                  <Plus className="mr-2 h-4 w-4" /> Kalem
                </Button>
              </div>
            </div>
            {s.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Henüz kalem yok. Katalogdan seçin, elle ekleyin ya da notlardan
                çıkarın.
              </p>
            ) : (
              <div className="space-y-2">
                {s.items.map((item, i) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-border p-2.5"
                  >
                    <div className="flex gap-2">
                      <Input
                        value={item.description}
                        maxLength={300}
                        placeholder="Malzeme / iş"
                        onChange={(e) =>
                          setItems(
                            s.items.map((x, j) =>
                              j === i
                                ? { ...x, description: e.target.value }
                                : x,
                            ),
                          )
                        }
                        className="h-11 flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 shrink-0 text-destructive"
                        aria-label="Kalemi sil"
                        onClick={() =>
                          setItems(s.items.filter((_, j) => j !== i))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={item.quantity}
                        onChange={(e) =>
                          setItems(
                            s.items.map((x, j) =>
                              j === i
                                ? { ...x, quantity: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                        className="h-11 w-24"
                      />
                      <Select
                        value={item.unit}
                        onValueChange={(v) =>
                          setItems(
                            s.items.map((x, j) =>
                              j === i ? { ...x, unit: v } : x,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="h-11 w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[...new Set([item.unit, ...surveyUnits])].map(
                            (u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                      {item.catalog_item_id ? (
                        <Badge variant="secondary" className="text-[11px]">
                          Katalog:{" "}
                          {catalogName(item.catalog_item_id) ?? "eşleşti"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[11px]">
                          Serbest kalem
                        </Badge>
                      )}
                      <Input
                        value={item.note ?? ""}
                        maxLength={300}
                        placeholder="Not (yer, kesit...)"
                        onChange={(e) =>
                          setItems(
                            s.items.map((x, j) =>
                              j === i
                                ? { ...x, note: e.target.value || null }
                                : x,
                            ),
                          )
                        }
                        className="h-11 min-w-40 flex-1"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="surface-panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Fotoğraflar ({s.photos.length})</h3>
              <Button
                type="button"
                className="h-11 font-bold"
                onClick={() => fileRef.current?.click()}
              >
                <Camera className="mr-2 h-4 w-4" /> Çek / ekle
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => {
                  void onPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {s.photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Pano, sayaç, güzergâh, çatı ve montaj yerinin fotoğraflarını
                çekin.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {s.photos.map((p) => (
                  <PhotoTile
                    key={p.id}
                    photo={p}
                    onCaption={(caption) =>
                      update({
                        photos: s.photos.map((x) =>
                          x.id === p.id ? { ...x, caption } : x,
                        ),
                      })
                    }
                    onToggle={() =>
                      update({
                        photos: s.photos.map((x) =>
                          x.id === p.id
                            ? { ...x, include_in_offer: !x.include_in_offer }
                            : x,
                        ),
                      })
                    }
                    onDelete={async () => {
                      if (!window.confirm("Fotoğraf silinsin mi?")) return;
                      setSurvey(await removePhoto(s, p.id));
                      onChanged();
                    }}
                  />
                ))}
              </div>
            )}
          </section>
          <section className="surface-panel p-4 text-xs text-muted-foreground">
            <p>
              {isDirty(s) ? (
                <span className="font-semibold text-amber-600">
                  Cihazda kayıtlı, henüz gönderilmedi.
                </span>
              ) : (
                <span className="font-semibold text-emerald-600">
                  Sunucuya gönderildi.
                </span>
              )}{" "}
              Tarih: {dateTr(s.surveyed_at)}
            </p>
            <Button
              type="button"
              variant="ghost"
              className="mt-2 h-10 px-0 text-destructive"
              onClick={async () => {
                if (
                  !window.confirm(
                    "Bu keşif silinsin mi? Fotoğraflar da silinir.",
                  )
                )
                  return;
                if (s.synced_at && navigator.onLine) {
                  const paths = s.photos
                    .map((p) => p.storage_path)
                    .filter(Boolean) as string[];
                  if (paths.length)
                    await supabase.storage.from("site-surveys").remove(paths);
                  const { error } = await supabase
                    .from("site_surveys")
                    .delete()
                    .eq("id", s.id);
                  if (error) {
                    toast.error(error.message);
                    return;
                  }
                } else if (s.synced_at) {
                  toast.error(
                    "Gönderilmiş keşfi silmek için internet gerekli.",
                  );
                  return;
                }
                await deleteLocal(s);
                toast.success("Keşif silindi.");
                await onBack();
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Keşfi sil
            </Button>
          </section>
        </aside>
      </div>

      <CatalogPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        catalog={catalog}
        onPick={(c) => {
          setItems([
            ...s.items,
            {
              id: crypto.randomUUID(),
              description: c.model ? `${c.name} (${c.model})` : c.name,
              quantity: 1,
              unit: c.unit || "adet",
              catalog_item_id: c.id,
              note: null,
            },
          ]);
        }}
      />
      <SheetPreview html={sheetHtml} onClose={() => setSheetHtml(null)} />
      <SendDialog target={sendTarget} onClose={() => setSendTarget(null)} />
    </div>
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
    <div>
      <Label className="mb-1 block">{label}</Label>
      {children}
    </div>
  );
}

function PhotoTile({
  photo,
  onCaption,
  onToggle,
  onDelete,
}: {
  photo: SurveyPhotoMeta;
  onCaption: (c: string | null) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    void photoUrl(photo).then((u) => {
      if (u?.startsWith("blob:")) revoke = u;
      setUrl(u);
    });
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [photo]);
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={photo.caption ?? "Keşif fotoğrafı"}
            className="aspect-square w-full object-cover"
          />
        </a>
      ) : (
        <div className="flex aspect-square items-center justify-center bg-muted text-xs text-muted-foreground">
          Önizleme yok
        </div>
      )}
      <div className="space-y-1 p-1.5">
        <Input
          value={photo.caption ?? ""}
          maxLength={200}
          placeholder="Açıklama"
          onChange={(e) => onCaption(e.target.value || null)}
          className="h-9 text-xs"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[11px]">
            <input
              type="checkbox"
              checked={photo.include_in_offer}
              onChange={onToggle}
            />
            Teklifte
          </label>
          <button
            type="button"
            className="text-destructive"
            aria-label="Fotoğrafı sil"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CatalogPicker({
  open,
  onOpenChange,
  catalog,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  catalog: CachedCatalogItem[];
  onPick: (c: CachedCatalogItem) => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.toLocaleLowerCase("tr-TR").trim();
    return catalog
      .filter((c) =>
        `${c.code} ${c.name} ${c.brand ?? ""} ${c.model ?? ""}`
          .toLocaleLowerCase("tr-TR")
          .includes(t),
      )
      .slice(0, 60);
  }, [catalog, q]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Katalogdan kalem</DialogTitle>
          <DialogDescription>
            Katalog cihazda saklı; internetsiz de seçilebilir.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ara: kablo, otomat, şarj, panel..."
          className="h-11"
        />
        <div className="max-h-[55vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              className="block w-full px-3 py-2.5 text-left hover:bg-muted"
              onClick={() => {
                onPick(c);
                toast.success("Eklendi");
              }}
            >
              <div className="text-sm font-semibold">{c.name}</div>
              <div className="text-xs text-muted-foreground">
                {[c.code, c.brand, c.model, c.unit].filter(Boolean).join(" · ")}
              </div>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Tamam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FRAME_SCRIPT =
  "<script>(function(){function f(){var w=window.innerWidth;document.body.style.zoom=w<840?String(w/840):'';}f();addEventListener('resize',f);addEventListener('message',function(e){if(e.data==='nes-print')window.print();});})();</script>";

function SheetPreview({
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
          <DialogTitle>Keşif föyü</DialogTitle>
          <DialogDescription>
            İç kullanım: ekip ve satın alma için. Müşteriye resmî teklif
            &quot;Teklifleştir&quot; ile hazırlanır.
          </DialogDescription>
        </DialogHeader>
        <iframe
          ref={frameRef}
          title="Keşif föyü"
          srcDoc={html ? html.replace("</body>", `${FRAME_SCRIPT}</body>`) : ""}
          sandbox="allow-scripts allow-modals"
          className="h-[70vh] w-full rounded-xl border border-border bg-[#e6eaeb]"
        />
        <DialogFooter>
          <Button
            className="h-11 font-bold"
            onClick={() =>
              frameRef.current?.contentWindow?.postMessage("nes-print", "*")
            }
          >
            <Printer className="mr-2 h-4 w-4" /> PDF / Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- ses
// Dikte: konuşma anında yazıya döner (tarayıcının konuşma tanıma özelliği;
// Chrome'da genelde internet ister). Ses kaydı: internetsiz de çalışır,
// kayıt keşifle birlikte saklanıp internet gelince gönderilir.

type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

function recognitionCtor(): (new () => RecognitionLike) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function pickAudioMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ]) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return "";
}

const mmss = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

function VoiceTools({
  survey,
  onAppend,
  onSurvey,
}: {
  survey: Survey;
  onAppend: (text: string) => void;
  onSurvey: (next: Survey) => void;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const wantListen = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(0);
  const surveyRef = useRef(survey);
  surveyRef.current = survey;
  const dictationSupported = Boolean(recognitionCtor());
  const recordSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  useEffect(
    () => () => {
      wantListen.current = false;
      recognitionRef.current?.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  function startDictation() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "tr-TR";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (finalText.trim()) onAppend(finalText.trim());
      setInterim(interimText);
    };
    rec.onerror = (event) => {
      if (event.error === "network") {
        wantListen.current = false;
        toast.error(
          "Dikte için internet gerekiyor. İnternetsiz yerde 'Ses kaydı'nı ya da klavyedeki mikrofonu kullanın.",
        );
      } else if (event.error === "not-allowed") {
        wantListen.current = false;
        toast.error("Mikrofon izni verilmedi.");
      }
    };
    // Tarayıcı sessizlikte durur; kullanıcı durdurmadıysa yeniden başlat.
    rec.onend = () => {
      setInterim("");
      if (wantListen.current) {
        try {
          rec.start();
          return;
        } catch {
          // yeniden başlatılamadı
        }
      }
      setListening(false);
    };
    recognitionRef.current = rec;
    wantListen.current = true;
    setListening(true);
    rec.start();
  }

  function stopDictation() {
    wantListen.current = false;
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickAudioMime();
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const duration = (Date.now() - startedRef.current) / 1000;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mime || "audio/webm",
        });
        if (blob.size > 0) {
          onSurvey(await addAudio(surveyRef.current, blob, duration));
          toast.success(`Ses kaydı eklendi (${mmss(duration)}).`);
        }
      };
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      setSeconds(0);
      timerRef.current = setInterval(
        () => setSeconds((Date.now() - startedRef.current) / 1000),
        500,
      );
      recorder.start(1000);
      setRecording(true);
    } catch {
      toast.error("Mikrofon açılamadı. Tarayıcıda mikrofon izni verin.");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {dictationSupported ? (
          <Button
            type="button"
            variant={listening ? "destructive" : "outline"}
            className="h-11"
            onClick={() => (listening ? stopDictation() : startDictation())}
          >
            {listening ? (
              <MicOff className="mr-2 h-4 w-4" />
            ) : (
              <Mic className="mr-2 h-4 w-4" />
            )}
            {listening ? "Dikteyi durdur" : "Dikte et (sesten yazıya)"}
          </Button>
        ) : null}
        {recordSupported ? (
          <Button
            type="button"
            variant={recording ? "destructive" : "outline"}
            className="h-11"
            onClick={() =>
              recording ? stopRecording() : void startRecording()
            }
          >
            {recording ? (
              <Square className="mr-2 h-4 w-4" />
            ) : (
              <Circle className="mr-2 h-4 w-4 fill-red-500 text-red-500" />
            )}
            {recording ? `Kaydı bitir (${mmss(seconds)})` : "Ses kaydı"}
          </Button>
        ) : null}
      </div>
      {listening ? (
        <p className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          Dinliyorum… konuştukça notlara yazılıyor.
          {interim ? (
            <span className="italic text-muted-foreground">{interim}</span>
          ) : null}
        </p>
      ) : null}
      {survey.audios.length > 0 ? (
        <div className="space-y-2">
          {survey.audios.map((a, i) => (
            <AudioRow
              key={a.id}
              audio={a}
              index={i + 1}
              onDelete={async () => {
                if (!window.confirm("Ses kaydı silinsin mi?")) return;
                onSurvey(await removeAudio(surveyRef.current, a.id));
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AudioRow({
  audio,
  index,
  onDelete,
}: {
  audio: SurveyAudioMeta;
  index: number;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    void audioUrl(audio).then((u) => {
      if (u?.startsWith("blob:")) revoke = u;
      setUrl(u);
    });
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [audio]);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2">
      <span className="text-xs font-semibold">
        Ses {index} · {mmss(audio.duration_s)}
      </span>
      {url ? (
        <audio controls src={url} className="h-9 min-w-0 flex-1" />
      ) : (
        <span className="flex-1 text-xs text-muted-foreground">
          Bu cihazda değil; internet gelince dinlenebilir.
        </span>
      )}
      {audio.storage_path ? null : (
        <span className="text-[11px] text-amber-600">gönderilmedi</span>
      )}
      <button
        type="button"
        className="text-destructive"
        aria-label="Ses kaydını sil"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
