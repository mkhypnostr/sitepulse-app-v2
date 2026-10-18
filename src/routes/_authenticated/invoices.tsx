import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  Plus,
  Printer,
  Receipt,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { todayIso } from "@/lib/sales";
import {
  GIB_PORTALS,
  invoiceHtml,
  invoiceMoney,
  invoiceProfileLabels,
  invoiceStatusLabels,
  invoiceTotals,
  invoiceTypeLabels,
  invoiceUblXml,
  invoiceUnits,
  isTckn,
  lineAmounts,
  vatRates,
  withholdingOptions,
  type InvoiceCurrency,
  type InvoiceHeader,
  type InvoiceLineInput,
  type InvoiceProfile,
  type InvoiceStatus,
  type InvoiceType,
} from "@/lib/invoice";
import {
  AccessDenied,
  EmptyState,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

// Faturalar: hazırla → GİB'de kes (ücretsiz GİB portalı ya da entegratör) →
// GİB numarası/ETTN ile "kesildi" olarak arşivle. Kesilen fatura cari hesaba
// borç olarak düşer (customer_ledger_feed). Yalnız yönetici.
export const Route = createFileRoute("/_authenticated/invoices")({
  validateSearch: (search: Record<string, unknown>): { fromOffer?: string } =>
    typeof search.fromOffer === "string" && search.fromOffer
      ? { fromOffer: search.fromOffer }
      : {},
  component: InvoicesPage,
});

type InvoiceRow = InvoiceHeader & {
  id: string;
  customer_id: string;
  project_id: string | null;
  offer_id: string | null;
  payable_total: number;
  created_at: string;
  cancel_reason: string | null;
};

type Customer = {
  id: string;
  name: string;
  contact: string | null;
  billing_title: string | null;
  tax_office: string | null;
  tax_no: string | null;
  billing_address: string | null;
};

type Draft = {
  id: string | null;
  header: InvoiceHeader;
  customer_id: string;
  project_id: string | null;
  offer_id: string | null;
  lines: InvoiceLineInput[];
};

const NONE = "__none__";

const dateTr = (v: string | null) =>
  v ? v.slice(0, 10).split("-").reverse().join(".") : "-";

const emptyLine = (): InvoiceLineInput => ({
  description: "",
  quantity: 1,
  unit: "Adet",
  unit_price: 0,
  discount_rate: 0,
  vat_rate: 0.2,
});

function newDraft(): Draft {
  return {
    id: null,
    customer_id: "",
    project_id: null,
    offer_id: null,
    lines: [emptyLine()],
    header: {
      draft_no: null,
      status: "taslak",
      profile: "TICARIFATURA",
      invoice_type: "SATIS",
      buyer_title: "",
      buyer_tax_no: null,
      buyer_tax_office: null,
      buyer_address: null,
      buyer_email: null,
      issue_date: todayIso(),
      due_date: null,
      currency: "TRY",
      exchange_rate: 1,
      withholding_code: null,
      withholding_rate: 0,
      exemption_code: null,
      exemption_reason: null,
      notes: null,
      ettn: crypto.randomUUID(),
      gib_invoice_no: null,
      issued_at: null,
    },
  };
}

const statusTone: Record<InvoiceStatus, string> = {
  taslak:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  kesildi:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200",
  iptal: "bg-zinc-200 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-300",
};

const INVOICE_COLUMNS =
  "id, draft_no, status, profile, invoice_type, customer_id, project_id, offer_id, buyer_title, buyer_tax_no, buyer_tax_office, buyer_address, buyer_email, issue_date, due_date, currency, exchange_rate, withholding_code, withholding_rate, exemption_code, exemption_reason, notes, ettn, gib_invoice_no, issued_at, payable_total, created_at, cancel_reason";

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function InvoicesPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const { fromOffer } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>(
    "all",
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [offerPickerOpen, setOfferPickerOpen] = useState(false);

  const dataQuery = useQuery({
    queryKey: ["invoices-page"],
    enabled: isAdmin,
    queryFn: async () => {
      const [invoices, customers, projects, offers] = await Promise.all([
        supabase
          .from("invoices")
          .select(INVOICE_COLUMNS)
          .order("issue_date", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("customers")
          .select(
            "id, name, contact, billing_title, tax_office, tax_no, billing_address",
          )
          .order("name"),
        supabase.from("projects").select("id, name, customer_id").order("name"),
        supabase
          .from("offers")
          .select(
            "id, offer_no, title, status, customer_id, project_id, currency, vat_rate, total_amount, primary_item_description, primary_item_quantity, primary_item_unit, exchange_rates",
          )
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (invoices.error) throw invoices.error;
      if (customers.error) throw customers.error;
      if (projects.error) throw projects.error;
      if (offers.error) throw offers.error;
      return {
        invoices: (invoices.data ?? []) as unknown as InvoiceRow[],
        customers: (customers.data ?? []) as Customer[],
        projects: projects.data ?? [],
        offers: offers.data ?? [],
      };
    },
  });

  const customers = useMemo(
    () => dataQuery.data?.customers ?? [],
    [dataQuery.data],
  );
  const customerName = useMemo(
    () => new Map(customers.map((c) => [c.id, c.name])),
    [customers],
  );

  function draftFromOffer(offerId: string) {
    const offer = dataQuery.data?.offers.find((o) => o.id === offerId);
    if (!offer) return;
    const d = newDraft();
    const customer = customers.find((c) => c.id === offer.customer_id);
    d.offer_id = offer.id;
    d.project_id = offer.project_id;
    if (customer) applyCustomer(d, customer);
    d.header.currency = (offer.currency ?? "TRY") as InvoiceCurrency;
    const rates = (offer.exchange_rates ?? {}) as Record<string, number>;
    if (d.header.currency !== "TRY" && Number(rates[d.header.currency]) > 0) {
      d.header.exchange_rate = Number(rates[d.header.currency]);
    }
    const qty = Number(offer.primary_item_quantity) || 1;
    const vat = Number(offer.vat_rate);
    d.lines = [
      {
        description: (offer.primary_item_description || offer.title).slice(
          0,
          300,
        ),
        quantity: qty,
        unit: unitFromOffer(offer.primary_item_unit),
        unit_price: Math.round((Number(offer.total_amount) / qty) * 100) / 100,
        discount_rate: 0,
        vat_rate: (vatRates as readonly number[]).includes(vat) ? vat : 0.2,
      },
    ];
    d.header.notes = `${offer.offer_no} numaralı teklif`;
    setDraft(d);
  }

  // Teklifler sayfasından "Fatura oluştur" ile gelindiyse.
  useEffect(() => {
    if (!fromOffer || !dataQuery.data) return;
    draftFromOffer(fromOffer);
    navigate({ search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromOffer, dataQuery.data]);

  async function openInvoice(row: InvoiceRow) {
    const { data, error } = await supabase
      .from("invoice_lines")
      .select(
        "description, quantity, unit, unit_price, discount_rate, vat_rate, position",
      )
      .eq("invoice_id", row.id)
      .order("position");
    if (error) {
      toast.error(errorMessage(error));
      return;
    }
    const { id, customer_id, project_id, offer_id, ...rest } = row;
    setDraft({
      id,
      customer_id,
      project_id,
      offer_id,
      header: rest,
      lines: (data ?? []).map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unit: l.unit,
        unit_price: Number(l.unit_price),
        discount_rate: Number(l.discount_rate),
        vat_rate: Number(l.vat_rate),
      })),
    });
  }

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    return (dataQuery.data?.invoices ?? []).filter((inv) => {
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (!q) return true;
      return [inv.buyer_title, inv.gib_invoice_no, inv.draft_no, inv.notes]
        .filter(Boolean)
        .some((v) => String(v).toLocaleLowerCase("tr-TR").includes(q));
    });
  }, [dataQuery.data, query, statusFilter]);

  const summary = useMemo(() => {
    const list = dataQuery.data?.invoices ?? [];
    const monthStart = `${todayIso().slice(0, 8)}01`;
    const thisMonth = new Map<string, number>();
    for (const inv of list) {
      if (inv.status === "kesildi" && inv.issue_date >= monthStart) {
        thisMonth.set(
          inv.currency,
          (thisMonth.get(inv.currency) ?? 0) + Number(inv.payable_total),
        );
      }
    }
    return {
      drafts: list.filter((i) => i.status === "taslak").length,
      issued: list.filter((i) => i.status === "kesildi").length,
      thisMonth: [...thisMonth.entries()],
    };
  }, [dataQuery.data]);

  if (!isAdmin) return <AccessDenied />;
  if (dataQuery.isLoading)
    return <LoadingState label="Faturalar yükleniyor..." />;
  if (dataQuery.error) {
    return (
      <div className="surface-panel p-6 text-sm text-destructive">
        {errorMessage(dataQuery.error)}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Faturalar"
        description="Faturayı burada hazırlayın, GİB portalında ücretsiz kesin, GİB numarasıyla arşivleyin. Kesilen fatura cari hesaba borç olarak düşer."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setOfferPickerOpen(true)}
            >
              <FilePlus2 className="mr-2 h-4 w-4" /> Tekliften fatura
            </Button>
            <Button
              className="h-11 font-bold"
              onClick={() => setDraft(newDraft())}
            >
              <Plus className="mr-2 h-4 w-4" /> Yeni fatura
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="surface-panel p-4">
          <div className="text-xs text-muted-foreground">Bu ay kesilen</div>
          <div className="mt-1 text-xl font-bold">
            {summary.thisMonth.length
              ? summary.thisMonth
                  .map(([cur, v]) => invoiceMoney(v, cur as InvoiceCurrency))
                  .join(" · ")
              : "-"}
          </div>
        </div>
        <div className="surface-panel p-4">
          <div className="text-xs text-muted-foreground">Taslak</div>
          <div className="mt-1 text-xl font-bold">{summary.drafts}</div>
        </div>
        <div className="surface-panel p-4">
          <div className="text-xs text-muted-foreground">Kesilen (toplam)</div>
          <div className="mt-1 text-xl font-bold">{summary.issued}</div>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Müşteri, fatura no veya not ara"
            className="h-11 pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="h-11 sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tümü</SelectItem>
            <SelectItem value="taslak">Taslaklar</SelectItem>
            <SelectItem value="kesildi">Kesilenler</SelectItem>
            <SelectItem value="iptal">İptaller</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Henüz fatura yok"
          description="Yeni fatura oluşturun ya da kabul edilmiş bir tekliften fatura hazırlayın."
        />
      ) : (
        <div className="surface-panel divide-y divide-border overflow-hidden">
          {rows.map((inv) => (
            <button
              key={inv.id}
              type="button"
              onClick={() => openInvoice(inv)}
              className="flex w-full flex-col gap-2 p-4 text-left transition hover:bg-muted/50 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">
                    {inv.gib_invoice_no ?? inv.draft_no}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone[inv.status]}`}
                  >
                    {invoiceStatusLabels[inv.status]}
                  </span>
                  <Badge variant="outline" className="text-[11px]">
                    {invoiceProfileLabels[inv.profile]}
                  </Badge>
                  {inv.invoice_type !== "SATIS" ? (
                    <Badge variant="outline" className="text-[11px]">
                      {invoiceTypeLabels[inv.invoice_type]}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 truncate font-semibold">
                  {inv.buyer_title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {dateTr(inv.issue_date)}
                  {inv.due_date ? ` · vade ${dateTr(inv.due_date)}` : ""}
                  {customerName.get(inv.customer_id) &&
                  customerName.get(inv.customer_id) !== inv.buyer_title
                    ? ` · ${customerName.get(inv.customer_id)}`
                    : ""}
                </div>
              </div>
              <div className="text-right text-lg font-bold tabular-nums">
                {invoiceMoney(Number(inv.payable_total), inv.currency)}
              </div>
            </button>
          ))}
        </div>
      )}

      <OfferPicker
        open={offerPickerOpen}
        onOpenChange={setOfferPickerOpen}
        offers={dataQuery.data?.offers ?? []}
        customerName={customerName}
        onPick={(id) => {
          setOfferPickerOpen(false);
          draftFromOffer(id);
        }}
      />

      {draft ? (
        <InvoiceEditor
          key={draft.id ?? draft.header.ettn}
          initial={draft}
          customers={customers}
          projects={dataQuery.data?.projects ?? []}
          onClose={() => setDraft(null)}
          onSaved={async (id) => {
            await queryClient.invalidateQueries({
              queryKey: ["invoices-page"],
            });
            await queryClient.invalidateQueries({
              queryKey: ["receivables-page"],
            });
            const fresh = (
              queryClient.getQueryData(["invoices-page"]) as
                { invoices: InvoiceRow[] } | undefined
            )?.invoices.find((i) => i.id === id);
            if (fresh) await openInvoice(fresh);
          }}
          onDeleted={async () => {
            setDraft(null);
            await queryClient.invalidateQueries({
              queryKey: ["invoices-page"],
            });
          }}
        />
      ) : null}
    </>
  );
}

function unitFromOffer(unit: string | null) {
  const u = (unit ?? "").toLocaleLowerCase("tr-TR");
  if (u.startsWith("set")) return "Set";
  if (u.startsWith("m²") || u === "m2") return "m²";
  if (u === "m" || u.startsWith("metre")) return "Metre";
  if (u.startsWith("kwp")) return "kWp";
  if (u.startsWith("saat")) return "Saat";
  return "Adet";
}

function applyCustomer(d: Draft, customer: Customer) {
  d.customer_id = customer.id;
  d.header.buyer_title = (customer.billing_title || customer.name).slice(
    0,
    250,
  );
  const taxNo = (customer.tax_no ?? "").replace(/\D/g, "");
  d.header.buyer_tax_no = /^\d{10,11}$/.test(taxNo) ? taxNo : null;
  d.header.buyer_tax_office = customer.tax_office;
  d.header.buyer_address = customer.billing_address;
  const email = customer.contact?.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0];
  d.header.buyer_email = email ?? null;
  // 11 hane TCKN → çoğunlukla e-Fatura mükellefi değil (e-Arşiv).
  if (isTckn(d.header.buyer_tax_no)) d.header.profile = "EARSIVFATURA";
}

function OfferPicker({
  open,
  onOpenChange,
  offers,
  customerName,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  offers: {
    id: string;
    offer_no: string;
    title: string;
    status: string;
    customer_id: string | null;
    total_amount: number;
    currency: string;
  }[];
  customerName: Map<string, string>;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = offers
    .filter((o) => o.customer_id)
    .filter((o) =>
      `${o.offer_no} ${o.title} ${customerName.get(o.customer_id ?? "") ?? ""}`
        .toLocaleLowerCase("tr-TR")
        .includes(q.toLocaleLowerCase("tr-TR")),
    )
    .slice(0, 40);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Tekliften fatura</DialogTitle>
          <DialogDescription>
            Teklifin müşterisi, tutarı, KDV oranı ve para birimiyle taslak
            fatura açılır; satırları dilediğiniz gibi bölebilirsiniz.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Teklif no, başlık veya müşteri"
          className="h-11"
        />
        <div className="max-h-[55vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {list.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              Müşterisi seçili teklif bulunamadı.
            </div>
          ) : (
            list.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onPick(o.id)}
                className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs">{o.offer_no}</div>
                  <div className="truncate text-sm font-semibold">
                    {o.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {customerName.get(o.customer_id ?? "")}
                  </div>
                </div>
                <div className="text-sm font-bold tabular-nums">
                  {invoiceMoney(
                    Number(o.total_amount),
                    (o.currency ?? "TRY") as InvoiceCurrency,
                  )}
                  <div className="text-right text-[10px] font-normal text-muted-foreground">
                    + KDV
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Yazdırılabilir önizleme kum havuzunda (sandbox) çalışır; "PDF / Yazdır"
 * düğmesi mesajla yazdırır. */
const FRAME_SCRIPT =
  "<script>(function(){function f(){var w=window.innerWidth;document.body.style.zoom=w<840?String(w/840):'';}f();addEventListener('resize',f);addEventListener('message',function(e){if(e.data==='nes-print')window.print();});})();</script>";

function InvoiceEditor({
  initial,
  customers,
  projects,
  onClose,
  onSaved,
  onDeleted,
}: {
  initial: Draft;
  customers: Customer[];
  projects: { id: string; name: string; customer_id: string | null }[];
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [dirty, setDirty] = useState(initial.id === null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const editable = d.header.status === "taslak";
  const h = d.header;

  const update = (patch: Partial<InvoiceHeader>) => {
    setD((prev) => ({ ...prev, header: { ...prev.header, ...patch } }));
    setDirty(true);
  };
  const updateLine = (index: number, patch: Partial<InvoiceLineInput>) => {
    setD((prev) => ({
      ...prev,
      lines: prev.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }));
    setDirty(true);
  };

  const totals = invoiceTotals(d.lines, h.invoice_type, h.withholding_rate);
  const customerProjects = projects.filter(
    (p) => !d.customer_id || p.customer_id === d.customer_id,
  );

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!d.customer_id) list.push("Müşteri seçin.");
    if (!h.buyer_title.trim()) list.push("Alıcı unvanı boş.");
    if (!h.buyer_tax_no)
      list.push("Alıcının VKN (10 hane) ya da TCKN (11 hane) numarası eksik.");
    if (h.profile !== "EARSIVFATURA" && isTckn(h.buyer_tax_no))
      list.push(
        "TCKN'li alıcı genellikle e-Fatura mükellefi değildir; senaryoyu e-Arşiv yapın (GİB mükellef sorgusundan emin olun).",
      );
    if (!h.buyer_address?.trim()) list.push("Alıcı adresi boş.");
    if (d.lines.length === 0) list.push("En az bir satır ekleyin.");
    d.lines.forEach((l, i) => {
      if (!l.description.trim()) list.push(`${i + 1}. satırın adı boş.`);
      if (!(Number(l.quantity) > 0)) list.push(`${i + 1}. satırın miktarı 0.`);
    });
    if (h.invoice_type === "TEVKIFAT" && !h.withholding_code)
      list.push("Tevkifat kodunu seçin.");
    if (h.invoice_type === "ISTISNA" && !h.exemption_code)
      list.push("İstisna kodu ve gerekçesini yazın.");
    if (h.currency !== "TRY" && !(Number(h.exchange_rate) > 1))
      list.push("Döviz kurunu girin.");
    return list;
  }, [d, h]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        customer_id: d.customer_id,
        project_id: d.project_id,
        offer_id: d.offer_id,
        profile: h.profile,
        invoice_type: h.invoice_type,
        buyer_title: h.buyer_title.trim(),
        buyer_tax_no: h.buyer_tax_no || null,
        buyer_tax_office: h.buyer_tax_office?.trim() || null,
        buyer_address: h.buyer_address?.trim() || null,
        buyer_email: h.buyer_email?.trim() || null,
        issue_date: h.issue_date,
        due_date: h.due_date || null,
        currency: h.currency,
        exchange_rate: h.currency === "TRY" ? 1 : Number(h.exchange_rate) || 1,
        withholding_code:
          h.invoice_type === "TEVKIFAT" ? h.withholding_code : null,
        withholding_rate:
          h.invoice_type === "TEVKIFAT" ? Number(h.withholding_rate) : 0,
        exemption_code: h.invoice_type === "ISTISNA" ? h.exemption_code : null,
        exemption_reason:
          h.invoice_type === "ISTISNA" ? h.exemption_reason : null,
        notes: h.notes?.trim() || null,
      };
      if (!payload.customer_id) throw new Error("Müşteri seçin.");
      if (!payload.buyer_title) throw new Error("Alıcı unvanı boş.");
      let id = d.id;
      if (!id) {
        const { data, error } = await supabase
          .from("invoices")
          .insert({ ...payload, ettn: h.ettn })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
      } else {
        const { error } = await supabase
          .from("invoices")
          .update(payload)
          .eq("id", id);
        if (error) throw error;
        const del = await supabase
          .from("invoice_lines")
          .delete()
          .eq("invoice_id", id);
        if (del.error) throw del.error;
      }
      const lines = d.lines
        .filter((l) => l.description.trim() && Number(l.quantity) > 0)
        .map((l, i) => ({
          invoice_id: id as string,
          position: i + 1,
          description: l.description.trim().slice(0, 300),
          quantity: Number(l.quantity),
          unit: l.unit,
          unit_price: Number(l.unit_price) || 0,
          discount_rate: Math.min(
            Math.max(Number(l.discount_rate) || 0, 0),
            0.99,
          ),
          vat_rate: Number(l.vat_rate),
        }));
      if (lines.length) {
        const ins = await supabase.from("invoice_lines").insert(lines);
        if (ins.error) throw ins.error;
      }
      return id as string;
    },
    onSuccess: async (id) => {
      toast.success("Fatura taslağı kaydedildi.");
      setDirty(false);
      await onSaved(id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!d.id) return;
      const { error } = await supabase.from("invoices").delete().eq("id", d.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Taslak silindi.");
      await onDeleted();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const fileBase = (h.gib_invoice_no ?? h.draft_no ?? "fatura").replace(
    /[^\w-]/g,
    "_",
  );

  return (
    <Sheet open onOpenChange={(open) => (!open ? onClose() : null)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {h.gib_invoice_no ?? h.draft_no ?? "Yeni fatura"}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone[h.status]}`}
            >
              {invoiceStatusLabels[h.status]}
            </span>
          </SheetTitle>
          <SheetDescription>
            {editable
              ? "Bilgileri doldurun, kaydedin; sonra “GİB’de kes” adımlarıyla faturayı kesip numarasını buraya girin."
              : h.status === "kesildi"
                ? `GİB'de kesildi${h.issued_at ? ` · ${dateTr(h.issued_at)}` : ""}. Kesilen fatura değiştirilemez; hata varsa iptal edip yenisini kesin.`
                : "İptal edildi; kayıt arşivde kalır."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-wrap gap-2">
          {editable ? (
            <>
              <Button
                className="h-10 font-bold"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Kaydediliyor..." : "Kaydet"}
              </Button>
              <Button
                variant="outline"
                className="h-10"
                disabled={dirty || !d.id || problems.length > 0}
                title={
                  dirty
                    ? "Önce kaydedin"
                    : problems.length
                      ? "Eksikleri tamamlayın"
                      : undefined
                }
                onClick={() => setIssueOpen(true)}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> GİB’de kes
              </Button>
            </>
          ) : null}
          <Button
            variant="outline"
            className="h-10"
            onClick={() => setPreviewOpen(true)}
          >
            <Printer className="mr-2 h-4 w-4" /> Görüntüle / PDF
          </Button>
          <Button
            variant="outline"
            className="h-10"
            onClick={() =>
              downloadText(
                `${fileBase}.xml`,
                invoiceUblXml(h, d.lines),
                "application/xml",
              )
            }
          >
            <Download className="mr-2 h-4 w-4" /> UBL-TR XML
          </Button>
          {editable && d.id ? (
            <Button
              variant="ghost"
              className="h-10 text-destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm("Bu taslak fatura silinsin mi?"))
                  remove.mutate();
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Taslağı sil
            </Button>
          ) : null}
          {h.status === "kesildi" ? (
            <Button
              variant="ghost"
              className="h-10 text-destructive"
              onClick={() => setCancelOpen(true)}
            >
              <Ban className="mr-2 h-4 w-4" /> İptal olarak işaretle
            </Button>
          ) : null}
        </div>

        {editable && problems.length > 0 && d.id && !dirty ? (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <div className="font-semibold">Kesmeden önce tamamlanacaklar:</div>
            <ul className="mt-1 list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <fieldset disabled={!editable} className="mt-5 space-y-5">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Müşteri</Label>
              <Select
                value={d.customer_id || NONE}
                onValueChange={(v) => {
                  const c = customers.find((x) => x.id === v);
                  if (!c) return;
                  setD((prev) => {
                    const next = structuredClone(prev);
                    applyCustomer(next, c);
                    if (
                      next.project_id &&
                      !projects.some(
                        (p) =>
                          p.id === next.project_id && p.customer_id === c.id,
                      )
                    )
                      next.project_id = null;
                    return next;
                  });
                  setDirty(true);
                }}
              >
                <SelectTrigger className="mt-1 h-11">
                  <SelectValue placeholder="Müşteri seçin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} disabled>
                    Müşteri seçin
                  </SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Fatura bilgileri müşteri kartından gelir (Müşteriler → düzenle).
                Burada yalnız bu fatura için değiştirebilirsiniz.
              </p>
            </div>
            <Field label="Alıcı unvanı / adı soyadı" className="sm:col-span-2">
              <Input
                value={h.buyer_title}
                maxLength={250}
                onChange={(e) => update({ buyer_title: e.target.value })}
                className="h-11"
              />
            </Field>
            <Field
              label={isTckn(h.buyer_tax_no) ? "TCKN (11 hane)" : "VKN / TCKN"}
            >
              <Input
                value={h.buyer_tax_no ?? ""}
                inputMode="numeric"
                maxLength={11}
                onChange={(e) =>
                  update({
                    buyer_tax_no: e.target.value.replace(/\D/g, "") || null,
                  })
                }
                className="h-11 font-mono"
              />
            </Field>
            <Field label="Vergi dairesi">
              <Input
                value={h.buyer_tax_office ?? ""}
                maxLength={120}
                onChange={(e) => update({ buyer_tax_office: e.target.value })}
                className="h-11"
              />
            </Field>
            <Field label="Adres" className="sm:col-span-2">
              <Textarea
                value={h.buyer_address ?? ""}
                maxLength={500}
                rows={2}
                onChange={(e) => update({ buyer_address: e.target.value })}
              />
            </Field>
            <Field label="E-posta (isteğe bağlı)">
              <Input
                value={h.buyer_email ?? ""}
                maxLength={200}
                type="email"
                onChange={(e) => update({ buyer_email: e.target.value })}
                className="h-11"
              />
            </Field>
            <Field label="Proje (isteğe bağlı)">
              <Select
                value={d.project_id ?? NONE}
                onValueChange={(v) => {
                  setD((prev) => ({
                    ...prev,
                    project_id: v === NONE ? null : v,
                  }));
                  setDirty(true);
                }}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Projesiz</SelectItem>
                  {customerProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </section>

          <section className="grid gap-3 sm:grid-cols-4">
            <Field label="Senaryo" className="sm:col-span-2">
              <Select
                value={h.profile}
                onValueChange={(v) => update({ profile: v as InvoiceProfile })}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TICARIFATURA">
                    e-Fatura · Ticari (alıcı e-Fatura mükellefi)
                  </SelectItem>
                  <SelectItem value="TEMELFATURA">e-Fatura · Temel</SelectItem>
                  <SelectItem value="EARSIVFATURA">
                    e-Arşiv (alıcı e-Fatura mükellefi değil)
                  </SelectItem>
                </SelectContent>
              </Select>
              <a
                href={GIB_PORTALS.mukellefSorgu}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-highlight underline"
              >
                Alıcı e-Fatura mükellefi mi? GİB listesinden bakın
                <ExternalLink className="h-3 w-3" />
              </a>
            </Field>
            <Field label="Fatura tipi" className="sm:col-span-2">
              <Select
                value={h.invoice_type}
                onValueChange={(v) => {
                  const t = v as InvoiceType;
                  update({
                    invoice_type: t,
                    ...(t !== "TEVKIFAT"
                      ? { withholding_code: null, withholding_rate: 0 }
                      : {}),
                  });
                }}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(invoiceTypeLabels) as InvoiceType[]).map(
                    (t) => (
                      <SelectItem key={t} value={t}>
                        {invoiceTypeLabels[t]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </Field>
            {h.invoice_type === "TEVKIFAT" ? (
              <Field label="Tevkifat kodu" className="sm:col-span-4">
                <Select
                  value={h.withholding_code ?? NONE}
                  onValueChange={(v) => {
                    const o = withholdingOptions.find((x) => x.code === v);
                    if (o)
                      update({
                        withholding_code: o.code,
                        withholding_rate: o.rate,
                      });
                  }}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Kod seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE} disabled>
                      Kod seçin
                    </SelectItem>
                    {withholdingOptions.map((o) => (
                      <SelectItem key={o.code} value={o.code}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Kodu ve oranı mali müşavirinizle teyit edin.
                </p>
              </Field>
            ) : null}
            {h.invoice_type === "ISTISNA" ? (
              <>
                <Field label="İstisna kodu">
                  <Input
                    value={h.exemption_code ?? ""}
                    maxLength={10}
                    placeholder="örn. 350"
                    onChange={(e) => update({ exemption_code: e.target.value })}
                    className="h-11"
                  />
                </Field>
                <Field label="İstisna gerekçesi" className="sm:col-span-3">
                  <Input
                    value={h.exemption_reason ?? ""}
                    maxLength={250}
                    onChange={(e) =>
                      update({ exemption_reason: e.target.value })
                    }
                    className="h-11"
                  />
                </Field>
              </>
            ) : null}
            <Field label="Fatura tarihi">
              <Input
                type="date"
                value={h.issue_date}
                onChange={(e) => update({ issue_date: e.target.value })}
                className="h-11"
              />
            </Field>
            <Field label="Son ödeme tarihi">
              <Input
                type="date"
                value={h.due_date ?? ""}
                onChange={(e) => update({ due_date: e.target.value || null })}
                className="h-11"
              />
            </Field>
            <Field label="Para birimi">
              <Select
                value={h.currency}
                onValueChange={(v) =>
                  update({
                    currency: v as InvoiceCurrency,
                    exchange_rate: v === "TRY" ? 1 : h.exchange_rate,
                  })
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
                type="number"
                step="0.0001"
                min="0"
                disabled={h.currency === "TRY"}
                value={h.currency === "TRY" ? 1 : h.exchange_rate}
                onChange={(e) =>
                  update({ exchange_rate: Number(e.target.value) || 0 })
                }
                className="h-11"
              />
            </Field>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold">Satırlar</h3>
              {editable ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() => {
                    setD((prev) => ({
                      ...prev,
                      lines: [...prev.lines, emptyLine()],
                    }));
                    setDirty(true);
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" /> Satır ekle
                </Button>
              ) : null}
            </div>
            <div className="space-y-3">
              {d.lines.map((line, i) => {
                const a = lineAmounts(line);
                return (
                  <div key={i} className="rounded-xl border border-border p-3">
                    <div className="flex gap-2">
                      <Input
                        value={line.description}
                        maxLength={300}
                        placeholder={`${i + 1}. mal / hizmet adı`}
                        onChange={(e) =>
                          updateLine(i, { description: e.target.value })
                        }
                        className="h-10 flex-1"
                      />
                      {editable && d.lines.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 shrink-0 text-destructive"
                          aria-label="Satırı sil"
                          onClick={() => {
                            setD((prev) => ({
                              ...prev,
                              lines: prev.lines.filter((_, j) => j !== i),
                            }));
                            setDirty(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
                      <SmallField label="Miktar">
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(i, { quantity: Number(e.target.value) })
                          }
                          className="h-10"
                        />
                      </SmallField>
                      <SmallField label="Birim">
                        <Select
                          value={line.unit}
                          onValueChange={(v) => updateLine(i, { unit: v })}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {invoiceUnits.map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </SmallField>
                      <SmallField label="Birim fiyat">
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          value={line.unit_price}
                          onChange={(e) =>
                            updateLine(i, {
                              unit_price: Number(e.target.value),
                            })
                          }
                          className="h-10"
                        />
                      </SmallField>
                      <SmallField label="İndirim %">
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          max="99"
                          value={Math.round(line.discount_rate * 10000) / 100}
                          onChange={(e) =>
                            updateLine(i, {
                              discount_rate:
                                Math.min(Number(e.target.value) || 0, 99) / 100,
                            })
                          }
                          className="h-10"
                        />
                      </SmallField>
                      <SmallField label="KDV">
                        <Select
                          value={String(line.vat_rate)}
                          onValueChange={(v) =>
                            updateLine(i, { vat_rate: Number(v) })
                          }
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {vatRates.map((r) => (
                              <SelectItem key={r} value={String(r)}>
                                %{r * 100}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </SmallField>
                      <SmallField label="Tutar (KDV hariç)">
                        <div className="flex h-10 items-center justify-end rounded-md bg-muted px-3 text-sm font-semibold tabular-nums">
                          {invoiceMoney(a.net, h.currency)}
                        </div>
                      </SmallField>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="Fatura notu (isteğe bağlı)">
              <Textarea
                value={h.notes ?? ""}
                maxLength={1500}
                rows={4}
                placeholder="örn. EKİM 2026 TRAFO İŞLETME SORUMLULUĞU BEDELİ"
                onChange={(e) => update({ notes: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                IBAN ve yazıyla tutar faturaya kendiliğinden eklenir.
              </p>
            </Field>
            <div className="rounded-xl border border-border p-4 text-sm">
              <TotalRow
                label="Mal / hizmet toplamı"
                value={totals.gross}
                cur={h.currency}
              />
              {totals.discount > 0 ? (
                <TotalRow
                  label="İndirim"
                  value={-totals.discount}
                  cur={h.currency}
                />
              ) : null}
              <TotalRow
                label="Matrah (KDV hariç)"
                value={totals.subtotal}
                cur={h.currency}
              />
              {totals.byRate.map((r) => (
                <TotalRow
                  key={r.rate}
                  label={`KDV %${r.rate * 100}`}
                  value={r.vat}
                  cur={h.currency}
                />
              ))}
              <TotalRow
                label="KDV dahil toplam"
                value={totals.grand}
                cur={h.currency}
              />
              {totals.withholding > 0 ? (
                <TotalRow
                  label="Tevkif edilen KDV"
                  value={-totals.withholding}
                  cur={h.currency}
                />
              ) : null}
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-base font-bold">
                <span>Ödenecek</span>
                <span className="tabular-nums">
                  {invoiceMoney(totals.payable, h.currency)}
                </span>
              </div>
              {h.currency !== "TRY" && Number(h.exchange_rate) > 0 ? (
                <div className="mt-1 text-right text-xs text-muted-foreground">
                  ≈{" "}
                  {invoiceMoney(
                    Math.round(totals.payable * Number(h.exchange_rate) * 100) /
                      100,
                    "TRY",
                  )}
                </div>
              ) : null}
            </div>
          </section>
        </fieldset>

        {h.status === "iptal" ? (
          <p className="mt-4 text-sm text-muted-foreground">
            İptal nedeni: {(initial.header as InvoiceRow).cancel_reason ?? "-"}
          </p>
        ) : null}

        <InvoicePreview
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          header={h}
          lines={d.lines}
        />
        {d.id ? (
          <IssueDialog
            open={issueOpen}
            onOpenChange={setIssueOpen}
            invoiceId={d.id}
            header={h}
            lines={d.lines}
            onIssued={async () => {
              setIssueOpen(false);
              await onSaved(d.id as string);
            }}
          />
        ) : null}
        {d.id ? (
          <CancelDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            invoiceId={d.id}
            onCancelled={async () => {
              setCancelOpen(false);
              await onSaved(d.id as string);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field({
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

function SmallField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function TotalRow({
  label,
  value,
  cur,
}: {
  label: string;
  value: number;
  cur: InvoiceCurrency;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{invoiceMoney(value, cur)}</span>
    </div>
  );
}

function InvoicePreview({
  open,
  onOpenChange,
  header,
  lines,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  header: InvoiceHeader;
  lines: InvoiceLineInput[];
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const html = open
    ? invoiceHtml(header, lines, window.location.origin).replace(
        "</body>",
        `${FRAME_SCRIPT}</body>`,
      )
    : "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Fatura görünümü</DialogTitle>
          <DialogDescription>
            {header.status === "kesildi"
              ? "Arşiv kopyası. Resmî belge GİB'deki faturadır."
              : "Taslak görünüm (TASLAK filigranlı). Müşteriye ön bilgi olarak gönderilebilir; yasal fatura değildir."}
          </DialogDescription>
        </DialogHeader>
        <iframe
          ref={frameRef}
          title="Fatura"
          srcDoc={html}
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

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border py-1.5 last:border-0">
      <div className="w-36 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 break-words text-sm">{value || "-"}</div>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label={`${label} kopyala`}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success(`${label} kopyalandı`);
          }}
        >
          <Copy className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

function IssueDialog({
  open,
  onOpenChange,
  invoiceId,
  header,
  lines,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId: string;
  header: InvoiceHeader;
  lines: InvoiceLineInput[];
  onIssued: () => Promise<void>;
}) {
  const [gibNo, setGibNo] = useState("");
  const [ettn, setEttn] = useState("");
  const isArchive = header.profile === "EARSIVFATURA";
  const portal = isArchive ? GIB_PORTALS.earsiv : GIB_PORTALS.efatura;
  const totals = invoiceTotals(
    lines,
    header.invoice_type,
    header.withholding_rate,
  );
  const validNo = /^[A-Z0-9]{3}20\d{2}\d{9}$/.test(gibNo);
  const validEttn =
    !ettn ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      ettn,
    );

  const issue = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("invoices")
        .update({
          status: "kesildi",
          gib_invoice_no: gibNo,
          ...(ettn ? { ettn: ettn.toLowerCase() } : {}),
        })
        .eq("id", invoiceId);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Fatura kesildi olarak arşivlendi; cari hesaba işlendi.");
      await onIssued();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>GİB’de kes</DialogTitle>
          <DialogDescription>
            {isArchive
              ? "e-Arşiv faturası GİB e-Arşiv Portalında (İnteraktif Vergi Dairesi şifresiyle) ücretsiz kesilir."
              : "e-Fatura GİB e-Fatura Portalında (mali mühür / e-imza ile) ücretsiz kesilir. Entegratör (ör. Paraşüt) kullanıyorsanız orada kesin."}{" "}
            Aşağıdaki bilgileri kopyalayıp portala girin, kestikten sonra GİB
            fatura numarasını buraya yazın.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-4 text-sm">
          <li>
            <div className="font-semibold">1. Portalı açın</div>
            <a
              href={portal}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-highlight underline"
            >
              {isArchive ? "GİB e-Arşiv Portalı" : "GİB e-Fatura Portalı"}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </li>
          <li>
            <div className="font-semibold">2. Bilgileri girin</div>
            <div className="mt-2 rounded-xl border border-border px-3">
              <CopyRow label="Senaryo" value={header.profile} />
              <CopyRow label="Fatura tipi" value={header.invoice_type} />
              <CopyRow
                label="Fatura tarihi"
                value={dateTr(header.issue_date)}
              />
              <CopyRow
                label={isTckn(header.buyer_tax_no) ? "TCKN" : "VKN"}
                value={header.buyer_tax_no ?? ""}
              />
              <CopyRow label="Unvan / ad soyad" value={header.buyer_title} />
              <CopyRow
                label="Vergi dairesi"
                value={header.buyer_tax_office ?? ""}
              />
              <CopyRow label="Adres" value={header.buyer_address ?? ""} />
              <CopyRow label="E-posta" value={header.buyer_email ?? ""} />
              <CopyRow label="Para birimi" value={header.currency} />
              {header.currency !== "TRY" ? (
                <CopyRow label="Kur" value={String(header.exchange_rate)} />
              ) : null}
              {header.invoice_type === "TEVKIFAT" ? (
                <CopyRow
                  label="Tevkifat kodu"
                  value={header.withholding_code ?? ""}
                />
              ) : null}
              {header.invoice_type === "ISTISNA" ? (
                <CopyRow
                  label="İstisna"
                  value={`${header.exemption_code ?? ""} ${header.exemption_reason ?? ""}`.trim()}
                />
              ) : null}
            </div>
            <div className="mt-3 space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="rounded-xl border border-border px-3">
                  <CopyRow
                    label={`${i + 1}. satır adı`}
                    value={l.description}
                  />
                  <CopyRow
                    label="Miktar / birim"
                    value={`${l.quantity} ${l.unit}`}
                  />
                  <CopyRow label="Birim fiyat" value={String(l.unit_price)} />
                  {l.discount_rate > 0 ? (
                    <CopyRow
                      label="İndirim %"
                      value={String(l.discount_rate * 100)}
                    />
                  ) : null}
                  <CopyRow label="KDV %" value={String(l.vat_rate * 100)} />
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Portalda çıkan toplam şu olmalı:{" "}
              <b>{invoiceMoney(totals.payable, header.currency)}</b> (KDV dahil
              {totals.withholding > 0 ? ", tevkifat düşülmüş" : ""}).
            </div>
            {header.notes ? (
              <div className="mt-2 rounded-xl border border-border px-3">
                <CopyRow label="Fatura notu" value={header.notes} />
              </div>
            ) : null}
          </li>
          <li>
            <div className="font-semibold">3. GİB numarasını girin</div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="GİB fatura numarası (16 karakter)">
                <Input
                  value={gibNo}
                  maxLength={16}
                  placeholder="örn. ED02026000000009"
                  onChange={(e) =>
                    setGibNo(e.target.value.toUpperCase().replace(/\s/g, ""))
                  }
                  className="h-11 font-mono"
                />
              </Field>
              <Field label="ETTN (portal veriyorsa)">
                <Input
                  value={ettn}
                  maxLength={36}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  onChange={(e) => setEttn(e.target.value.trim())}
                  className="h-11 font-mono text-xs"
                />
              </Field>
            </div>
            {gibNo && !validNo ? (
              <p className="mt-1 text-xs text-destructive">
                Numara 3 harf/rakam + yıl + 9 hane olmalı (örn.
                ED02026000000009).
              </p>
            ) : null}
            {!validEttn ? (
              <p className="mt-1 text-xs text-destructive">
                ETTN biçimi hatalı.
              </p>
            ) : null}
          </li>
        </ol>

        <DialogFooter>
          <Button
            className="h-11 font-bold"
            disabled={!validNo || !validEttn || issue.isPending}
            onClick={() => issue.mutate()}
          >
            <Receipt className="mr-2 h-4 w-4" />
            {issue.isPending ? "Kaydediliyor..." : "Kesildi olarak kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  open,
  onOpenChange,
  invoiceId,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId: string;
  onCancelled: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("invoices")
        .update({ status: "iptal", cancel_reason: reason.trim() })
        .eq("id", invoiceId);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Fatura iptal olarak işaretlendi; cari hesaptan düştü.");
      await onCancelled();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Faturayı iptal olarak işaretle</DialogTitle>
          <DialogDescription>
            Önce faturayı GİB'de iptal edin (e-Arşiv: portaldan iptal; e-Fatura:
            alıcının reddi / iade faturası). Bu işlem yalnız uygulamadaki kaydı
            iptal eder ve cari hesaptan düşürür; geri alınamaz.
          </DialogDescription>
        </DialogHeader>
        <Field label="İptal nedeni">
          <Textarea
            value={reason}
            maxLength={300}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button
            variant="destructive"
            className="h-11"
            disabled={!reason.trim() || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            <FileText className="mr-2 h-4 w-4" /> İptal et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
