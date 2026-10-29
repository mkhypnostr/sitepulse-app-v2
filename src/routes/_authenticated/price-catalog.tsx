import { useMemo, useRef, useState } from "react";
import { FEATURES } from "@/lib/features";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CircleX,
  ExternalLink,
  Pencil,
  RefreshCw,
  Search,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import {
  formatMoney,
  type CatalogItem,
  type Currency,
} from "@/lib/energy-offer";
import {
  ENERJIPAZARI_BASE,
  ENERJIPAZARI_CATEGORIES,
  ENERJIPAZARI_CRAWL_DELAY_MS,
  enerjipazariUsdExVat,
  matchCatalogItem,
  type EnerjipazariCategory,
  type EnerjipazariPage,
  type EnerjipazariProduct,
} from "@/lib/enerjipazari";
import {
  AccessDenied,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/price-catalog")({
  component: PriceCatalogPage,
});

const SOURCE_LABEL = "enerjipazari.com.tr liste fiyatı (USD + KDV), otomatik";

const moduleLabels: Record<string, string> = {
  ges: "GES",
  sarj: "EV şarj",
  taahhut: "Taahhüt",
  genel: "Genel",
};

type SiteProduct = EnerjipazariProduct & { usdRate: number };

type PriceChange = {
  item: CatalogItem;
  product: SiteProduct;
  exact: boolean;
  newCost: number;
  changePct: number;
};

const dateTr = (v: string | null) =>
  v ? v.slice(0, 10).split("-").reverse().join(".") : "-";

const todayIso = () => new Date().toISOString().slice(0, 10);

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("İptal", "AbortError"));
    });
  });
}

function PriceCatalogPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("hepsi");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(
    null,
  );
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, label: "" });
  const [siteProducts, setSiteProducts] = useState<SiteProduct[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const catalogQuery = useQuery({
    queryKey: ["price-catalog"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offer_catalog_items")
        .select("*")
        .order("module")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as CatalogItem[];
    },
  });
  const catalog = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    return catalog.filter(
      (item) =>
        (showInactive || item.is_active) &&
        (FEATURES.ges || item.module !== "ges") &&
        (moduleFilter === "hepsi" || item.module === moduleFilter) &&
        (!q ||
          [item.code, item.name, item.brand, item.model, item.category]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("tr-TR")
            .includes(q)),
    );
  }, [catalog, query, moduleFilter, showInactive]);

  const changes: PriceChange[] = useMemo(() => {
    if (!siteProducts) return [];
    const result: PriceChange[] = [];
    // Yalnız Enerji Pazarı kaynaklı (EP-) kalemler güncellenir; Drive maliyet
    // tablolarından gelen kalemler ayrı kaynak olarak korunur.
    for (const item of catalog) {
      if (!item.code.startsWith("EP-") || item.currency !== "USD") continue;
      const match = matchCatalogItem(item, siteProducts);
      if (!match) continue;
      const product = match.product as SiteProduct;
      const newCost = enerjipazariUsdExVat(product.priceTry, product.usdRate);
      const old = Number(item.cost_amount);
      result.push({
        item,
        product,
        exact: match.exact,
        newCost,
        changePct: old > 0 ? (newCost - old) / old : 0,
      });
    }
    return result.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  }, [catalog, siteProducts]);

  const unmatchedEp = useMemo(() => {
    if (!siteProducts) return [];
    const matched = new Set(changes.map((c) => c.item.id));
    return catalog.filter(
      (item) => item.code.startsWith("EP-") && !matched.has(item.id),
    );
  }, [catalog, changes, siteProducts]);

  async function pullPrices() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      toast.error("Oturum bulunamadı, yeniden giriş yapın.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setSyncing(true);
    setSiteProducts(null);
    const collected: SiteProduct[] = [];
    let requests = 0;
    try {
      const categories = Object.keys(
        ENERJIPAZARI_CATEGORIES,
      ) as EnerjipazariCategory[];
      for (const category of categories) {
        for (let page = 1; page <= 10; page++) {
          if (requests > 0) {
            setProgress((p) => ({
              ...p,
              label: `Site kuralı gereği 30 sn bekleniyor... (${ENERJIPAZARI_CATEGORIES[category]}, sayfa ${page})`,
            }));
            await sleep(ENERJIPAZARI_CRAWL_DELAY_MS, controller.signal);
          }
          setProgress((p) => ({
            ...p,
            label: `${ENERJIPAZARI_CATEGORIES[category]} okunuyor (sayfa ${page})...`,
          }));
          const response = await fetch(
            `/api/enerjipazari-prices?category=${category}&page=${page}`,
            {
              headers: { authorization: `Bearer ${token}` },
              signal: controller.signal,
            },
          );
          requests++;
          const body = (await response.json()) as
            | EnerjipazariPage
            | { error: string };
          if (!response.ok || "error" in body) {
            throw new Error(
              "error" in body ? body.error : `HTTP ${response.status}`,
            );
          }
          if (!body.usdRate) {
            throw new Error("Sitenin USD kuru okunamadı.");
          }
          const rate = body.usdRate;
          collected.push(
            ...body.products.map((product) => ({ ...product, usdRate: rate })),
          );
          setProgress({ done: requests, label: "" });
          if (!body.hasNextPage) break;
        }
      }
      setSiteProducts(collected);
      toast.success(`${collected.length} ürünün fiyatı okundu.`);
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        toast.message("Fiyat çekme durduruldu.");
      } else {
        toast.error(errorMessage(error) || "Fiyatlar okunamadı.");
      }
      if (collected.length > 0) setSiteProducts(collected);
    } finally {
      setSyncing(false);
      setProgress({ done: 0, label: "" });
      abortRef.current = null;
    }
  }

  // Fiyat okunduğunda: kesin eşleşen ve %0,5'ten fazla değişenler seçili gelir.
  const [selectionFor, setSelectionFor] = useState<SiteProduct[] | null>(null);
  if (siteProducts && selectionFor !== siteProducts) {
    setSelectionFor(siteProducts);
    setSelected(
      new Set(
        changes
          .filter((c) => c.exact && Math.abs(c.changePct) > 0.005)
          .map((c) => c.item.id),
      ),
    );
  }

  const applyChanges = useMutation({
    mutationFn: async (rows: PriceChange[]) => {
      const date = todayIso();
      for (const row of rows) {
        const { error } = await supabase
          .from("offer_catalog_items")
          .update({
            cost_amount: row.newCost,
            price_date: date,
            source: SOURCE_LABEL,
          })
          .eq("id", row.item.id);
        if (error) throw error;
      }
      return rows.length;
    },
    onSuccess: (count) => {
      toast.success(
        `${count} kalemin fiyatı güncellendi. Kayıtlı teklifler değişmez; yeni hesaplamalarda geçerli.`,
      );
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["price-catalog"] });
      void queryClient.invalidateQueries({ queryKey: ["energy-offer"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveManual = useMutation({
    mutationFn: async ({ id, cost }: { id: string; cost: number }) => {
      const { error } = await supabase
        .from("offer_catalog_items")
        .update({ cost_amount: cost, price_date: todayIso() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fiyat kaydedildi.");
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["price-catalog"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from("offer_catalog_items")
        .update({ is_active: active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["price-catalog"] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!isAdmin) return <AccessDenied />;
  if (catalogQuery.isLoading)
    return <LoadingState label="Katalog yükleniyor..." />;
  if (catalogQuery.error) {
    return (
      <div className="surface-panel p-6 text-sm text-destructive">
        {errorMessage(catalogQuery.error)}
      </div>
    );
  }

  const epCount = catalog.filter((i) => i.code.startsWith("EP-")).length;
  const lastEpDate = catalog
    .filter((i) => i.code.startsWith("EP-") && i.price_date)
    .map((i) => i.price_date as string)
    .sort()
    .at(-1);
  const selectedRows = changes.filter((c) => selected.has(c.item.id));

  return (
    <>
      <PageHeader
        title="Fiyat Kataloğu"
        description={
          FEATURES.ges
            ? "Tekliflerde kullanılan malzeme ve işçilik birim maliyetleri. GES ana ekipmanı Enerji Pazarı liste fiyatından güncellenir."
            : "Tekliflerde kullanılan malzeme ve işçilik birim maliyetleri."
        }
      />

      {FEATURES.ges ? (
        <>
          <section className="surface-panel mb-4 grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-500/15 text-amber-600">
                <Store className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="font-black">Enerji Pazarı fiyat güncellemesi</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Panel, inverter ve batarya liste fiyatları{" "}
                  <a
                    href={ENERJIPAZARI_BASE}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-primary hover:underline"
                  >
                    enerjipazari.com.tr
                  </a>{" "}
                  sitesinden okunur, KDV ayrılıp sitenin kendi kuruyla
                  USD&apos;ye çevrilir. {epCount} kalem bu kaynağa bağlı; son
                  fiyat tarihi <b>{dateTr(lastEpDate ?? null)}</b>. Site her
                  istek arasında 30 sn bekleme istediği için okuma 3–4 dakika
                  sürer.
                </p>
                {syncing ? (
                  <div className="mt-3 grid gap-1.5">
                    <Progress
                      value={Math.min(100, (progress.done / 4) * 100)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {progress.label || "Hazırlanıyor..."}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {syncing ? (
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => abortRef.current?.abort()}
                >
                  <CircleX className="mr-2 h-4 w-4" /> Durdur
                </Button>
              ) : null}
              <Button
                className="h-11 font-bold"
                onClick={() => void pullPrices()}
                disabled={syncing}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                />
                {syncing ? "Okunuyor..." : "Güncel fiyatları çek"}
              </Button>
            </div>
          </section>

          {siteProducts ? (
            <section className="surface-panel mb-4 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
                <div>
                  <h2 className="font-black">Fiyat farkları</h2>
                  <p className="text-sm text-muted-foreground">
                    Sitede {siteProducts.length} ürün okundu, {changes.length}{" "}
                    katalog kalemi eşleşti
                    {unmatchedEp.length > 0
                      ? `, ${unmatchedEp.length} kalem sitede bulunamadı (fiyatı aynen kalır)`
                      : ""}
                    . İşaretli olanlar kaydedilir.
                  </p>
                </div>
                <Button
                  className="h-11 font-bold"
                  disabled={selectedRows.length === 0 || applyChanges.isPending}
                  onClick={() => applyChanges.mutate(selectedRows)}
                >
                  <Check className="mr-2 h-4 w-4" />
                  {applyChanges.isPending
                    ? "Kaydediliyor..."
                    : `Seçilen ${selectedRows.length} fiyatı kaydet`}
                </Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Katalog kalemi</TableHead>
                      <TableHead>Sitedeki ürün</TableHead>
                      <TableHead className="text-right">
                        Site (KDV dahil)
                      </TableHead>
                      <TableHead className="text-right">Eski maliyet</TableHead>
                      <TableHead className="text-right">Yeni maliyet</TableHead>
                      <TableHead className="text-right">Değişim</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changes.map((change) => {
                      const up = change.changePct > 0.005;
                      const down = change.changePct < -0.005;
                      return (
                        <TableRow key={change.item.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-primary"
                              aria-label={`${change.item.name} fiyatını güncelle`}
                              checked={selected.has(change.item.id)}
                              onChange={(e) =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked)
                                    next.add(change.item.id);
                                  else next.delete(change.item.id);
                                  return next;
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold">
                              {change.item.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {change.item.code}
                            </div>
                          </TableCell>
                          <TableCell>
                            <a
                              href={`${ENERJIPAZARI_BASE}/urun/${change.product.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-sm hover:underline"
                            >
                              {change.product.name}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            {!change.exact ? (
                              <Badge variant="outline" className="ml-2">
                                tahmini eşleşme
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(change.product.priceTry, "TRY")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(
                              Number(change.item.cost_amount),
                              "USD",
                            )}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatMoney(change.newCost, "USD")}
                          </TableCell>
                          <TableCell
                            className={`text-right font-semibold tabular-nums ${up ? "text-destructive" : down ? "text-emerald-600" : "text-muted-foreground"}`}
                          >
                            <span className="inline-flex items-center gap-0.5">
                              {up ? (
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              ) : down ? (
                                <ArrowDownRight className="h-3.5 w-3.5" />
                              ) : null}
                              {(change.changePct * 100).toLocaleString(
                                "tr-TR",
                                {
                                  maximumFractionDigits: 1,
                                  signDisplay: "exceptZero",
                                },
                              )}
                              %
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <section className="surface-panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Kod, ad, marka ara"
              className="h-11 pl-9"
            />
          </div>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="h-11 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hepsi">Tüm modüller</SelectItem>
              {Object.entries(moduleLabels)
                .filter(([value]) => FEATURES.ges || value !== "ges")
                .map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Pasifleri göster
          </label>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kalem</TableHead>
                <TableHead>Modül</TableHead>
                <TableHead className="text-right">Birim maliyet</TableHead>
                <TableHead>Fiyat tarihi</TableHead>
                <TableHead>Kaynak</TableHead>
                <TableHead>Aktif</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((item) => (
                <TableRow
                  key={item.id}
                  className={item.is_active ? "" : "opacity-55"}
                >
                  <TableCell>
                    <div className="font-semibold">{item.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.code}
                      {item.brand ? ` · ${item.brand}` : ""} · {item.unit}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {moduleLabels[item.module] ?? item.module}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {editing?.id === item.id ? (
                      <form
                        className="flex items-center justify-end gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const cost = Number(editing.value.replace(",", "."));
                          if (!(cost >= 0)) {
                            toast.error("Geçerli bir tutar girin.");
                            return;
                          }
                          saveManual.mutate({ id: item.id, cost });
                        }}
                      >
                        <Input
                          autoFocus
                          inputMode="decimal"
                          value={editing.value}
                          onChange={(e) =>
                            setEditing({ id: item.id, value: e.target.value })
                          }
                          className="h-9 w-28 text-right"
                        />
                        <span className="text-xs text-muted-foreground">
                          {item.currency}
                        </span>
                        <Button size="icon" className="h-9 w-9" type="submit">
                          <Check className="h-4 w-4" />
                        </Button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 font-semibold hover:text-primary"
                        onClick={() =>
                          setEditing({
                            id: item.id,
                            value: String(item.cost_amount).replace(".", ","),
                          })
                        }
                        title="Fiyatı elle düzelt"
                      >
                        {formatMoney(
                          Number(item.cost_amount),
                          item.currency as Currency,
                        )}
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {dateTr(item.price_date)}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                    {item.source ?? "-"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={(active) =>
                        toggleActive.mutate({ id: item.id, active })
                      }
                      aria-label="Tekliflerde kullanılsın"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {visible.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Kayıt bulunamadı.
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}
