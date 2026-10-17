// Trafo Sorumluluğu firmaları ve Ölçüm kayıtlarındaki müşteri adları, müşteri
// listesindeki bir müşteriye bağlanır. Bağlanınca o kayıtların fatura ve
// tahsilatları cari hesapta görünür (customer_ledger_feed).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Link2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SourceRow = {
  key: string;
  kind: "trafo" | "olcum";
  name: string;
  customerId: string | null;
  /** Trafo: firma id. Ölçüm: aynı adlı kayıtların id'leri. */
  ids: string[];
};

const NONE = "__none__";

export function LedgerSourceLinks({
  customers,
}: {
  customers: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ["ledger-source-links"],
    queryFn: async () => {
      const [companies, measurements] = await Promise.all([
        supabase
          .from("transformer_companies")
          .select("id, company_name, customer_id")
          .order("company_name"),
        supabase
          .from("measurement_service_records")
          .select("id, customer_name, customer_id"),
      ]);
      if (companies.error) throw companies.error;
      if (measurements.error) throw measurements.error;
      const rows: SourceRow[] = (companies.data ?? []).map((c) => ({
        key: `trafo-${c.id}`,
        kind: "trafo",
        name: c.company_name,
        customerId: c.customer_id,
        ids: [c.id],
      }));
      const byName = new Map<string, SourceRow>();
      for (const m of measurements.data ?? []) {
        const name = m.customer_name.trim();
        const key = `olcum-${name.toLocaleLowerCase("tr-TR")}-${m.customer_id ?? ""}`;
        const row = byName.get(key) ?? {
          key,
          kind: "olcum" as const,
          name,
          customerId: m.customer_id,
          ids: [],
        };
        row.ids.push(m.id);
        byName.set(key, row);
      }
      return [...rows, ...byName.values()];
    },
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["ledger-source-links"] });
    await queryClient.invalidateQueries({ queryKey: ["receivables-page"] });
    await queryClient.invalidateQueries({ queryKey: ["ledger"] });
  };

  const link = useMutation({
    mutationFn: async ({
      row,
      customerId,
    }: {
      row: SourceRow;
      customerId: string | null;
    }) => {
      const { error } =
        row.kind === "trafo"
          ? await supabase
              .from("transformer_companies")
              .update({ customer_id: customerId })
              .in("id", row.ids)
          : await supabase
              .from("measurement_service_records")
              .update({ customer_id: customerId })
              .in("id", row.ids);
      if (error) throw error;
    },
    onSuccess: async (_, { customerId }) => {
      await refresh();
      toast.success(
        customerId ? "Cari hesaba bağlandı." : "Bağlantı kaldırıldı.",
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const createAndLink = useMutation({
    mutationFn: async (row: SourceRow) => {
      const { data, error } = await supabase
        .from("customers")
        .insert({ name: row.name })
        .select("id")
        .single();
      if (error) throw error;
      await link.mutateAsync({ row, customerId: data.id });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const rows = query.data ?? [];
  if (rows.length === 0) return null;
  const unlinked = rows.filter((r) => !r.customerId).length;

  return (
    <section className="surface-panel mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/50"
        aria-expanded={open}
      >
        <span className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Link2 className="h-4 w-4" />
          </span>
          <span>
            <span className="block font-bold">Trafo ve ölçüm tahsilatları</span>
            <span className="block text-xs text-muted-foreground">
              {unlinked > 0
                ? `${unlinked} kayıt henüz bir müşteriye bağlı değil; bağlanınca faturaları ve tahsilatları cari hesapta görünür.`
                : "Hepsi müşterilere bağlı; faturalar ve tahsilatlar cari hesapta."}
            </span>
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="divide-y divide-border border-t">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold">{row.name}</div>
                <div className="text-xs text-muted-foreground">
                  {row.kind === "trafo"
                    ? "Trafo Sorumluluğu firması"
                    : `Ölçüm kaydı (${row.ids.length})`}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={row.customerId ?? NONE}
                  onValueChange={(value) =>
                    link.mutate({
                      row,
                      customerId: value === NONE ? null : value,
                    })
                  }
                  disabled={link.isPending || createAndLink.isPending}
                >
                  <SelectTrigger className="h-10 w-full sm:w-60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Bağlı değil</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!row.customerId ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    disabled={link.isPending || createAndLink.isPending}
                    onClick={() => createAndLink.mutate(row)}
                    title="Bu adla yeni müşteri oluştur ve bağla"
                  >
                    <UserPlus className="mr-1.5 h-4 w-4" /> Müşteri olarak ekle
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
