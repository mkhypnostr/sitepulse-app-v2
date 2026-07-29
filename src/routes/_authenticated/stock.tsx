import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { downloadCsv, errorMessage, parseDelimitedText } from "@/lib/domain";
import { AccessDenied, EmptyState, LoadingState, PageHeader } from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function StockPage() {
  const { role } = useAuth();
  const canManageStock = role === "admin" || role === "technical_office";
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    unit: "adet" as StockUnit,
    quantity: "0",
    minQuantity: "0",
    location: "",
    description: "",
  });

  const stockQuery = useQuery({
    queryKey: ["stock-items"],
    enabled: canManageStock,
    queryFn: async () => {
      const { data, error } = await supabase.from("stock_items").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const addItem = useMutation({
    mutationFn: async () => {
      const quantity = Number(form.quantity.replace(",", "."));
      const minQuantity = Number(form.minQuantity.replace(",", "."));
      if (!Number.isFinite(quantity) || !Number.isFinite(minQuantity)) {
        throw new Error("Miktar alanlarını kontrol edin");
      }
      if (form.unit === "adet" && (!Number.isInteger(quantity) || !Number.isInteger(minQuantity))) {
        throw new Error("Adet biriminde küsurat kullanılamaz");
      }
      const { error } = await supabase.from("stock_items").insert({
        code: form.code.trim() || null,
        name: form.name.trim(),
        unit: form.unit,
        quantity,
        min_quantity: minQuantity,
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
        location: "",
        description: "",
      });
      toast.success("Malzeme stoğa eklendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  async function importCsv(file: File) {
    try {
      const rows = parseDelimitedText(await file.text());
      if (rows.length < 2) throw new Error("Dosyada aktarılacak satır bulunamadı");
      const headers = rows[0].map((cell) => cell.toLocaleLowerCase("tr-TR").trim());
      const find = (...names: string[]) => headers.findIndex((header) => names.includes(header));
      const indexes = {
        code: find("code", "kod", "malzeme kodu"),
        name: find("name", "ad", "malzeme adı", "malzeme adi"),
        unit: find("unit", "birim"),
        quantity: find("quantity", "miktar", "stok"),
        min: find("min_quantity", "minimum stok", "min stok"),
        location: find("location", "lokasyon", "konum"),
        description: find("description", "açıklama", "aciklama"),
      };
      if (indexes.code < 0 || indexes.name < 0 || indexes.unit < 0 || indexes.quantity < 0) {
        throw new Error("Zorunlu sütunlar: kod, malzeme adı, birim ve miktar");
      }
      const items = rows.slice(1).map((row) => {
        const unit = row[indexes.unit]?.toLocaleLowerCase("tr-TR") === "metre" ? "metre" : "adet";
        const quantity = Number((row[indexes.quantity] || "0").replace(",", "."));
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
          location: indexes.location >= 0 ? row[indexes.location]?.trim() || null : null,
          description: indexes.description >= 0 ? row[indexes.description]?.trim() || null : null,
        };
      });
      const { error } = await supabase.from("stock_items").upsert(items, { onConflict: "code" });
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
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Malzeme Adı
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
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
              onChange={(event) => setForm({ ...form, quantity: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Minimum Stok
            <Input
              inputMode="decimal"
              value={form.minQuantity}
              onChange={(event) => setForm({ ...form, minQuantity: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Lokasyon
            <Input
              value={form.location}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            Açıklama
            <Input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
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
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => event.target.files?.[0] && importCsv(event.target.files[0])}
            />
            <Button variant="outline" className="h-12" onClick={() => fileInput.current?.click()}>
              <FileUp className="mr-2 h-4 w-4" /> Excel CSV Yükle
            </Button>
            <Button
              variant="outline"
              className="h-12"
              onClick={() =>
                downloadCsv("nes-stok-katalogu.csv", [
                  ["Kod", "Malzeme Adı", "Birim", "Miktar", "Minimum Stok", "Lokasyon", "Açıklama"],
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
            <p className="mt-1 text-sm text-muted-foreground">Depodaki malzemeleri ve kritik stok durumlarını takip edin.</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kod</TableHead>
                <TableHead>Malzeme</TableHead>
                <TableHead>Lokasyon</TableHead>
                <TableHead className="text-right">Stok</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const low = item.quantity <= item.min_quantity;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.code || "—"}</TableCell>
                    <TableCell className="font-bold">{item.name}</TableCell>
                    <TableCell>{item.location || "—"}</TableCell>
                    <TableCell className="text-right text-lg font-black">
                      {item.quantity} {item.unit}
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
