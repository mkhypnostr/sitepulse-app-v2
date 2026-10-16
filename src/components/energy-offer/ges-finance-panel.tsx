// GES bölümü altındaki "Tüketim, geri dönüş ve batarya" paneli ile hazır
// paket seçici.
import { useState } from "react";
import { BatteryCharging, Calculator, Package, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import {
  applyPackage,
  financeAnalysis,
  GES_PACKAGES,
  recommendedKwpForConsumption,
  suggestBattery,
  type FinanceConfig,
} from "@/lib/energy-offer-finance";
import {
  formatKwp,
  type CatalogItem,
  type ExchangeRates,
  type GesConfig,
} from "@/lib/energy-offer";
import { Field, NumField } from "@/components/energy-offer/fields";
import { fmtNum } from "@/components/energy-offer/format";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const tl = (value: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);

export function PackagePicker({
  ges,
  catalog,
  rates,
  onApply,
}: {
  ges: GesConfig;
  catalog: CatalogItem[];
  rates: ExchangeRates;
  onApply: (ges: GesConfig, targetKwp: number) => void;
}) {
  const [pick, setPick] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3 sm:flex-row sm:items-end">
      <Field
        label="Hazır paket"
        className="min-w-0 flex-1"
        hint="Paket panel adedini, inverteri ve bataryayı katalogdan seçer; sonra her şeyi elle değiştirebilirsiniz."
      >
        <Select value={pick || "none"} onValueChange={(v) => setPick(v)}>
          <SelectTrigger className="h-11">
            <SelectValue placeholder="Paket seçin" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Paket seçin</SelectItem>
            {GES_PACKAGES.map((pkg) => (
              <SelectItem key={pkg.id} value={pkg.id}>
                {pkg.name} — {pkg.description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={!pick || pick === "none"}
        onClick={() => {
          const pkg = GES_PACKAGES.find((item) => item.id === pick);
          if (!pkg) return;
          const result = applyPackage(pkg, ges, catalog, rates);
          onApply(result.ges, pkg.targetKwp);
          toast.success(
            `${pkg.name} uygulandı. ${result.notes.join(" ")} "Kalemleri oluştur"a basmayı unutmayın.`,
          );
        }}
      >
        <Package className="mr-2 h-4 w-4" /> Paketi uygula
      </Button>
    </div>
  );
}

export function FinancePanel({
  finance,
  onChange,
  kwp,
  monthlyPerKwp,
  specificYield,
  investmentTl,
  ges,
  catalog,
  onTargetKwp,
  onBattery,
}: {
  finance: FinanceConfig;
  onChange: (finance: FinanceConfig) => void;
  kwp: number;
  monthlyPerKwp: number[];
  specificYield: number;
  /** Yatırım tutarı TL (KDV tercihine göre). Kur yoksa null. */
  investmentTl: number | null;
  ges: GesConfig;
  catalog: CatalogItem[];
  onTargetKwp: (kwp: number) => void;
  onBattery: (batteryId: string, count: number) => void;
}) {
  const [bill, setBill] = useState(0);
  const set = (patch: Partial<FinanceConfig>) =>
    onChange({ ...finance, ...patch });
  const result = financeAnalysis({
    kwp,
    monthlyPerKwp,
    finance,
    investmentTl: investmentTl ?? 0,
  });
  const recommended = recommendedKwpForConsumption(
    finance.monthlyConsumptionKwh,
    specificYield,
  );
  const dailyProduction =
    (kwp * monthlyPerKwp.reduce((sum, value) => sum + value, 0)) / 365;
  const battery = suggestBattery({
    monthlyConsumptionKwh: finance.monthlyConsumptionKwh,
    nightSharePct: finance.nightSharePct,
    dailyProductionKwh: dailyProduction,
    catalog,
    inverterId: ges.inverterId,
  });
  const pos = result ? Math.max(...result.cumulative, 0) : 0;
  const neg = result ? Math.max(...result.cumulative.map((v) => -v), 0) : 0;
  const span = Math.max(pos + neg, 1);
  const zeroPct = (pos / span) * 100;

  return (
    <div className="mt-4 grid gap-4 rounded-md border border-border p-4">
      <div>
        <h3 className="flex items-center gap-2 font-bold">
          <Calculator className="h-4 w-4" /> Tüketim, geri dönüş ve batarya
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Aylık mahsuplaşma varsayılır: her ay tüketimi karşılayan üretim birim
          fiyattan, fazlası satış fiyatından değerlenir; tüketim aylara eşit
          dağıtılır. Müşteri dosyasına "Üretim ve kazanç" sayfası olarak
          eklenir.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Aylık tüketim (kWh)" hint="Faturadaki ortalama">
          <NumField
            value={finance.monthlyConsumptionKwh}
            onChange={(v) => set({ monthlyConsumptionKwh: Math.max(0, v) })}
          />
        </Field>
        <Field
          label="Birim fiyat (TL/kWh)"
          hint="Vergi ve fonlar dahil, faturadan"
        >
          <NumField
            value={finance.tariffTlPerKwh}
            onChange={(v) => set({ tariffTlPerKwh: Math.max(0, v) })}
          />
        </Field>
        <Field
          label="Veya aylık fatura (TL)"
          hint="Birim fiyat girildiyse tüketimi hesaplar"
        >
          <NumField
            value={bill}
            onChange={(v) => {
              setBill(v);
              if (v > 0 && finance.tariffTlPerKwh > 0) {
                set({
                  monthlyConsumptionKwh: Math.round(v / finance.tariffTlPerKwh),
                });
              }
            }}
          />
        </Field>
        <Field
          label="Fazla üretim fiyatı (TL/kWh)"
          hint="Ay sonu fazlanın satış fiyatı; bilinmiyorsa 0"
        >
          <NumField
            value={finance.exportTlPerKwh}
            onChange={(v) => set({ exportTlPerKwh: Math.max(0, v) })}
          />
        </Field>
        <Field
          label="Elektrik fiyat artışı (%/yıl)"
          hint="0 = bugünkü fiyatlarla (en temkinli)"
        >
          <NumField
            value={finance.tariffEscalationPct}
            onChange={(v) =>
              set({ tariffEscalationPct: Math.min(100, Math.max(0, v)) })
            }
          />
        </Field>
        <Field label="Gece tüketim payı (%)" hint="Batarya önerisi için">
          <NumField
            value={finance.nightSharePct}
            onChange={(v) =>
              set({ nightSharePct: Math.min(100, Math.max(0, v)) })
            }
          />
        </Field>
        <Field label="Panel verim kaybı (%/yıl)">
          <NumField
            value={finance.degradationPct}
            onChange={(v) =>
              set({ degradationPct: Math.min(5, Math.max(0, v)) })
            }
          />
        </Field>
        <label className="flex items-center gap-3 self-end pb-2 text-sm font-medium">
          <Switch
            checked={finance.includeVat}
            onCheckedChange={(includeVat) => set({ includeVat })}
          />
          Yatırıma KDV dahil (konut)
        </label>
      </div>

      {recommended > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-3 text-sm">
          <TrendingUp className="h-4 w-4" />
          Yıllık tüketimi karşılayan güç: <b>{formatKwp(recommended)} kWp</b>
          {kwp > 0 ? (
            <span className="text-muted-foreground">
              (şu an {formatKwp(kwp)} kWp, karşılama %
              {fmtNum((kwp / recommended) * 100, 0)})
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onTargetKwp(recommended)}
          >
            Bu güce ayarla
          </Button>
        </div>
      ) : null}

      {result ? (
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Yıllık üretim", `${fmtNum(result.annualProductionKwh, 0)} kWh`],
              ["Tüketimi karşılama", `%${fmtNum(result.coverage * 100, 0)}`],
              ["Yatırım", tl(result.investmentTl)],
              ["1. yıl tasarruf", tl(result.firstYearSavingTl)],
              [
                "Geri dönüş",
                result.paybackYears === null
                  ? "25 yılda dönmüyor"
                  : `${fmtNum(result.paybackYears, 1)} yıl`,
              ],
              ["25 yıl tasarruf", tl(result.totalSavingTl)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted p-2">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="text-sm font-bold">{value}</p>
              </div>
            ))}
          </div>
          <div
            className="relative flex h-24 gap-[2px]"
            aria-label="Kümülatif nakit akışı"
          >
            {result.cumulative.map((value, index) => (
              <div
                key={index}
                className="relative h-full flex-1"
                title={`${index + 1}. yıl: ${tl(value)}`}
              >
                <div
                  className={`absolute inset-x-0 ${value >= 0 ? "rounded-t-sm bg-emerald-500" : "rounded-b-sm bg-red-400"}`}
                  style={
                    value >= 0
                      ? {
                          bottom: `${100 - zeroPct}%`,
                          height: `${(value / span) * 100}%`,
                        }
                      : {
                          top: `${zeroPct}%`,
                          height: `${(-value / span) * 100}%`,
                        }
                  }
                />
              </div>
            ))}
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-foreground/40"
              style={{ top: `${zeroPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Çubuklar yıl sonu kümülatif nakdi gösterir (kırmızı: yatırım henüz
            dönmedi). Bakım, sigorta ve inverter değişimi dahil değildir.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {investmentTl === null
            ? "Geri dönüş için kur girilmeli (teklif TL dışında)."
            : "Geri dönüş için aylık tüketim, birim fiyat, panel ve kalemler gerekli."}
        </p>
      )}

      {battery ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm">
          <BatteryCharging className="h-4 w-4 text-emerald-600" />
          <span>
            Önerilen batarya:{" "}
            <b>
              {battery.count} × {battery.battery.brand ?? ""}{" "}
              {battery.battery.model ?? battery.battery.name} ={" "}
              {formatKwp(battery.totalKwh)} kWh
            </b>
            <span className="block text-xs text-muted-foreground">
              {battery.reason} Mahsuplaşmalı sistemde batarya faturayı ayrıca
              düşürmez; kesinti yedeği ve öz tüketim sağlar.
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onBattery(battery.battery.id, battery.count)}
          >
            Bataryayı ekle
          </Button>
        </div>
      ) : null}
    </div>
  );
}
