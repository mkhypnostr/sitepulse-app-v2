// Giderler: alış faturaları ve fişler, ödeme kaydı, belge eki.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Paperclip, Plus, Search, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import { todayIso } from "@/lib/sales";
import {
  billPayments,
  cur,
  documentTypeLabels,
  expenseCategoryLabels,
  parseAmount,
  type Currency,
  type DocumentType,
  type ExpenseCategory,
  type PurchaseBill,
} from "@/lib/accounting";
import {
  openFinanceDocument,
  uploadFinanceDocument,
  useRefreshAccounting,
  type AccountingData,
} from "@/lib/accounting-data";
import { EmptyState } from "@/components/page-states";
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

const NONE = "__none__";
const NEW = "__new__";
const dateTr = (v: string | null) =>
  v ? v.slice(0, 10).split("-").reverse().join(".") : "-";

type BillForm = {
  id: string | null;
  supplier_id: string;
  new_supplier_name: string;
  new_supplier_tax_no: string;
  document_type: DocumentType;
  document_no: string;
  issue_date: string;
  due_date: string;
  category: ExpenseCategory;
  description: string;
  project_id: string;
  currency: Currency;
  exchange_rate: string;
  net: string;
  vat_rate: string; // "0.2" | "0.1" | "0.01" | "0" | "custom"
  vat: string;
  withholding: string;
  notes: string;
  attachment_path: string | null;
  file: File | null;
  paid_now: boolean;
  pay_account_id: string;
};

function emptyForm(): BillForm {
  return {
    id: null,
    supplier_id: NONE,
    new_supplier_name: "",
    new_supplier_tax_no: "",
    document_type: "e_fatura",
    document_no: "",
    issue_date: todayIso(),
    due_date: "",
    category: "malzeme",
    description: "",
    project_id: NONE,
    currency: "TRY",
    exchange_rate: "1",
    net: "",
    vat_rate: "0.2",
    vat: "",
    withholding: "0",
    notes: "",
    attachment_path: null,
    file: null,
    paid_now: false,
    pay_account_id: NONE,
  };
}

function formFromBill(b: PurchaseBill): BillForm {
  const net = Number(b.net_amount);
  const vat = Number(b.vat_amount);
  const rate = net > 0 ? Math.round((vat / net) * 100) / 100 : 0;
  const known = ["0.2", "0.1", "0.01", "0"].includes(String(rate));
  return {
    ...emptyForm(),
    id: b.id,
    supplier_id: b.supplier_id ?? NONE,
    document_type: b.document_type,
    document_no: b.document_no ?? "",
    issue_date: b.issue_date,
    due_date: b.due_date ?? "",
    category: b.category,
    description: b.description ?? "",
    project_id: b.project_id ?? NONE,
    currency: b.currency,
    exchange_rate: String(b.exchange_rate),
    net: String(net),
    vat_rate: known ? String(rate) : "custom",
    vat: String(vat),
    withholding: String(b.withholding_amount),
    notes: b.notes ?? "",
    attachment_path: b.attachment_path,
  };
}

