import { useRef, useState } from "react";
import ExcelJS from "exceljs";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { downloadCsv, errorMessage, parseDelimitedText } from "@/lib/domain";
import { formatTRY } from "@/lib/format";
import {
  AccessDenied,
  EmptyState,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/stock")({
  component: StockPage,
});

type StockUnit = "adet" | "metre";

type ExcelStockRow = {
  name: string;
  brand: string;
  quantity: number;
  unit: StockUnit;
  unitPrice: number;
  existingId: string | undefined;
};

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function numericValue(value: unknown) {
  if (typeof value === "number") return value;
  return Number(
    String(value ?? "")
      .replace(/[^0-9,.-]/g, "")
      .replace(",", "."),
  );
}

function StockPage() {
  const { role } = useAuth();
  const canManageStock = role === "admin" || role === "technical_office";
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [excelPreview, setExcelPreview] = useState<ExcelStockRow[] | null>(
    null,
  );
  const [excelFileName, setExcelFileName] = useState("");
  const [importMode, setImportMode] = useState<"replace" | "add">("replace");
  const [form, setForm] = useState({
    code: "",
    name: "",
    unit: "adet" as StockUnit,
    quantity: "0",
    minQuantity: "0",
    unitPrice: "0",
    location: "",
    description: "",
  });

  const stockQuery = useQuery({
    queryKey: ["stock-items"],
    enabled: canManageStock,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_items")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const addItem = useMutation({
    mutationFn: async () => {
      const quantity = Number(form.quantity.replace(",", "."));
      const minQuantity = Number(form.minQuantity.replace(",", "."));
      const unitPrice = Number(form.unitPrice.replace(",", "."));
      if (
        !Number.isFinite(quantity) ||
        !Number.isFinite(minQuantity) ||
        !Number.isFinite(unitPrice)
      ) {
        throw new Error("Miktar ve fiyat alanlarını kontrol edin");
      }
      if (unitPrice < 0) {
        throw new Error("Birim fiyat negatif olamaz");
      }
      if (
        form.unit === "adet" &&
        (!Number.isInteger(quantity) || !Number.isInteger(minQuantity))
      ) {
        throw new Error("Adet biriminde küsurat kullanılamaz");
      }
      const { error } = await supabase.from("stock_items").insert({
        code: form.code.trim() || null,
        name: form.name.trim(),
        unit: form.unit,
        quantity,
        min_quantity: minQuantity,
        unit_price: unitPrice,
        location: form.location.trim() || null,
        description: form.description.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["stock-items"] });
      setOpen(false);
      setForm({
        code: "",
        name: "",
        unit: "adet",
        quantity: "0",
        minQuantity: "0",
        unitPrice: "0",
        location: "",
        description: "",
      });
      toast.success("Malzeme stoğa eklendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const importExcel = useMutation({
    mutationFn: async () => {
      if (!excelPreview?.length)
        throw new Error("Önce bir Excel dosyası seçin");
      const existingByName = new Map(
        items.map((item) => [normalized(item.name), item]),
      );
      const inserts = excelPreview
        .filter((row) => !row.existingId)
        .map((row) => ({
          name: row.name,
          unit: row.unit,
          quantity: row.quantity,
          min_quantity: 0,
          unit_price: row.unitPrice,
          description: row.brand ? `Marka: ${row.brand}` : null,
        }));
      const updates: Array<{
        id: string;
        quantity: number;
        unit_price: number;
        unit: StockUnit;
        description: string | null;
      }> = [];
      for (const row of excelPreview.filter(
        (candidate) => candidate.existingId,
      )) {
        const existing = existingByName.get(normalized(row.name));
        if (!existing) continue;
        updates.push({
          id: existing.id,
          quantity:
            importMode === "add"
              ? existing.quantity + row.quantity
              : row.quantity,
          unit_price: row.unitPrice,
          unit: row.unit,
          description: row.brand ? `Marka: ${row.brand}` : existing.description,
        });
      }
      if (inserts.length) {
        const { error } = await supabase.from("stock_items").insert(inserts);
        if (error) throw error;
      }
      if (updates.length) {
        for (const update of updates) {
          const { error } = await supabase
            .from("stock_items")
            .update(update)
            .eq("id", update.id);
          if (error) throw error;
        }
      }
      return { inserted: inserts.length, updated: updates.length };
    },
    onSuccess: async ({ inserted, updated }) => {
      await queryClient.invalidateQueries({ queryKey: ["stock-items"] });
      setExcelPreview(null);
      setExcelFileName("");
      toast.success(`${inserted} yeni, ${updated} mevcut stok kaydı işlendi`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  async function previewExcel(file: File) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("Excel içinde okunacak sayfa bulunamadı");
      const rows = sheet
        .getSheetValues()
        .slice(1)
        .map((row) =>
          (Array.isArray(row) ? row.slice(1) : []).map((cell) =>
            String(cell ?? "").trim(),
          ),
        );
      const headerIndex = rows.findIndex(
        (row) =>
          row.some((cell) => normalized(cell) === "marka") &&
          row.some((cell) => normalized(cell) === "model"),
      );
      if (headerIndex < 0)
        throw new Error("Excel'de MARKA ve MODEL başlıkları bulunamadı");
      const headers = rows[headerIndex].map(normalized);
      const indexOf = (...names: string[]) =>
        headers.findIndex((header) => names.includes(header));
      const brandIndex = indexOf("marka");
      const modelIndex = indexOf("model", "malzeme adı", "malzeme adi");
      const quantityIndex = indexOf("adet", "miktar", "stok");
      const priceIndex = indexOf("birim fiyat", "birim fiyat (₺)", "fiyat");
      if (brandIndex < 0 || modelIndex < 0 || quantityIndex < 0)
        throw new Error("Zorunlu sütunlar: MARKA, MODEL ve ADET");
      const existingByName = new Map(
        items.map((item) => [normalized(item.name), item.id]),
      );
      const parsed = rows
        .slice(headerIndex + 1)
        .map((row) => {
          const brand = row[brandIndex] ?? "";
          const model = row[modelIndex] ?? "";
          if (!brand && !model) return null;
          const quantity = numericValue(row[quantityIndex]);
          const unitPrice = priceIndex >= 0 ? numericValue(row[priceIndex]) : 0;
          if (
            !Number.isFinite(quantity) ||
            quantity < 0 ||
            !Number.isFinite(unitPrice) ||
            unitPrice < 0
          )
            throw new Error(`${brand} ${model}: miktar veya fiyat geçersiz`);
          const name = [brand, model].filter(Boolean).join(" · ");
          return {
            name,
            brand,
            quantity,
            unit: "adet" as StockUnit,
            unitPrice,
            existingId: existingByName.get(normalized(name)),
          };
        })
        .filter((row): row is ExcelStockRow => row !== null);
      if (!parsed.length)
        throw new Error("Excel'de aktarılacak malzeme bulunamadı");
      setExcelPreview(parsed);
      setExcelFileName(file.name);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function importCsv(file: File) {
    try {
      const rows = parseDelimitedText(await file.text());
      if (rows.length < 2)
        throw new Error("Dosyada aktarılacak satır bulunamadı");
      const headers = rows[0].map((cell) =>
        cell.toLocaleLowerCase("tr-TR").trim(),
      );
      const find = (...names: string[]) =>
        headers.findIndex((header) => names.includes(header));
      const indexes = {
        code: find("code", "kod", "malzeme kodu"),
        name: find("name", "ad", "malzeme adı", "malzeme adi"),
        unit: find("unit", "birim"),
        quantity: find("quantity", "miktar", "stok"),
        min: find("min_quantity", "minimum stok", "min stok"),
        location: find("location", "lokasyon", "konum"),
        description: find("description", "açıklama", "aciklama"),
      };
      if (
        indexes.code < 0 ||
        indexes.name < 0 ||
        indexes.unit < 0 ||
        indexes.quantity < 0
      ) {
        throw new Error("Zorunlu sütunlar: kod, malzeme adı, birim ve miktar");
      }
      const items = rows.slice(1).map((row) => {
        const unit =
          row[indexes.unit]?.toLocaleLowerCase("tr-TR") === "metre"
            ? "metre"
            : "adet";
        const quantity = Number(
          (row[indexes.quantity] || "0").replace(",", "."),
        );
        const minQuantity = Number((row[indexes.min] || "0").replace(",", "."));
        if (
          !row[indexes.code]?.trim() ||
          !row[indexes.name]?.trim() ||
          !Number.isFinite(quantity)
        ) {
          throw new Error("Dosyada boş kod/ad veya geçersiz miktar var");
        }
        return {
          code: row[indexes.code].trim(),
          name: row[indexes.name].trim(),
          unit: unit as StockUnit,
          quantity,
          min_quantity: Number.isFinite(minQuantity) ? minQuantity : 0,
          location:
            indexes.location >= 0
              ? row[indexes.location]?.trim() || null
              : null,
          description:
            indexes.description >= 0
              ? row[indexes.description]?.trim() || null
              : null,
        };
      });
      const { error } = await supabase
        .from("stock_items")
        .upsert(items, { onConflict: "code" });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["stock-items"] });
      toast.success(`${items.length} malzeme içe aktarıldı`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (!canManageStock) return <AccessDenied />;
  if (stockQuery.isLoading) return <LoadingState />;

  const items = stockQuery.data ?? [];
  const totalStockValue = items.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0,
  );
  const addButton = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-12 font-bold">
          <Plus className="mr-2 h-4 w-4" /> Malzeme Ekle
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stok kartı oluştur</DialogTitle>
          <DialogDescription>
            Kod benzersiz olmalıdır. Adet biriminde küsurat girilemez.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Kod
            <Input
              value={form.code}
              onChange={(event) =>
                setForm({ ...form, code: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            Malzeme Adı
            <Input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            Birim
            <Select
              value={form.unit}
              onValueChange={(unit: StockUnit) => setForm({ ...form, unit })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="adet">Adet</SelectItem>
                <SelectItem value="metre">Metre</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            Başlangıç Stoğu
            <Input
              inputMode="decimal"
              value={form.quantity}
              onChange={(event) =>
                setForm({ ...form, quantity: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            Minimum Stok
            <Input
              inputMode="decimal"
              value={form.minQuantity}
              onChange={(event) =>
                setForm({ ...form, minQuantity: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            Birim Fiyat (₺)
            <Input
              inputMode="decimal"
              value={form.unitPrice}
              onChange={(event) =>
                setForm({ ...form, unitPrice: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            Lokasyon
            <Input
              value={form.location}
              onChange={(event) =>
                setForm({ ...form, location: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            Açıklama
            <Input
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            onClick={() => addItem.mutate()}
            disabled={!form.name.trim() || addItem.isPending}
          >
            {addItem.isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        title="Malzeme Stok Kataloğu"
        description="NES deposundaki malzemeler ve kritik stok seviyeleri."
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(event) =>
                event.target.files?.[0] &&
                (event.target.files[0].name
                  .toLocaleLowerCase("tr-TR")
                  .endsWith(".csv")
                  ? importCsv(event.target.files[0])
                  : previewExcel(event.target.files[0]))
              }
            />
            <Button
              variant="outline"
              className="h-12"
              onClick={() => fileInput.current?.click()}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel'den İçe Aktar
            </Button>
            <Button
              variant="outline"
              className="h-12"
              onClick={() =>
                downloadCsv("nes-stok-katalogu.csv", [
                  [
                    "Kod",
                    "Malzeme Adı",
                    "Birim",
                    "Miktar",
                    "Minimum Stok",
                    "Lokasyon",
                    "Açıklama",
                  ],
                  ...items.map((item) => [
                    item.code,
                    item.name,
                    item.unit,
                    item.quantity,
                    item.min_quantity,
                    item.location,
                    item.description,
                  ]),
                ])
              }
            >
              <Download className="mr-2 h-4 w-4" /> Çıktı Al
            </Button>
            {addButton}
          </div>
        }
      />
      <Dialog
        open={Boolean(excelPreview)}
        onOpenChange={(isOpen) => !isOpen && setExcelPreview(null)}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Stok Excel önizlemesi</DialogTitle>
            <DialogDescription>
              {excelFileName} · Bu aşamada hiçbir stok kaydı henüz
              değiştirilmedi.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <span>
              <strong>
                {excelPreview?.filter((row) => !row.existingId).length ?? 0}
              </strong>{" "}
              yeni ·{" "}
              <strong>
                {excelPreview?.filter((row) => row.existingId).length ?? 0}
              </strong>{" "}
              mevcut kayıt
            </span>
            <Select
              value={importMode}
              onValueChange={(value) =>
                setImportMode(value as "replace" | "add")
              }
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="replace">
                  Mevcut stok miktarını Excel ile değiştir
                </SelectItem>
                <SelectItem value="add">
                  Excel miktarını mevcut stoğa ekle
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Malzeme</TableHead>
                  <TableHead className="text-right">Miktar</TableHead>
                  <TableHead className="text-right">Birim fiyat</TableHead>
                  <TableHead>İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(excelPreview ?? []).map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">
                      {row.quantity} {row.unit}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatTRY(row.unitPrice)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.existingId ? "warning" : "success"}>
                        {row.existingId ? "Mevcut kayıt" : "Yeni kayıt"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcelPreview(null)}>
              Vazgeç
            </Button>
            <Button
              onClick={() => importExcel.mutate()}
              disabled={importExcel.isPending}
            >
              {importExcel.isPending ? "İşleniyor..." : "Stoklara Aktar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Toplam Stok Değeri</p>
            <p className="text-3xl font-black text-highlight">
              {formatTRY(totalStockValue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">
              Kayıtlı Malzeme Kalemi
            </p>
            <p className="text-3xl font-black">{items.length}</p>
          </CardContent>
        </Card>
      </div>
      {items.length === 0 ? (
        <EmptyState
          title="Stok kataloğu boş"
          description="Tek tek malzeme ekleyin veya Excel'den CSV olarak dışa aktardığınız kataloğu yükleyin."
          action={addButton}
        />
      ) : (
        <section className="surface-panel overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-black">Stok Kataloğu</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Depodaki malzemeleri ve kritik stok durumlarını takip edin.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kod</TableHead>
                <TableHead>Malzeme</TableHead>
                <TableHead>Lokasyon</TableHead>
                <TableHead className="text-right">Stok</TableHead>
                <TableHead className="text-right">Birim Fiyat</TableHead>
                <TableHead className="text-right">Toplam Değer</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const low = item.quantity <= item.min_quantity;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">
                      {item.code || "—"}
                    </TableCell>
                    <TableCell className="font-bold">{item.name}</TableCell>
                    <TableCell>{item.location || "—"}</TableCell>
                    <TableCell className="text-right text-lg font-black">
                      {item.quantity} {item.unit}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatTRY(item.unit_price)}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {formatTRY(item.quantity * item.unit_price)}
                    </TableCell>
                    <TableCell>
                      {low ? (
                        <Badge variant="destructive">
                          <TriangleAlert className="mr-1 h-3 w-3" /> Kritik
                        </Badge>
                      ) : (
                        <Badge variant="outline">Yeterli</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      )}
    </>
  );
}
