import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { downloadCsv, errorMessage } from "@/lib/domain";
import {
  money,
  summarize,
  type CurrencySummary,
  type LedgerEntry,
} from "@/lib/ledger";
import { todayIso } from "@/lib/sales";
import { LedgerPanel } from "@/components/ledger/ledger-panel";
import {
  AccessDenied,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/receivables")({
  validateSearch: (search: Record<string, unknown>): { customerId?: string } =>
    typeof search.customerId === "string" && search.customerId
      ? { customerId: search.customerId }
      : {},
  component: ReceivablesPage,
});

const dateTr = (v: string | null) =>
  v ? v.split("-").reverse().join(".") : "-";

function ReceivablesPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { customerId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"open" | "overdue" | "all">("open");

  const pageQuery = useQuery({
    queryKey: ["receivables-page"],
    enabled: isAdmin,
    queryFn: async () => {
      const [entriesResult, customersResult, projectsResult] =
        await Promise.all([
          supabase
            .from("customer_ledger_entries")
            .select(
              "id, customer_id, project_id, entry_type, entry_date, due_date, amount, currency, payment_method, document_no, description",
            ),
          supabase.from("customers").select("id, name").order("name"),
          supabase.from("projects").select("id, name, customer_id"),
        ]);
      if (entriesResult.error) throw entriesResult.error;
      if (customersResult.error) throw customersResult.error;
      if (projectsResult.error) throw projectsResult.error;
      return {
        entries: (entriesResult.data ?? []) as LedgerEntry[],
        customers: customersResult.data ?? [],
        projects: projectsResult.data ?? [],
      };
    },
  });

  const today = todayIso();
  const rows = useMemo(() => {
    const data = pageQuery.data;
    if (!data) return [];
    const byCustomer = new Map<string, LedgerEntry[]>();
    for (const entry of data.entries) {
      const list = byCustomer.get(entry.customer_id) ?? [];
      list.push(entry);
      byCustomer.set(entry.customer_id, list);
    }
    return data.customers.map((customer) => ({
      customer,
      summary: summarize(byCustomer.get(customer.id) ?? [], today),
    }));
  }, [pageQuery.data, today]);

  const totals = useMemo(() => {
    const map = new Map<string, { balance: number; overdue: number }>();
    for (const row of rows) {
      for (const s of row.summary) {
        const t = map.get(s.currency) ?? { balance: 0, overdue: 0 };
        t.balance += Math.max(0, s.balance);
        t.overdue += s.overdue;
        map.set(s.currency, t);
      }
    }
    return [...map.entries()];
  }, [rows]);

  const monthStart = `${today.slice(0, 8)}01`;
  const collectedThisMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of pageQuery.data?.entries ?? []) {
      if (e.entry_type === "tahsilat" && e.entry_date >= monthStart) {
        map.set(e.currency, (map.get(e.currency) ?? 0) + Number(e.amount));
      }
    }
    return [...map.entries()];
  }, [pageQuery.data, monthStart]);

  const visible = rows
    .filter((row) => {
      const hasBalance = row.summary.some((s) => Math.abs(s.balance) > 0.005);
      const hasOverdue = row.summary.some((s) => s.overdue > 0);
      if (filter === "open" && !hasBalance) return false;
      if (filter === "overdue" && !hasOverdue) return false;
      const text = query.trim().toLocaleLowerCase("tr-TR");
      return (
        !text || row.customer.name.toLocaleLowerCase("tr-TR").includes(text)
      );
    })
    .sort((a, b) => {
      const o = (x: CurrencySummary[]) => x.reduce((s, c) => s + c.overdue, 0);
      return o(b.summary) - o(a.summary);
    });

  const selected = customerId
    ? pageQuery.data?.customers.find((c) => c.id === customerId)
    : undefined;

  if (!isAdmin) return <AccessDenied />;
  if (pageQuery.isLoading) return <LoadingState />;
  if (pageQuery.error) {
    return (
      <div className="surface-panel p-6 text-sm text-destructive">
        {errorMessage(pageQuery.error)}
      </div>
    );
  }

  const fmtList = (list: [string, number][]) =>
    list.length === 0
      ? money(0, "TRY")
      : list.map(([cur, v]) => money(v, cur)).join(" + ");

  return (
    <>
      <PageHeader
        title="Cari Hesaplar"
        description="Müşteri bazında fatura, tahsilat ve bakiye. Tahsilatlar en eski faturadan kapatılır; kapanmayan ve vadesi geçen faturalar kırmızı görünür. Resmî muhasebenin yerine geçmez, alacak takibi içindir."
        actions={
          <Button
            variant="outline"
            className="h-11"
            onClick={() =>
              downloadCsv(`cari-hesaplar-${today}.csv`, [
                [
                  "Müşteri",
                  "Para birimi",
                  "Faturalanan",
                  "Tahsil edilen",
                  "Bakiye",
                  "Vadesi geçmiş",
                  "En eski vade",
                  "Son tahsilat",
                ],
                ...rows.flatMap((row) =>
                  row.summary.map((s) => [
                    row.customer.name,
                    s.currency,
                    s.invoiced,
                    s.collected,
                    s.balance,
                    s.overdue,
                    dateTr(s.oldestOverdue),
                    dateTr(s.lastCollection),
                  ]),
                ),
              ])
            }
          >
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="surface-panel p-4">
          <p className="text-xs text-muted-foreground">Toplam alacak</p>
          <p className="mt-1 text-lg font-black">
            {fmtList(totals.map(([c, t]) => [c, t.balance]))}
          </p>
        </div>
        <div className="surface-panel p-4">
          <p className="text-xs text-muted-foreground">Vadesi geçmiş</p>
          <p className="mt-1 text-lg font-black text-destructive">
            {fmtList(totals.map(([c, t]) => [c, t.overdue]))}
          </p>
        </div>
        <div className="surface-panel p-4">
          <p className="text-xs text-muted-foreground">Bu ay tahsilat</p>
          <p className="mt-1 text-lg font-black text-emerald-600">
            {fmtList(collectedThisMonth)}
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Müşteri ara"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select
          value={filter}
          onValueChange={(v) => setFilter(v as typeof filter)}
        >
          <SelectTrigger className="h-10 sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Bakiyesi olanlar</SelectItem>
            <SelectItem value="overdue">Vadesi geçmiş olanlar</SelectItem>
            <SelectItem value="all">Tüm müşteriler</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="surface-panel overflow-hidden">
        {visible.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            {filter === "all"
              ? "Müşteri yok."
              : "Açık bakiye yok. Bir müşteriye fatura veya tahsilat girmek için filtreyi 'Tüm müşteriler' yapıp müşteriye tıklayın."}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((row) => {
              const overdue = row.summary.filter((s) => s.overdue > 0);
              return (
                <button
                  key={row.customer.id}
                  type="button"
                  onClick={() =>
                    void navigate({
                      search: { customerId: row.customer.id },
                      replace: true,
                    })
                  }
                  className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-semibold">{row.customer.name}</span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm">
                    {row.summary.length === 0 ? (
                      <span className="text-muted-foreground">Hareket yok</span>
                    ) : (
                      row.summary.map((s) => (
                        <span
                          key={s.currency}
                          className={`font-bold ${s.balance > 0 ? "" : "text-emerald-600"}`}
                        >
                          {money(s.balance, s.currency)}
                        </span>
                      ))
                    )}
                    {overdue.map((s) => (
                      <span
                        key={s.currency}
                        className="text-xs text-destructive"
                      >
                        vadesi geçmiş {money(s.overdue, s.currency)} ·{" "}
                        {dateTr(s.oldestOverdue)}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) =>
          !open && void navigate({ search: {}, replace: true })
        }
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{selected?.name}</SheetTitle>
            <SheetDescription>Cari hesap hareketleri</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            {selected ? (
              <LedgerPanel
                customerId={selected.id}
                projects={(pageQuery.data?.projects ?? []).filter(
                  (p) => p.customer_id === selected.id,
                )}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
