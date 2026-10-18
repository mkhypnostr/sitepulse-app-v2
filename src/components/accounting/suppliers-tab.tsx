// Tedarikçiler: kart bilgileri ve borç bakiyesi (alış − ödeme).
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import { cur, supplierBalances } from "@/lib/accounting";
import {
  useRefreshAccounting,
  type AccountingData,
  type Supplier,
} from "@/lib/accounting-data";
import { EmptyState } from "@/components/page-states";
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
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/accounting/expenses-tab";

type Form = Omit<Supplier, "id"> & { id: string | null };

const empty: Form = {
  id: null,
  name: "",
  tax_no: "",
  tax_office: "",
  address: "",
  phone: "",
  email: "",
  iban: "",
  notes: "",
  is_active: true,
};

export function SuppliersTab({ data }: { data: AccountingData }) {
  const refresh = useRefreshAccounting();
  const [q, setQ] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const balances = useMemo(
    () => supplierBalances(data.bills, data.txns),
    [data.bills, data.txns],
  );
  const rows = data.suppliers.filter((s) =>
    `${s.name} ${s.tax_no ?? ""}`
      .toLocaleLowerCase("tr-TR")
      .includes(q.toLocaleLowerCase("tr-TR")),
  );

  const save = useMutation({
    mutationFn: async (f: Form) => {
      const taxNo = (f.tax_no ?? "").replace(/\D/g, "") || null;
      if (!f.name.trim()) throw new Error("Adı yazın.");
      if (taxNo && !/^\d{10,11}$/.test(taxNo))
        throw new Error("Vergi no 10, TCKN 11 hane olmalı.");
      const payload = {
        name: f.name.trim(),
        tax_no: taxNo,
        tax_office: f.tax_office?.trim() || null,
        address: f.address?.trim() || null,
        phone: f.phone?.trim() || null,
        email: f.email?.trim() || null,
        iban: f.iban?.trim() || null,
        notes: f.notes?.trim() || null,
        is_active: f.is_active,
      };
      const { error } = f.id
        ? await supabase.from("suppliers").update(payload).eq("id", f.id)
        : await supabase.from("suppliers").insert(payload);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Tedarikçi kaydedildi.");
      setForm(null);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tedarikçi adı veya vergi no"
            className="h-11 pl-9"
          />
        </div>
        <Button
          className="h-11 font-bold"
          onClick={() => setForm({ ...empty })}
        >
          <Plus className="mr-2 h-4 w-4" /> Yeni tedarikçi
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="Tedarikçi yok"
          description="Malzeme aldığınız firmaları, taşeronları ve hizmet sağlayıcıları ekleyin."
        />
      ) : (
        <div className="surface-panel divide-y divide-border overflow-hidden">
          {rows.map((s) => {
            const b = balances.get(s.id);
            const entries = b
              ? [...b.entries()].filter(([, v]) => Math.abs(v) > 0.005)
              : [];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setForm({ ...s })}
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {s.name}
                    {!s.is_active ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (pasif)
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[s.tax_no, s.phone, s.email].filter(Boolean).join(" · ") ||
                      "-"}
                  </div>
                </div>
                <div className="text-right text-sm font-bold tabular-nums">
                  {entries.length === 0 ? (
                    <span className="text-emerald-600">Borç yok</span>
                  ) : (
                    entries.map(([c, v]) => (
                      <div
                        key={c}
                        className={v > 0 ? "text-amber-600" : "text-sky-600"}
                      >
                        {v > 0 ? "Borcumuz " : "Avans "}
                        {cur(Math.abs(v), c)}
                      </div>
                    ))
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {form ? (
        <Dialog open onOpenChange={(o) => (!o ? setForm(null) : null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {form.id ? "Tedarikçi" : "Yeni tedarikçi"}
              </DialogTitle>
              <DialogDescription>
                Fatura bilgileri ve ödeme yapılacak IBAN.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ad / unvan" className="sm:col-span-2">
                <Input
                  value={form.name}
                  maxLength={250}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="h-11"
                />
              </Field>
              <Field label="Vergi no / TCKN">
                <Input
                  value={form.tax_no ?? ""}
                  inputMode="numeric"
                  maxLength={11}
                  onChange={(e) => setForm({ ...form, tax_no: e.target.value })}
                  className="h-11"
                />
              </Field>
              <Field label="Vergi dairesi">
                <Input
                  value={form.tax_office ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, tax_office: e.target.value })
                  }
                  className="h-11"
                />
              </Field>
              <Field label="Telefon">
                <Input
                  value={form.phone ?? ""}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="h-11"
                />
              </Field>
              <Field label="E-posta">
                <Input
                  value={form.email ?? ""}
                  type="email"
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="h-11"
                />
              </Field>
              <Field label="IBAN" className="sm:col-span-2">
                <Input
                  value={form.iban ?? ""}
                  maxLength={40}
                  onChange={(e) => setForm({ ...form, iban: e.target.value })}
                  className="h-11 font-mono"
                />
              </Field>
              <Field label="Adres" className="sm:col-span-2">
                <Textarea
                  value={form.address ?? ""}
                  rows={2}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                />
              </Field>
              <Field label="Not" className="sm:col-span-2">
                <Textarea
                  value={form.notes ?? ""}
                  rows={2}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                />
                Aktif (listelerde görünsün)
              </label>
            </div>
            <DialogFooter>
              <Button
                className="h-11 font-bold"
                disabled={save.isPending}
                onClick={() => save.mutate(form)}
              >
                Kaydet
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
