import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Factory, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import { formatMoney, type Currency } from "@/lib/energy-offer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Zeybek Elektrik fiyat listesi: üreticinin PDF listesi her sabah sunucuda
// kontrol edilir (zeybek-price-sync). Bu panel durumu gösterir, bayi
// iskontosunu ayarlar, listede arama yapar ve ürünü fiyat kataloğuna bağlar.
// Bağlı kalemlerin alış fiyatı liste değiştikçe kendiliğinden güncellenir.

const SUPPLIER = "zeybek";

const dateTr = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

/** Boru, kanal ve tava metre ile; dönüş elemanı, aksesuar, pano adet ile. */
function guessSupplierUnit(name: string) {
  const lengthGoods = /boru|kanal|tava|merdiven|spiral/i.test(name);
  const pieceWords =
    /dönüş|eleman|aksesuar|kapak|red\.|bağlant|klips|kelepçe|menhol|buat|kasa|dirsek|manşon|rakor|ayak|konsol|askı|pano|kabinet/i;
  return lengthGoods && !pieceWords.test(name) ? "m" : "adet";
}

type SupplierItem = {
  code: string;
  name: string;
  section: string | null;
  list_price: number;
  currency: string;
};

export function SupplierPricePanel({
  onCatalogChanged,
}: {
  onCatalogChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [discountText, setDiscountText] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [units, setUnits] = useState<Record<string, string>>({});

  const status = useQuery({
    queryKey: ["supplier-status", SUPPLIER],
    queryFn: async () => {
      const [settings, list, items, linked] = await Promise.all([
        supabase
          .from("supplier_settings")
          .select("*")
          .eq("supplier", SUPPLIER)
          .maybeSingle(),
        supabase
          .from("supplier_price_lists")
          .select("list_name, published_at, item_count, source_url")
          .eq("supplier", SUPPLIER)
          .eq("status", "ok")
          .order("imported_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("supplier_price_items")
          .select("code", { count: "exact", head: true })
          .eq("supplier", SUPPLIER)
          .eq("is_current", true),
        supabase
          .from("offer_catalog_items")
          .select("supplier_ref")
          .like("supplier_ref", `${SUPPLIER}:%`),
      ]);
      if (settings.error) throw settings.error;
      return {
        settings: settings.data,
        list: list.data,
        itemCount: items.count ?? 0,
        linked: new Set((linked.data ?? []).map((r) => String(r.supplier_ref))),
      };
    },
  });

  const term = search.trim();
  const results = useQuery({
    queryKey: ["supplier-search", SUPPLIER, term],
    enabled: term.length >= 2,
    queryFn: async () => {
      const safe = term.replace(/[%,()]/g, " ").trim();
      const words = safe.split(/\s+/).filter(Boolean).slice(0, 4);
      let q = supabase
        .from("supplier_price_items")
        .select("code, name, section, list_price, currency")
        .eq("supplier", SUPPLIER)
        .eq("is_current", true);
      for (const w of words) q = q.or(`code.ilike.%${w}%,name.ilike.%${w}%`);
      const { data, error } = await q.order("code").limit(40);
      if (error) throw error;
      return (data ?? []) as SupplierItem[];
    },
  });

  const discount = status.data?.settings?.discount_rate ?? 0;
  const discountInput =
    discountText ?? String(Math.round(discount * 10000) / 100);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["supplier-status"] });
    onCatalogChanged();
  };

  const saveDiscount = useMutation({
    mutationFn: async () => {
      const pct = Number(discountInput.replace(",", "."));
      if (!Number.isFinite(pct) || pct < 0 || pct >= 100)
        throw new Error("İskonto %0 ile %99 arasında olmalı.");
      const { data, error } = await supabase.rpc("set_supplier_discount", {
        p_supplier: SUPPLIER,
        p_discount_rate: pct / 100,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: (changed) => {
      setDiscountText(null);
      toast.success(
        `İskonto kaydedildi; ${changed} katalog kaleminin fiyatı güncellendi.`,
      );
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const checkNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        message?: string;
        error?: string;
      }>("zeybek-price-sync", { body: { mode: "check" } });
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => ({}));
          throw new Error(body.error ?? "Liste kontrol edilemedi.");
        }
        throw error;
      }
      return data?.message ?? "Kontrol edildi.";
    },
    onSuccess: (message) => {
      toast.success(message);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["supplier-search"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const addItem = useMutation({
    mutationFn: async (item: SupplierItem) => {
      const { error } = await supabase.rpc("add_supplier_item_to_catalog", {
        p_supplier: SUPPLIER,
        p_code: item.code,
        p_unit: units[item.code] ?? guessSupplierUnit(item.name),
      });
      if (error) throw error;
      return item;
    },
    onSuccess: (item) => {
      toast.success(`${item.name} fiyat kataloğuna eklendi.`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const s = status.data;
  const net = (price: number) => Math.round(price * (1 - discount) * 100) / 100;
  const stateBadge = useMemo(() => {
    const st = s?.settings?.last_check_status;
    if (st === "error")
      return <Badge variant="destructive">Son kontrolde sorun var</Badge>;
    if (st === "ok" || st === "unchanged")
      return <Badge variant="secondary">Otomatik kontrol çalışıyor</Badge>;
    return <Badge variant="outline">Henüz kontrol edilmedi</Badge>;
  }, [s?.settings?.last_check_status]);

  return (
    <section className="surface-panel mb-4 overflow-hidden">
      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-500/15 text-sky-700 dark:text-sky-300">
            <Factory className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-black">Zeybek Elektrik fiyat listesi</h2>
              {stateBadge}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Üreticinin zeybekgrup.com&apos;daki listesi her sabah
              kendiliğinden kontrol edilir. Yeni liste çıkınca kataloğa
              eklediğiniz Zeybek kalemlerinin alış fiyatı (liste fiyatı − bayi
              iskontosu, KDV hariç) güncellenir. Liste yalnız Zeybek&apos;in
              ürettiği boru, kablo kanalı ve tavası, pano ve rack kabinetleri
              kapsar.
            </p>
            {s ? (
              <p className="mt-2 text-sm">
                {s.list ? (
                  <>
                    Liste <b>{s.list.list_name}</b> (yayın{" "}
                    {dateTr(s.list.published_at).slice(0, 10)}) ·{" "}
                    {s.itemCount.toLocaleString("tr-TR")} ürün · kataloğa bağlı{" "}
                    <b>{s.linked.size}</b> kalem
                  </>
                ) : (
                  "Liste henüz alınmadı."
                )}
                <span className="block text-xs text-muted-foreground">
                  Son kontrol: {dateTr(s.settings?.last_checked_at)}
                  {s.settings?.last_check_message
                    ? ` · ${s.settings.last_check_message}`
                    : ""}
                </span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-semibold">
            Bayi iskontosu (%)
            <div className="flex gap-2">
              <Input
                className="h-11 w-24"
                inputMode="decimal"
                value={discountInput}
                onChange={(e) => setDiscountText(e.target.value)}
              />
              <Button
                variant="outline"
                className="h-11"
                disabled={discountText === null || saveDiscount.isPending}
                onClick={() => saveDiscount.mutate()}
              >
                Kaydet
              </Button>
            </div>
          </label>
          <Button
            className="h-11 font-bold"
            disabled={checkNow.isPending}
            onClick={() => checkNow.mutate()}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${checkNow.isPending ? "animate-spin" : ""}`}
            />
            {checkNow.isPending ? "Kontrol ediliyor..." : "Şimdi kontrol et"}
          </Button>
        </div>
      </div>

      <div className="border-t p-5">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9"
            placeholder="Zeybek listesinde ara: kod veya ad (örn. 20 mm boru, NK 200)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {term.length >= 2 ? (
          <div className="mt-3 divide-y rounded-xl border">
            {results.isLoading ? (
              <p className="p-3 text-sm text-muted-foreground">Aranıyor...</p>
            ) : results.error ? (
              <p className="p-3 text-sm text-destructive">
                {errorMessage(results.error)}
              </p>
            ) : (results.data ?? []).length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                Bu aramayla ürün bulunamadı.
              </p>
            ) : (
              (results.data ?? []).map((item) => {
                const linked = s?.linked.has(`${SUPPLIER}:${item.code}`);
                const cur = item.currency as Currency;
                return (
                  <div
                    key={item.code}
                    className="flex flex-wrap items-center gap-3 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {item.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{item.code}</span>
                        {item.section ? ` · ${item.section}` : ""}
                      </p>
                    </div>
                    <div className="text-right text-sm tabular-nums">
                      <p className="font-bold">
                        {formatMoney(net(Number(item.list_price)), cur)}
                      </p>
                      {discount > 0 ? (
                        <p className="text-xs text-muted-foreground line-through">
                          {formatMoney(Number(item.list_price), cur)}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          liste, KDV hariç
                        </p>
                      )}
                    </div>
                    {linked ? (
                      <Badge variant="secondary">Katalogda</Badge>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Select
                          value={
                            units[item.code] ?? guessSupplierUnit(item.name)
                          }
                          onValueChange={(v) =>
                            setUnits((u) => ({ ...u, [item.code]: v }))
                          }
                        >
                          <SelectTrigger
                            className="h-10 w-24"
                            aria-label="Birim"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["adet", "m", "set", "takım", "boy"].map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          className="h-10"
                          disabled={addItem.isPending}
                          onClick={() => addItem.mutate(item)}
                        >
                          <Plus className="mr-1 h-4 w-4" /> Kataloğa ekle
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
