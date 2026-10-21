// Hakedişler: taşeron listesi (alış) → müşteri hakedişi (alış + kâr).
// Asistan fotoğraftan okuyup taslak açabilir; burada kalemler kontrol edilip
// düzeltilir, iki PDF üretilir (müşteri hakedişi, taşeron iç kaydı).
// Alış tutarı ve kâr içerdiği için yalnız yönetici görür.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  FileDown,
  LoaderCircle,
  Plus,
  Save,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { canSeeFinancials } from "@/lib/permissions";
import { errorMessage } from "@/lib/domain";
import { companyFromProfile } from "@/lib/company";
import { compressImage } from "@/lib/image-compress";
import { htmlToPdf } from "@/lib/html-to-pdf";
import { shareFile } from "@/lib/send-channels";
import {
  billStatusLabels,
  billTotals,
  customerBillHtml,
  internalRecordHtml,
  sellAmount,
  tl,
  type BillLine,
  type BillStatus,
} from "@/lib/progress-bill";
import {
  AccessDenied,
  EmptyState,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/hakedis")({
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search.id === "string" ? { id: search.id } : {},
  component: ProgressBillsPage,
});

const PHOTO_BUCKET = "assistant-uploads";

type BillRow = {
  id: string;
  bill_no: string | null;
  title: string;
  customer_id: string | null;
  customer_name: string | null;
  subcontractor_name: string;
  margin_pct: number;
  vat_rate: number;
  written_total: number | null;
  photo_path: string | null;
  notes: string | null;
  status: BillStatus;
  bill_date: string;
  created_at: string;
  progress_bill_lines: (BillLine & { position: number })[];
};

const SELECT =
  "id, bill_no, title, customer_id, customer_name, subcontractor_name, margin_pct, vat_rate, written_total, photo_path, notes, status, bill_date, created_at, progress_bill_lines(id, position, quantity, unit, description, cost_amount, note)";

