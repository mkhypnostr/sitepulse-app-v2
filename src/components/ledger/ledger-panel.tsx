// Müşteri (veya proje) cari hareketleri: özet, hareket listesi, yeni
// fatura/tahsilat kaydı.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import {
  ledgerTypeLabels,
  money,
  openAmounts,
  paymentMethodLabels,
  summarize,
  withRunningBalance,
  type LedgerCurrency,
  type LedgerEntry,
  type LedgerType,
  type PaymentMethod,
} from "@/lib/ledger";
import { todayIso } from "@/lib/sales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LEDGER_SELECT =
  "id, customer_id, project_id, entry_type, entry_date, due_date, amount, currency, payment_method, document_no, description";

const dateTr = (v: string | null) =>
  v ? v.split("-").reverse().join(".") : "-";

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayIso(d);
}

export function LedgerPanel({
  customerId,
  projectId,
  projects,
}: {
  customerId: string;
  /** Verilirse yalnız bu projenin hareketleri gösterilir ve yeni kayıt bu
   * projeye bağlanır. */
  projectId?: string;
  /** Müşteri görünümünde hareketi projeye bağlamak için. */
  projects?: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const today = todayIso();
  const [type, setType] = useState<LedgerType>("fatura");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<LedgerCurrency>("TRY");
  const [entryDate, setEntryDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDays(today, 30));
  const [method, setMethod] = useState<PaymentMethod>("havale");
  const [docNo, setDocNo] = useState("");
  const [desc, setDesc] = useState("");
  const [linkProject, setLinkProject] = useState(projectId ?? "none");

  const key = ["ledger", customerId, projectId ?? "all"];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      let q = supabase
        .from("customer_ledger_entries")
        .select(LEDGER_SELECT)
        .eq("customer_id", customerId);
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q.order("entry_date");
      if (error) throw error;
      return (data ?? []) as LedgerEntry[];
    },
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["ledger"] });
    await queryClient.invalidateQueries({ queryKey: ["receivables-page"] });
  };

  const add = useMutation({
    mutationFn: async () => {
      const value = Number(amount.replace(/\./g, "").replace(",", "."));
      if (!(value > 0)) throw new Error("Tutarı yazın.");
      const { error } = await supabase.from("customer_ledger_entries").insert({
        customer_id: customerId,
        project_id: projectId ?? (linkProject === "none" ? null : linkProject),
        entry_type: type,
        entry_date: entryDate || today,
        due_date: type === "fatura" ? dueDate || null : null,
        amount: value,
        currency,
        payment_method: type === "tahsilat" ? method : null,
        document_no: docNo.trim() || null,
        description: desc.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setAmount("");
      setDocNo("");
      setDesc("");
      await refresh();
      toast.success(`${ledgerTypeLabels[type]} kaydedildi.`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("customer_ledger_entries")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const entries = query.data ?? [];
  const summary = summarize(entries, today);
  const rows = withRunningBalance(entries).reverse();
  const open = openAmounts(entries);
  const projectName = (id: string | null) =>
    id ? (projects?.find((p) => p.id === id)?.name ?? "") : "";

  return (
    <div className="grid gap-4">
      {/* Özet */}
      {summary.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Henüz fatura veya tahsilat kaydı yok.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {summary.map((s) => (
            <div
              key={s.currency}
              className="rounded-md border border-border p-3 text-sm"
            >
              <p className="flex items-baseline justify-between">
                <span className="text-muted-foreground">
                  Bakiye ({s.currency})
                </span>
                <span
                  className={`text-lg font-black ${s.balance > 0 ? "text-amber-600" : s.balance < 0 ? "text-sky-600" : "text-emerald-600"}`}
                >
                  {money(s.balance, s.currency)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Faturalanan {money(s.invoiced, s.currency)} · tahsil edilen{" "}
                {money(s.collected, s.currency)}
              </p>
              {s.overdue > 0 ? (
                <p className="mt-1 text-xs font-semibold text-destructive">
                  Vadesi geçmiş: {money(s.overdue, s.currency)} (en eski vade{" "}
                  {dateTr(s.oldestOverdue)})
                </p>
              ) : null}
              {s.balance < 0 ? (
                <p className="mt-1 text-xs text-sky-600">
                  Müşteri fazla ödemiş (avans).
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Yeni kayıt */}
      <div className="grid gap-2 rounded-md border border-border p-3">
        <div className="flex flex-wrap gap-1.5">
          {(["fatura", "tahsilat", "iade", "acilis"] as LedgerType[]).map(
            (t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={type === t ? "default" : "outline"}
                onClick={() => setType(t)}
              >
                {ledgerTypeLabels[t]}
              </Button>
            ),
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_96px_150px]">
          <Input
            inputMode="decimal"
            placeholder="Tutar (KDV dahil)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Select
            value={currency}
            onValueChange={(v) => setCurrency(v as LedgerCurrency)}
          >
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TRY">TL</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            title="İşlem tarihi"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {type === "fatura" ? (
            <label className="grid gap-1 text-xs">
              Vade tarihi
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
          ) : type === "tahsilat" ? (
            <label className="grid gap-1 text-xs">
              Ödeme şekli
              <Select
                value={method}
                onValueChange={(v) => setMethod(v as PaymentMethod)}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(paymentMethodLabels).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : (
            <span />
          )}
          <label className="grid gap-1 text-xs">
            Belge no (fatura / dekont)
            <Input
              value={docNo}
              maxLength={60}
              onChange={(e) => setDocNo(e.target.value)}
            />
          </label>
        </div>
        {!projectId && projects && projects.length > 0 ? (
          <Select value={linkProject} onValueChange={setLinkProject}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Projeye bağlı değil</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="flex gap-2">
          <Input
            placeholder="Açıklama (ör. %50 avans faturası)"
            maxLength={500}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <Button
            type="button"
            onClick={() => add.mutate()}
            disabled={add.isPending}
            className="shrink-0"
          >
            <Plus className="mr-1.5 h-4 w-4" /> Kaydet
          </Button>
        </div>
      </div>

      {/* Hareketler */}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-2">Tarih</th>
                <th className="pr-2">İşlem</th>
                <th className="pr-2 text-right">Tutar</th>
                <th className="pr-2 text-right">Bakiye</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border/60 align-top"
                >
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {dateTr(row.entry_date)}
                  </td>
                  <td className="pr-2">
                    <span className="font-medium">
                      {ledgerTypeLabels[row.entry_type]}
                    </span>
                    {row.document_no ? ` · ${row.document_no}` : ""}
                    {row.entry_type === "fatura" && row.due_date ? (
                      <span
                        className={`block text-xs ${(open.get(row.id) ?? 0) <= 0 ? "text-emerald-600" : row.due_date < today ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                      >
                        {(open.get(row.id) ?? 0) <= 0
                          ? "Kapandı"
                          : `Vade ${dateTr(row.due_date)}${(open.get(row.id) ?? 0) < Number(row.amount) ? ` · açık ${money(open.get(row.id) ?? 0, row.currency)}` : ""}`}
                      </span>
                    ) : null}
                    {row.payment_method ? (
                      <span className="block text-xs text-muted-foreground">
                        {paymentMethodLabels[
                          row.payment_method as PaymentMethod
                        ] ?? row.payment_method}
                      </span>
                    ) : null}
                    {row.description || projectName(row.project_id) ? (
                      <span className="block text-xs text-muted-foreground">
                        {[projectName(row.project_id), row.description]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={`pr-2 text-right whitespace-nowrap ${row.entry_type === "tahsilat" || row.entry_type === "iade" ? "text-emerald-600" : ""}`}
                  >
                    {row.entry_type === "tahsilat" || row.entry_type === "iade"
                      ? "−"
                      : ""}
                    {money(Number(row.amount), row.currency)}
                  </td>
                  <td className="pr-2 text-right whitespace-nowrap font-semibold">
                    {money(row.balance, row.currency)}
                  </td>
                  <td>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Kaydı sil"
                      onClick={() => {
                        if (window.confirm("Bu hareket silinsin mi?"))
                          remove.mutate(row.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