export function ExpensesTab({ data }: { data: AccountingData }) {
  const refresh = useRefreshAccounting();
  const [q, setQ] = useState("");
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [category, setCategory] = useState<"all" | ExpenseCategory>("all");
  const [form, setForm] = useState<BillForm | null>(null);
  const [payBill, setPayBill] = useState<PurchaseBill | null>(null);

  const supplierName = useMemo(
    () => new Map(data.suppliers.map((s) => [s.id, s.name])),
    [data.suppliers],
  );
  const projectName = useMemo(
    () => new Map(data.projects.map((p) => [p.id, p.name])),
    [data.projects],
  );
  const payments = useMemo(
    () => billPayments(data.bills, data.txns),
    [data.bills, data.txns],
  );

  const rows = data.bills.filter((b) => {
    if (month !== "all" && !b.issue_date.startsWith(month)) return false;
    if (category !== "all" && b.category !== category) return false;
    const text = `${supplierName.get(b.supplier_id ?? "") ?? ""} ${b.document_no ?? ""} ${b.description ?? ""}`;
    return text
      .toLocaleLowerCase("tr-TR")
      .includes(q.toLocaleLowerCase("tr-TR"));
  });
  const totals = rows.reduce(
    (acc, b) => {
      const rate = b.currency === "TRY" ? 1 : Number(b.exchange_rate);
      acc.net += Number(b.net_amount) * rate;
      acc.vat += Number(b.vat_amount) * rate;
      acc.open += (payments.get(b.id)?.remaining ?? 0) * rate;
      return acc;
    },
    { net: 0, vat: 0, open: 0 },
  );
  const months = [
    ...new Set([
      todayIso().slice(0, 7),
      ...data.bills.map((b) => b.issue_date.slice(0, 7)),
    ]),
  ].sort((a, b) => b.localeCompare(a));

  const remove = useMutation({
    mutationFn: async (bill: PurchaseBill) => {
      const { error } = await supabase
        .from("purchase_bills")
        .delete()
        .eq("id", bill.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Gider silindi.");
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tedarikçi, belge no, açıklama"
            className="h-11 pl-9"
          />
        </div>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="h-11 lg:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm aylar</SelectItem>
            {months.map((m) => (
              <SelectItem key={m} value={m}>
                {m.split("-").reverse().join(".")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={category}
          onValueChange={(v) => setCategory(v as typeof category)}
        >
          <SelectTrigger className="h-11 lg:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm kategoriler</SelectItem>
            {Object.entries(expenseCategoryLabels).map(([k, l]) => (
              <SelectItem key={k} value={k}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="h-11 font-bold" onClick={() => setForm(emptyForm())}>
          <Plus className="mr-2 h-4 w-4" /> Gider / alış faturası
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Gider (KDV hariç)" value={cur(totals.net, "TRY")} />
        <Stat label="İndirilecek KDV" value={cur(totals.vat, "TRY")} />
        <Stat label="Ödenmemiş" value={cur(totals.open, "TRY")} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Bu dönemde gider yok"
          description="Tedarikçi faturalarını, akaryakıt ve yemek fişlerini buraya girin; KDV özeti ve gelir-gider raporu bunlardan hesaplanır."
        />
      ) : (
        <div className="surface-panel divide-y divide-border overflow-hidden">
          {rows.map((b) => {
            const p = payments.get(b.id);
            const paid = (p?.remaining ?? 0) <= 0.005;
            return (
              <div
                key={b.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setForm(formFromBill(b))}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {supplierName.get(b.supplier_id ?? "") ?? "Tedarikçisiz"}
                    </span>
                    <Badge variant="outline" className="text-[11px]">
                      {expenseCategoryLabels[b.category]}
                    </Badge>
                    <Badge variant="outline" className="text-[11px]">
                      {documentTypeLabels[b.document_type]}
                      {b.document_no ? ` · ${b.document_no}` : ""}
                    </Badge>
                    {b.source === "parasut" ? (
                      <Badge variant="outline" className="text-[11px]">
                        Paraşüt
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {dateTr(b.issue_date)}
                    {b.due_date ? ` · vade ${dateTr(b.due_date)}` : ""}
                    {b.project_id
                      ? ` · ${projectName.get(b.project_id) ?? ""}`
                      : ""}
                    {b.description ? ` · ${b.description}` : ""}
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <div className="font-bold tabular-nums">
                      {cur(Number(b.total_amount), b.currency)}
                    </div>
                    <div
                      className={`text-[11px] ${paid ? "text-emerald-600" : "text-amber-600"}`}
                    >
                      {paid
                        ? "Ödendi"
                        : `Kalan ${cur(p?.remaining ?? 0, b.currency)}`}
                    </div>
                  </div>
                  {b.attachment_path ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Belgeyi aç"
                      onClick={() =>
                        openFinanceDocument(b.attachment_path as string).catch(
                          (e) => toast.error(errorMessage(e)),
                        )
                      }
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                  ) : null}
                  {!paid ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPayBill(b)}
                    >
                      <Wallet className="mr-1 h-4 w-4" /> Öde
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    aria-label="Sil"
                    onClick={() => {
                      const hasPay = (p?.paid ?? 0) > 0;
                      if (
                        window.confirm(
                          hasPay
                            ? "Bu giderin ödeme kaydı var. Gider silinirse ödeme hesap hareketlerinde bağlantısız kalır. Silinsin mi?"
                            : "Bu gider silinsin mi?",
                        )
                      )
                        remove.mutate(b);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form ? (
        <BillDialog
          form={form}
          setForm={setForm}
          data={data}
          onDone={async () => {
            setForm(null);
            await refresh();
          }}
        />
      ) : null}
      {payBill ? (
        <PayDialog
          bill={payBill}
          remaining={payments.get(payBill.id)?.remaining ?? 0}
          data={data}
          onClose={() => setPayBill(null)}
          onDone={async () => {
            setPayBill(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-panel p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function BillDialog({
  form,
  setForm,
  data,
  onDone,
}: {
  form: BillForm;
  setForm: (f: BillForm | null) => void;
  data: AccountingData;
  onDone: () => Promise<void>;
}) {
  const f = form;
  const set = (patch: Partial<BillForm>) => setForm({ ...f, ...patch });
  const net = parseAmount(f.net);
  const vat =
    f.vat_rate === "custom"
      ? parseAmount(f.vat)
      : Math.round(
          (Number.isFinite(net) ? net : 0) * Number(f.vat_rate) * 100,
        ) / 100;
  const withholding = parseAmount(f.withholding || "0");
  const total =
    (Number.isFinite(net) ? net : 0) +
    (Number.isFinite(vat) ? vat : 0) -
    (Number.isFinite(withholding) ? withholding : 0);
  const accounts = data.accounts.filter(
    (a) => a.is_active && a.currency === f.currency,
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!(net >= 0) || !Number.isFinite(net))
        throw new Error("Matrahı (KDV hariç tutar) yazın.");
      if (!Number.isFinite(vat) || vat < 0)
        throw new Error("KDV tutarı hatalı.");
      if (withholding > vat) throw new Error("Tevkifat KDV'den büyük olamaz.");
      let supplierId: string | null =
        f.supplier_id === NONE ? null : f.supplier_id;
      if (f.supplier_id === NEW) {
        const name = f.new_supplier_name.trim();
        if (!name) throw new Error("Yeni tedarikçinin adını yazın.");
        const taxNo = f.new_supplier_tax_no.replace(/\D/g, "") || null;
        if (taxNo && !/^\d{10,11}$/.test(taxNo))
          throw new Error("Vergi no 10, TCKN 11 hane olmalı.");
        const { data: s, error } = await supabase
          .from("suppliers")
          .insert({ name, tax_no: taxNo })
          .select("id")
          .single();
        if (error) throw error;
        supplierId = s.id;
      }
      let attachment = f.attachment_path;
      if (f.file)
        attachment = await uploadFinanceDocument("purchase-bills", f.file);
      const payload = {
        supplier_id: supplierId,
        document_type: f.document_type,
        document_no: f.document_no.trim() || null,
        issue_date: f.issue_date,
        due_date: f.due_date || null,
        category: f.category,
        description: f.description.trim() || null,
        project_id: f.project_id === NONE ? null : f.project_id,
        currency: f.currency,
        exchange_rate:
          f.currency === "TRY" ? 1 : parseAmount(f.exchange_rate) || 1,
        net_amount: Math.round(net * 100) / 100,
        vat_amount: Math.round(vat * 100) / 100,
        withholding_amount: Math.round((withholding || 0) * 100) / 100,
        notes: f.notes.trim() || null,
        attachment_path: attachment,
      };
      let billId = f.id;
      if (billId) {
        const { error } = await supabase
          .from("purchase_bills")
          .update(payload)
          .eq("id", billId);
        if (error) throw error;
      } else {
        const { data: b, error } = await supabase
          .from("purchase_bills")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        billId = b.id;
      }
      if (!f.id && f.paid_now) {
        if (f.pay_account_id === NONE)
          throw new Error("Ödendiği hesabı seçin.");
        const { error } = await supabase.from("cash_transactions").insert({
          account_id: f.pay_account_id,
          txn_date: f.issue_date,
          direction: "cikis",
          amount: Math.round(total * 100) / 100,
          kind: "tedarikci_odeme",
          supplier_id: supplierId,
          purchase_bill_id: billId,
          project_id: payload.project_id,
          description: f.document_no.trim() || f.description.trim() || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success("Gider kaydedildi.");
      await onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => (!o ? setForm(null) : null)}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {f.id ? "Gideri düzenle" : "Yeni gider / alış faturası"}
          </DialogTitle>
          <DialogDescription>
            Faturadaki KDV hariç tutarı (matrah) ve KDV&apos;yi girin. Belgenin
            fotoğrafını veya PDF&apos;ini ekleyin; mali müşavire bu liste gider.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Tedarikçi</Label>
            <Select
              value={f.supplier_id}
              onValueChange={(v) => set({ supplier_id: v })}
            >
              <SelectTrigger className="mt-1 h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Tedarikçisiz (fiş vb.)</SelectItem>
                <SelectItem value={NEW}>+ Yeni tedarikçi</SelectItem>
                {data.suppliers
                  .filter((s) => s.is_active || s.id === f.supplier_id)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {f.supplier_id === NEW ? (
            <>
              <Field label="Tedarikçi adı / unvanı">
                <Input
                  value={f.new_supplier_name}
                  maxLength={250}
                  onChange={(e) => set({ new_supplier_name: e.target.value })}
                  className="h-11"
                />
              </Field>
              <Field label="Vergi no / TCKN (isteğe bağlı)">
                <Input
                  value={f.new_supplier_tax_no}
                  inputMode="numeric"
                  maxLength={11}
                  onChange={(e) => set({ new_supplier_tax_no: e.target.value })}
                  className="h-11"
                />
              </Field>
            </>
          ) : null}
          <Field label="Belge türü">
            <Select
              value={f.document_type}
              onValueChange={(v) => set({ document_type: v as DocumentType })}
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(documentTypeLabels).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Belge no">
            <Input
              value={f.document_no}
              maxLength={60}
              onChange={(e) => set({ document_no: e.target.value })}
              className="h-11"
            />
          </Field>
          <Field label="Belge tarihi">
            <Input
              type="date"
              value={f.issue_date}
              onChange={(e) => set({ issue_date: e.target.value })}
              className="h-11"
            />
          </Field>
          <Field label="Son ödeme tarihi">
            <Input
              type="date"
              value={f.due_date}
              onChange={(e) => set({ due_date: e.target.value })}
              className="h-11"
            />
          </Field>
          <Field label="Kategori">
            <Select
              value={f.category}
              onValueChange={(v) => set({ category: v as ExpenseCategory })}
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(expenseCategoryLabels).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Proje (maliyete yazılır)">
            <Select
              value={f.project_id}
              onValueChange={(v) => set({ project_id: v })}
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Genel gider</SelectItem>
                {data.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Açıklama" className="sm:col-span-2">
            <Input
              value={f.description}
              maxLength={500}
              placeholder="örn. 300 m 3x4 NYY kablo"
              onChange={(e) => set({ description: e.target.value })}
              className="h-11"
            />
          </Field>
          <Field label="Para birimi">
            <Select
              value={f.currency}
              onValueChange={(v) =>
                set({ currency: v as Currency, pay_account_id: NONE })
              }
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TRY">TL</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kur (1 döviz = ? TL)">
            <Input
              value={f.currency === "TRY" ? "1" : f.exchange_rate}
              disabled={f.currency === "TRY"}
              inputMode="decimal"
              onChange={(e) => set({ exchange_rate: e.target.value })}
              className="h-11"
            />
          </Field>
          <Field label="Matrah (KDV hariç)">
            <Input
              value={f.net}
              inputMode="decimal"
              placeholder="0,00"
              onChange={(e) => set({ net: e.target.value })}
              className="h-11"
            />
          </Field>
          <Field label="KDV">
            <div className="flex gap-2">
              <Select
                value={f.vat_rate}
                onValueChange={(v) => set({ vat_rate: v })}
              >
                <SelectTrigger className="h-11 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.2">%20</SelectItem>
                  <SelectItem value="0.1">%10</SelectItem>
                  <SelectItem value="0.01">%1</SelectItem>
                  <SelectItem value="0">%0</SelectItem>
                  <SelectItem value="custom">Elle / karışık</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={f.vat_rate === "custom" ? f.vat : String(vat || "")}
                disabled={f.vat_rate !== "custom"}
                inputMode="decimal"
                onChange={(e) => set({ vat: e.target.value })}
                className="h-11"
              />
            </div>
          </Field>
          <Field label="Tevkif edilen KDV (varsa)">
            <Input
              value={f.withholding}
              inputMode="decimal"
              onChange={(e) => set({ withholding: e.target.value })}
              className="h-11"
            />
          </Field>
          <div className="flex items-end">
            <div className="w-full rounded-xl bg-muted px-3 py-2 text-right">
              <div className="text-[11px] text-muted-foreground">
                Ödenecek toplam
              </div>
              <div className="text-lg font-bold tabular-nums">
                {cur(Number.isFinite(total) ? total : 0, f.currency)}
              </div>
            </div>
          </div>
          <Field label="Belge eki (PDF / fotoğraf)" className="sm:col-span-2">
            <Input
              type="file"
              accept="application/pdf,image/*,.xml"
              onChange={(e) => set({ file: e.target.files?.[0] ?? null })}
              className="h-11"
            />
            {f.attachment_path && !f.file ? (
              <button
                type="button"
                className="mt-1 text-xs text-highlight underline"
                onClick={() =>
                  openFinanceDocument(f.attachment_path as string).catch((e) =>
                    toast.error(errorMessage(e)),
                  )
                }
              >
                Ekli belgeyi aç
              </button>
            ) : null}
          </Field>
          <Field label="Not" className="sm:col-span-2">
            <Textarea
              value={f.notes}
              maxLength={1000}
              rows={2}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </Field>
          {!f.id ? (
            <div className="rounded-xl border border-border p-3 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={f.paid_now}
                  onChange={(e) => set({ paid_now: e.target.checked })}
                />
                Ödendi (aynı gün)
              </label>
              {f.paid_now ? (
                <Select
                  value={f.pay_account_id}
                  onValueChange={(v) => set({ pay_account_id: v })}
                >
                  <SelectTrigger className="mt-2 h-11">
                    <SelectValue placeholder="Hangi hesaptan?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE} disabled>
                      Hangi hesaptan?
                    </SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            className="h-11 font-bold"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({
  bill,
  remaining,
  data,
  onClose,
  onDone,
}: {
  bill: PurchaseBill;
  remaining: number;
  data: AccountingData;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [account, setAccount] = useState(NONE);
  const [amount, setAmount] = useState(String(remaining).replace(".", ","));
  const [date, setDate] = useState(todayIso());
  const accounts = data.accounts.filter(
    (a) => a.is_active && a.currency === bill.currency,
  );
  const pay = useMutation({
    mutationFn: async () => {
      const value = parseAmount(amount);
      if (!(value > 0)) throw new Error("Tutarı yazın.");
      if (account === NONE) throw new Error("Hesabı seçin.");
      const { error } = await supabase.from("cash_transactions").insert({
        account_id: account,
        txn_date: date,
        direction: "cikis",
        amount: Math.round(value * 100) / 100,
        kind: "tedarikci_odeme",
        supplier_id: bill.supplier_id,
        purchase_bill_id: bill.id,
        project_id: bill.project_id,
        description: bill.document_no ?? bill.description,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Ödeme kaydedildi.");
      await onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ödeme kaydet</DialogTitle>
          <DialogDescription>
            Kalan {cur(remaining, bill.currency)}. Kısmi ödeme de girilebilir.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Hesap">
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Hesap seçin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} disabled>
                  Hesap seçin
                </SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tutar">
            <Input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              className="h-11"
            />
          </Field>
          <Field label="Tarih">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-11"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            className="h-11 font-bold"
            disabled={pay.isPending}
            onClick={() => pay.mutate()}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1 block">{label}</Label>
      {children}
    </div>
  );
}