const parseNum = (v: string) => {
  const n = Number(v.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const numText = (v: number | null | undefined) =>
  v == null ? "" : String(v).replace(".", ",");

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function safeName(v: string) {
  return v
    .replace(/[^\wçğıöşüÇĞİÖŞÜ]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

function ProgressBillsPage() {
  const { role } = useAuth();
  const allowed = canSeeFinancials(role);
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["progress-bills"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("progress_bills")
        .select(SELECT)
        .order("bill_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as BillRow[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("progress_bills")
        .insert({ title: "Yeni hakediş", subcontractor_name: "Taşeron" })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: async (newId) => {
      await queryClient.invalidateQueries({ queryKey: ["progress-bills"] });
      void navigate({ to: "/hakedis", search: { id: newId } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!allowed) return <AccessDenied />;
  if (listQuery.isLoading)
    return <LoadingState label="Hakedişler yükleniyor..." />;
  if (listQuery.error)
    return (
      <p className="surface-panel p-5 text-destructive">
        {errorMessage(listQuery.error)}
      </p>
    );

  const bills = listQuery.data ?? [];
  const selected = id ? bills.find((b) => b.id === id) : undefined;
  if (id && selected) {
    return (
      <BillEditor
        key={selected.id}
        bill={selected}
        onBack={() => void navigate({ to: "/hakedis", search: {} })}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Hakedişler"
        description="Taşeron listesinden müşteri hakedişi. Asistana taşeronun listesinin fotoğrafını gönderip 'hakediş hazırla' diyebilirsiniz."
        actions={
          <Button
            className="h-12 font-bold"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus className="mr-2 h-4 w-4" /> Yeni hakediş
          </Button>
        }
      />
      {bills.length === 0 ? (
        <EmptyState
          title="Henüz hakediş yok"
          description="Asistana taşeron listesinin fotoğrafını ekleyin ya da elle yeni hakediş açın."
        />
      ) : (
        <div className="grid gap-3">
          {bills.map((b) => {
            const t = billTotals(
              b.progress_bill_lines,
              b.margin_pct,
              b.vat_rate,
            );
            return (
              <button
                key={b.id}
                type="button"
                onClick={() =>
                  void navigate({ to: "/hakedis", search: { id: b.id } })
                }
                className="surface-panel flex flex-wrap items-center justify-between gap-3 p-4 text-left transition-colors hover:border-primary/50"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-muted-foreground">
                    {b.bill_no} · {b.bill_date.split("-").reverse().join(".")}
                  </p>
                  <p className="truncate font-bold">{b.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {b.customer_name ?? "Müşteri yok"} · taşeron{" "}
                    {b.subcontractor_name}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{tl(t.sell)}</p>
                  <p className="text-xs text-muted-foreground">
                    alış {tl(t.cost)} · kâr {tl(t.profit)}
                  </p>
                  <Badge variant="outline" className="mt-1">
                    {billStatusLabels[b.status]}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

type EditLine = {
  key: string;
  quantity: string;
  unit: string;
  description: string;
  cost: string;
  note: string;
};

function BillEditor({ bill, onBack }: { bill: BillRow; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: bill.title,
    customer_id: bill.customer_id ?? "",
    customer_name: bill.customer_name ?? "",
    subcontractor_name: bill.subcontractor_name,
    margin_pct: numText(bill.margin_pct),
    vat_rate: numText(bill.vat_rate),
    written_total: numText(bill.written_total),
    bill_date: bill.bill_date,
    status: bill.status,
    notes: bill.notes ?? "",
  });
  const [photoPath, setPhotoPath] = useState(bill.photo_path);
  const [lines, setLines] = useState<EditLine[]>(() =>
    [...bill.progress_bill_lines]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        key: l.id,
        quantity: numText(l.quantity),
        unit: l.unit,
        description: l.description,
        cost: numText(l.cost_amount),
        note: l.note ?? "",
      })),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const refs = useQuery({
    queryKey: ["progress-bill-refs"],
    queryFn: async () => {
      const [customers, profile, bank] = await Promise.all([
        supabase.from("customers").select("id, name").order("name"),
        supabase.from("company_profile").select("*").eq("id", 1).maybeSingle(),
        supabase
          .from("cash_accounts")
          .select("bank_name, iban")
          .eq("show_on_invoice", true)
          .eq("is_active", true)
          .order("sort_order")
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        customers: customers.data ?? [],
        company: companyFromProfile(profile.data ?? null, bank.data ?? null),
      };
    },
  });

  useEffect(() => {
    if (!photoPath) {
      setPhotoUrl(null);
      return;
    }
    void supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(photoPath, 3600)
      .then(({ data }) => setPhotoUrl(data?.signedUrl ?? null));
  }, [photoPath]);

  const parsedLines: BillLine[] = useMemo(
    () =>
      lines
        .filter((l) => l.description.trim())
        .map((l) => ({
          id: l.key,
          quantity: parseNum(l.quantity) || 1,
          unit: l.unit.trim() || "adet",
          description: l.description.trim(),
          cost_amount: parseNum(l.cost),
          note: l.note.trim() || null,
        })),
    [lines],
  );
  const margin = parseNum(form.margin_pct);
  const vat = parseNum(form.vat_rate);
  const totals = billTotals(parsedLines, margin, vat);
  const written = form.written_total.trim()
    ? parseNum(form.written_total)
    : null;
  const diff =
    written != null ? Math.round((totals.cost - written) * 100) / 100 : null;

  const header = () => ({
    bill_no: bill.bill_no,
    title: form.title.trim() || "Hakediş",
    customer_name: form.customer_name.trim() || null,
    subcontractor_name: form.subcontractor_name.trim() || "Taşeron",
    margin_pct: margin,
    vat_rate: vat,
    written_total: written,
    bill_date: form.bill_date,
    notes: form.notes.trim() || null,
  });

  async function save() {
    setBusy("save");
    try {
      const { error } = await supabase
        .from("progress_bills")
        .update({
          title: form.title.trim() || "Hakediş",
          customer_id: form.customer_id || null,
          customer_name: form.customer_name.trim() || null,
          subcontractor_name: form.subcontractor_name.trim() || "Taşeron",
          margin_pct: margin,
          vat_rate: vat,
          written_total: written,
          bill_date: form.bill_date,
          status: form.status,
          notes: form.notes.trim() || null,
          photo_path: photoPath,
        })
        .eq("id", bill.id);
      if (error) throw error;
      const del = await supabase
        .from("progress_bill_lines")
        .delete()
        .eq("bill_id", bill.id);
      if (del.error) throw del.error;
      if (parsedLines.length) {
        const ins = await supabase.from("progress_bill_lines").insert(
          parsedLines.map((l, i) => ({
            bill_id: bill.id,
            position: i,
            quantity: l.quantity,
            unit: l.unit,
            description: l.description,
            cost_amount: l.cost_amount,
            note: l.note,
          })),
        );
        if (ins.error) throw ins.error;
      }
      await queryClient.invalidateQueries({ queryKey: ["progress-bills"] });
      toast.success("Hakediş kaydedildi.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function uploadPhoto(file: File) {
    setBusy("photo");
    try {
      const blob = await compressImage(file, 2400, 1_500_000);
      const { data: auth } = await supabase.auth.getUser();
      const path = `${auth.user?.id ?? "anon"}/hakedis-${bill.id}-${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      setPhotoPath(path);
      toast.success("Fotoğraf eklendi; Kaydet'e basmayı unutmayın.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function makePdf(kind: "customer" | "internal") {
    const company = refs.data?.company;
    if (!company) return null;
    const origin = window.location.origin;
    let html: string;
    let name: string;
    const base = `${bill.bill_no ?? "Hakedis"}_${safeName(form.customer_name || form.title)}`;
    if (kind === "customer") {
      html = customerBillHtml(header(), parsedLines, company, origin);
      name = `${base}_Hakedis.pdf`;
    } else {
      let photo: string | null = null;
      if (photoUrl) {
        const res = await fetch(photoUrl);
        if (res.ok) photo = await blobToDataUrl(await res.blob());
      }
      html = internalRecordHtml(header(), parsedLines, company, origin, photo);
      name = `${base}_TaseronKaydi.pdf`;
    }
    return htmlToPdf(html, name);
  }

  async function pdf(kind: "customer" | "internal", share: boolean) {
    setBusy(`${kind}-${share ? "share" : "pdf"}`);
    try {
      const file = await makePdf(kind);
      if (!file) return;
      if (share) {
        const shared = await shareFile(
          file,
          kind === "customer" ? `${form.title} hakedişi` : file.name,
        ).catch(() => false);
        if (!shared) download(file);
      } else {
        download(file);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(`${bill.bill_no} hakedişi silinsin mi? Geri alınamaz.`))
      return;
    const { error } = await supabase
      .from("progress_bills")
      .delete()
      .eq("id", bill.id);
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["progress-bills"] });
    toast.success("Hakediş silindi.");
    onBack();
  }

  const setLine = (key: string, patch: Partial<EditLine>) =>
    setLines((list) =>
      list.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  const spin = (k: string) =>
    busy === k ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Hakedişler
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!!busy} onClick={() => void save()}>
            {spin("save") ?? <Save className="mr-2 h-4 w-4" />} Kaydet
          </Button>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => void remove()}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Sil
          </Button>
        </div>
      </div>

      <section className="surface-panel grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
        <div className="sm:col-span-2">
          <p className="font-mono text-xs font-bold text-muted-foreground">
            {bill.bill_no}
          </p>
        </div>
        <Field label="İş / başlık">
          <Input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Taşeron">
          <Input
            value={form.subcontractor_name}
            onChange={(e) =>
              setForm({ ...form, subcontractor_name: e.target.value })
            }
          />
        </Field>
        <Field label="Müşteri (kayıtlı)">
          <Select
            value={form.customer_id || "none"}
            onValueChange={(v) => {
              const c = refs.data?.customers.find((x) => x.id === v);
              setForm({
                ...form,
                customer_id: v === "none" ? "" : v,
                customer_name: c ? c.name : form.customer_name,
              });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seçin" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Kayıtlı değil</SelectItem>
              {(refs.data?.customers ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Belgede görünen müşteri adı">
          <Input
            value={form.customer_name}
            onChange={(e) =>
              setForm({ ...form, customer_name: e.target.value })
            }
          />
        </Field>
        <div className="grid grid-cols-3 gap-3 sm:col-span-2">
          <Field label="Kâr %">
            <Input
              inputMode="decimal"
              value={form.margin_pct}
              onChange={(e) => setForm({ ...form, margin_pct: e.target.value })}
            />
          </Field>
          <Field label="KDV %">
            <Input
              inputMode="decimal"
              value={form.vat_rate}
              onChange={(e) => setForm({ ...form, vat_rate: e.target.value })}
            />
          </Field>
          <Field label="Tarih">
            <Input
              type="date"
              value={form.bill_date}
              onChange={(e) => setForm({ ...form, bill_date: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Taşeronun yazdığı toplam (kontrol için)">
          <Input
            inputMode="decimal"
            value={form.written_total}
            onChange={(e) =>
              setForm({ ...form, written_total: e.target.value })
            }
          />
        </Field>
        <Field label="Durum">
          <Select
            value={form.status}
            onValueChange={(v) => setForm({ ...form, status: v as BillStatus })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(billStatusLabels) as BillStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {billStatusLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="İç not">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className="surface-panel mt-4 grid gap-4 p-4 sm:p-5 lg:grid-cols-[1fr_280px]">
        <div className="grid content-start gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-black">Kalemler (taşeron tutarı)</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setLines((l) => [
                  ...l,
                  {
                    key: crypto.randomUUID(),
                    quantity: "1",
                    unit: "adet",
                    description: "",
                    cost: "",
                    note: "",
                  },
                ])
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Kalem
            </Button>
          </div>
          {lines.map((l, i) => {
            const cost = parseNum(l.cost);
            return (
              <div
                key={l.key}
                className={`grid gap-2 rounded-xl border p-3 ${l.note ? "border-warning/60 bg-warning/5" : "border-border/70"}`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-2 w-5 shrink-0 text-xs font-bold text-muted-foreground">
                    {i + 1}
                  </span>
                  <Input
                    className="flex-1"
                    placeholder="Açıklama"
                    value={l.description}
                    onChange={(e) =>
                      setLine(l.key, { description: e.target.value })
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Kalemi sil"
                    onClick={() =>
                      setLines((list) => list.filter((x) => x.key !== l.key))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2 pl-7">
                  <Input
                    inputMode="decimal"
                    placeholder="Miktar"
                    value={l.quantity}
                    onChange={(e) =>
                      setLine(l.key, { quantity: e.target.value })
                    }
                  />
                  <Input
                    placeholder="Birim"
                    value={l.unit}
                    onChange={(e) => setLine(l.key, { unit: e.target.value })}
                  />
                  <Input
                    inputMode="decimal"
                    placeholder="Tutar ₺"
                    value={l.cost}
                    onChange={(e) => setLine(l.key, { cost: e.target.value })}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pl-7 text-xs">
                  <Input
                    className="h-8 min-w-0 flex-1 text-xs"
                    placeholder="Okuma notu (emin olunmayan rakam vb.)"
                    value={l.note}
                    onChange={(e) => setLine(l.key, { note: e.target.value })}
                  />
                  <span className="text-muted-foreground">
                    müşteriye{" "}
                    <b className="text-foreground">
                      {tl(sellAmount(cost, margin))}
                    </b>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid content-start gap-3">
          <div className="rounded-xl border border-border/70 p-3 text-sm">
            <Row label="Taşeron toplamı" value={tl(totals.cost)} />
            {written != null ? (
              <Row
                label="Taşeronun yazdığı"
                value={tl(written)}
                tone={diff ? "danger" : undefined}
                extra={diff ? `Fark ${tl(diff)}` : "Tutuyor"}
              />
            ) : null}
            <div className="my-2 border-t" />
            <Row
              label={`Müşteri (KDV hariç, %${form.margin_pct || 0} kâr)`}
              value={tl(totals.sell)}
            />
            <Row label={`KDV %${form.vat_rate || 0}`} value={tl(totals.vat)} />
            <Row label="Genel toplam" value={tl(totals.grand)} strong />
            <div className="my-2 border-t" />
            <Row label="Brüt kâr" value={tl(totals.profit)} />
          </div>
          <div className="grid gap-2">
            <Button
              disabled={!!busy || !refs.data}
              onClick={() => void pdf("customer", false)}
            >
              {spin("customer-pdf") ?? <FileDown className="mr-2 h-4 w-4" />}{" "}
              Müşteri hakedişi PDF
            </Button>
            <Button
              variant="outline"
              disabled={!!busy || !refs.data}
              onClick={() => void pdf("customer", true)}
            >
              {spin("customer-share") ?? <Share2 className="mr-2 h-4 w-4" />}{" "}
              Müşteri hakedişini paylaş
            </Button>
            <Button
              variant="outline"
              disabled={!!busy || !refs.data}
              onClick={() => void pdf("internal", false)}
            >
              {spin("internal-pdf") ?? <FileDown className="mr-2 h-4 w-4" />}{" "}
              Taşeron kaydı PDF (iç)
            </Button>
          </div>
          <div className="rounded-xl border border-border/70 p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Taşeronun asıl listesi
            </p>
            {photoUrl ? (
              <a href={photoUrl} target="_blank" rel="noreferrer">
                <img
                  src={photoUrl}
                  alt="Taşeron listesi"
                  className="w-full rounded-lg border"
                />
              </a>
            ) : (
              <p className="text-xs text-muted-foreground">Fotoğraf yok.</p>
            )}
            <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-highlight">
              {spin("photo") ?? <Camera className="h-3.5 w-3.5" />}
              {photoPath ? "Fotoğrafı değiştir" : "Fotoğraf ekle"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadPhoto(f);
                }}
              />
            </label>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Müşteri hakedişinde alış tutarları, kâr oranı ve taşeron adı yer
            almaz. PDF almadan önce değişiklikleri kaydedin.
          </p>
        </div>
      </section>
    </>
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
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
  extra,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "danger";
  extra?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right ${strong ? "font-black" : "font-semibold"}`}>
        {value}
        {extra ? (
          <span
            className={`block text-[11px] ${tone === "danger" ? "text-destructive" : "text-success"}`}
          >
            {extra}
          </span>
        ) : null}
      </span>
    </div>
  );
}
