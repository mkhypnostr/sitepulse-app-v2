// Kasa ve banka: hesaplar, bakiye, hareket listesi, giriş/çıkış ve virman.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import { todayIso } from "@/lib/sales";
import {
  accountKindLabels,
  accountStatement,
  cur,
  expenseCategoryLabels,
  parseAmount,
  type AccountKind,
  type CashAccount,
  type Currency,
} from "@/lib/accounting";
import {
  useRefreshAccounting,
  type AccountingData,
} from "@/lib/accounting-data";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field } from "@/components/accounting/expenses-tab";

const NONE = "__none__";
const dateTr = (v: string) => v.slice(0, 10).split("-").reverse().join(".");

type TxnForm = {
  direction: "giris" | "cikis";
  kind: "gider" | "gelir" | "diger";
  amount: string;
  date: string;
  category: string;
  description: string;
  project_id: string;
};

export function AccountsTab({ data }: { data: AccountingData }) {
  const refresh = useRefreshAccounting();
  const [selected, setSelected] = useState<string | null>(
    data.accounts.find((a) => a.is_active)?.id ?? null,
  );
  const [accountForm, setAccountForm] = useState<
    (Partial<CashAccount> & { opening: string }) | null
  >(null);
  const [txnForm, setTxnForm] = useState<TxnForm | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const statements = useMemo(
    () =>
      new Map(
        data.accounts.map((a) => [
          a.id,
          accountStatement(a, data.txns, data.collections),
        ]),
      ),
    [data.accounts, data.txns, data.collections],
  );
  const account = data.accounts.find((a) => a.id === selected) ?? null;
  const statement = account ? statements.get(account.id) : null;
  const unassigned = data.collections.filter((c) => !c.account_id);

  const saveAccount = useMutation({
    mutationFn: async (f: Partial<CashAccount> & { opening: string }) => {
      if (!f.name?.trim()) throw new Error("Hesap adını yazın.");
      const payload = {
        name: f.name.trim(),
        kind: f.kind ?? "banka",
        currency: f.currency ?? "TRY",
        bank_name: f.bank_name?.trim() || null,
        iban: f.iban?.trim() || null,
        opening_balance: parseAmount(f.opening || "0") || 0,
        opening_date: f.opening_date ?? todayIso(),
        show_on_invoice: !!f.show_on_invoice,
        is_active: f.is_active ?? true,
      };
      const { error } = f.id
        ? await supabase.from("cash_accounts").update(payload).eq("id", f.id)
        : await supabase.from("cash_accounts").insert(payload);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Hesap kaydedildi.");
      setAccountForm(null);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const saveTxn = useMutation({
    mutationFn: async (f: TxnForm) => {
      if (!account) return;
      const value = parseAmount(f.amount);
      if (!(value > 0)) throw new Error("Tutarı yazın.");
      const { error } = await supabase.from("cash_transactions").insert({
        account_id: account.id,
        txn_date: f.date,
        direction: f.direction,
        amount: Math.round(value * 100) / 100,
        kind: f.kind,
        category: f.category === NONE ? null : f.category,
        description: f.description.trim() || null,
        project_id: f.project_id === NONE ? null : f.project_id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Hareket kaydedildi.");
      setTxnForm(null);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const removeTxn = useMutation({
    mutationFn: async (txn: { id: string; transfer_group: string | null }) => {
      const q = supabase.from("cash_transactions").delete();
      const { error } = txn.transfer_group
        ? await q.eq("transfer_group", txn.transfer_group)
        : await q.eq("id", txn.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Hareket silindi.");
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelected(a.id)}
            className={`surface-panel p-4 text-left transition ${selected === a.id ? "ring-2 ring-highlight" : ""} ${a.is_active ? "" : "opacity-60"}`}
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{accountKindLabels[a.kind]}</span>
              <span>{a.currency}</span>
            </div>
            <div className="mt-1 font-semibold">{a.name}</div>
            <div className="mt-1 text-xl font-bold tabular-nums">
              {cur(statements.get(a.id)?.balance ?? 0, a.currency)}
            </div>
            {a.iban ? (
              <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {a.iban}
              </div>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            setAccountForm({
              kind: "banka",
              currency: "TRY",
              opening: "0",
              is_active: true,
            })
          }
          className="surface-panel flex items-center justify-center gap-2 p-4 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-4 w-4" /> Hesap ekle
        </button>
      </div>

      {unassigned.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          {unassigned.length} cari tahsilat henüz bir hesaba bağlı değil;
          kasa/banka bakiyesine girmiyor. Yeni tahsilatlarda Cari Hesaplar
          ekranında hesabı seçin.
        </div>
      ) : null}

      {account && statement ? (
        <div className="surface-panel p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-lg font-bold">{account.name}</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setTxnForm({
                  direction: "giris",
                  kind: "gelir",
                  amount: "",
                  date: todayIso(),
                  category: NONE,
                  description: "",
                  project_id: NONE,
                })
              }
            >
              <ArrowDownLeft className="mr-1 h-4 w-4" /> Para girişi
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setTxnForm({
                  direction: "cikis",
                  kind: "gider",
                  amount: "",
                  date: todayIso(),
                  category: "diger",
                  description: "",
                  project_id: NONE,
                })
              }
            >
              <ArrowUpRight className="mr-1 h-4 w-4" /> Para çıkışı
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTransferOpen(true)}
            >
              <ArrowLeftRight className="mr-1 h-4 w-4" /> Virman
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setAccountForm({
                  ...account,
                  opening: String(account.opening_balance),
                })
              }
            >
              <Pencil className="mr-1 h-4 w-4" /> Düzenle
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Açılış {cur(Number(account.opening_balance), account.currency)} ·{" "}
            {dateTr(account.opening_date)}
          </div>
          {statement.rows.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Bu hesapta hareket yok.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-border">
              {[...statement.rows].reverse().map((r) => (
                <div
                  key={r.key}
                  className="flex items-center gap-3 py-2 text-sm"
                >
                  <div className="w-20 shrink-0 text-xs text-muted-foreground">
                    {dateTr(r.date)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{r.label}</div>
                    {r.detail ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {r.detail}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className={`w-32 text-right font-semibold tabular-nums ${r.amount >= 0 ? "text-emerald-600" : "text-destructive"}`}
                  >
                    {r.amount >= 0 ? "+" : ""}
                    {cur(r.amount, account.currency)}
                  </div>
                  <div className="hidden w-32 text-right text-xs tabular-nums text-muted-foreground sm:block">
                    {cur(r.balance, account.currency)}
                  </div>
                  {r.txn ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      aria-label="Hareketi sil"
                      onClick={() => {
                        if (
                          window.confirm(
                            r.txn?.transfer_group
                              ? "Virmanın iki tarafı da silinsin mi?"
                              : "Bu hareket silinsin mi?",
                          )
                        )
                          removeTxn.mutate(
                            r.txn as {
                              id: string;
                              transfer_group: string | null;
                            },
                          );
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : (
                    <span className="w-8" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {accountForm ? (
        <Dialog open onOpenChange={(o) => (!o ? setAccountForm(null) : null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {accountForm.id ? "Hesabı düzenle" : "Yeni hesap"}
              </DialogTitle>
              <DialogDescription>
                Açılış bakiyesi, bu uygulamaya başladığınız gündeki hesap
                bakiyesidir.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Hesap adı" className="sm:col-span-2">
                <Input
                  value={accountForm.name ?? ""}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, name: e.target.value })
                  }
                  className="h-11"
                />
              </Field>
              <Field label="Tür">
                <Select
                  value={accountForm.kind ?? "banka"}
                  onValueChange={(v) =>
                    setAccountForm({ ...accountForm, kind: v as AccountKind })
                  }
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(accountKindLabels).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Para birimi">
                <Select
                  value={accountForm.currency ?? "TRY"}
                  onValueChange={(v) =>
                    setAccountForm({ ...accountForm, currency: v as Currency })
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
              <Field label="Banka">
                <Input
                  value={accountForm.bank_name ?? ""}
                  onChange={(e) =>
                    setAccountForm({
                      ...accountForm,
                      bank_name: e.target.value,
                    })
                  }
                  className="h-11"
                />
              </Field>
              <Field label="IBAN">
                <Input
                  value={accountForm.iban ?? ""}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, iban: e.target.value })
                  }
                  className="h-11 font-mono"
                />
              </Field>
              <Field label="Açılış bakiyesi">
                <Input
                  value={accountForm.opening}
                  inputMode="decimal"
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, opening: e.target.value })
                  }
                  className="h-11"
                />
              </Field>
              <Field label="Açılış tarihi">
                <Input
                  type="date"
                  value={accountForm.opening_date ?? todayIso()}
                  onChange={(e) =>
                    setAccountForm({
                      ...accountForm,
                      opening_date: e.target.value,
                    })
                  }
                  className="h-11"
                />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={!!accountForm.show_on_invoice}
                  onChange={(e) =>
                    setAccountForm({
                      ...accountForm,
                      show_on_invoice: e.target.checked,
                    })
                  }
                />
                IBAN faturalarda yazsın
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={accountForm.is_active ?? true}
                  onChange={(e) =>
                    setAccountForm({
                      ...accountForm,
                      is_active: e.target.checked,
                    })
                  }
                />
                Aktif
              </label>
            </div>
            <DialogFooter>
              <Button
                className="h-11 font-bold"
                disabled={saveAccount.isPending}
                onClick={() => saveAccount.mutate(accountForm)}
              >
                Kaydet
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {txnForm && account ? (
        <Dialog open onOpenChange={(o) => (!o ? setTxnForm(null) : null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {txnForm.direction === "giris" ? "Para girişi" : "Para çıkışı"}{" "}
                · {account.name}
              </DialogTitle>
              <DialogDescription>
                {txnForm.direction === "giris"
                  ? "Müşteri tahsilatlarını Cari Hesaplar ekranından girin; burası faiz, iade, sermaye gibi diğer girişler içindir."
                  : "Faturası olan giderleri Giderler sekmesinden girin; burası banka masrafı, maaş, vergi ödemesi gibi faturasız çıkışlar içindir."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tutar">
                <Input
                  value={txnForm.amount}
                  inputMode="decimal"
                  onChange={(e) =>
                    setTxnForm({ ...txnForm, amount: e.target.value })
                  }
                  className="h-11"
                />
              </Field>
              <Field label="Tarih">
                <Input
                  type="date"
                  value={txnForm.date}
                  onChange={(e) =>
                    setTxnForm({ ...txnForm, date: e.target.value })
                  }
                  className="h-11"
                />
              </Field>
              {txnForm.direction === "cikis" ? (
                <Field label="Gider kategorisi" className="sm:col-span-2">
                  <Select
                    value={txnForm.category}
                    onValueChange={(v) =>
                      setTxnForm({ ...txnForm, category: v })
                    }
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
              ) : null}
              <Field label="Proje (isteğe bağlı)" className="sm:col-span-2">
                <Select
                  value={txnForm.project_id}
                  onValueChange={(v) =>
                    setTxnForm({ ...txnForm, project_id: v })
                  }
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Projesiz</SelectItem>
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
                  value={txnForm.description}
                  maxLength={500}
                  onChange={(e) =>
                    setTxnForm({ ...txnForm, description: e.target.value })
                  }
                  className="h-11"
                />
              </Field>
            </div>
            <DialogFooter>
              <Button
                className="h-11 font-bold"
                disabled={saveTxn.isPending}
                onClick={() => saveTxn.mutate(txnForm)}
              >
                Kaydet
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {transferOpen && account ? (
        <TransferDialog
          from={account}
          accounts={data.accounts.filter(
            (a) =>
              a.id !== account.id &&
              a.is_active &&
              a.currency === account.currency,
          )}
          onClose={() => setTransferOpen(false)}
          onDone={async () => {
            setTransferOpen(false);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function TransferDialog({
  from,
  accounts,
  onClose,
  onDone,
}: {
  from: CashAccount;
  accounts: CashAccount[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [to, setTo] = useState(NONE);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [desc, setDesc] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const value = parseAmount(amount);
      if (!(value > 0)) throw new Error("Tutarı yazın.");
      if (to === NONE) throw new Error("Hedef hesabı seçin.");
      const group = crypto.randomUUID();
      const base = {
        txn_date: date,
        amount: Math.round(value * 100) / 100,
        kind: "virman" as const,
        transfer_group: group,
        description: desc.trim() || "Virman",
      };
      const { error } = await supabase.from("cash_transactions").insert([
        { ...base, account_id: from.id, direction: "cikis" as const },
        { ...base, account_id: to, direction: "giris" as const },
      ]);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Virman kaydedildi.");
      await onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Virman · {from.name}</DialogTitle>
          <DialogDescription>
            Aynı para birimindeki başka bir hesaba aktarım (ör. bankadan kasaya
            nakit çekme).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Hedef hesap">
            <Select value={to} onValueChange={setTo}>
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
          <Field label="Açıklama">
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="h-11"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            className="h-11 font-bold"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
