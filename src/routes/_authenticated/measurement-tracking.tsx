import { useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { formatTRY } from "@/lib/format";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/measurement-tracking")({
  component: MeasurementTrackingPage,
});
const initial = {
  customerName: "",
  contactName: "",
  contactPhone: "",
  location: "",
  serviceType: "Elektrik İç Tesisatı Uygunluk Raporu",
  serviceDate: "",
  reportStatus: "planned",
  paymentStatus: "pending",
  agreedAmount: "",
  collectedAmount: "",
  dueDate: "",
  vatRate: "20",
  notes: "",
};
const reportLabels: Record<string, string> = {
  planned: "Planlandı",
  measured: "Ölçüm yapıldı",
  approved: "Rapor onaylandı",
  delivered: "Müşteriye teslim edildi",
};
const paymentLabels: Record<string, string> = {
  pending: "Ödeme bekliyor",
  partial: "Kısmi tahsilat",
  paid: "Tahsil edildi",
  overdue: "Gecikmede",
};

function MeasurementTrackingPage() {
  const { role } = useAuth();
  const canManage = role === "admin";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const query = useQuery({
    queryKey: ["measurement-services"],
    enabled: canManage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("measurement_service_records")
        .select("*")
        .order("service_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const amount = Number(form.agreedAmount.replace(",", "."));
      const collected = Number(form.collectedAmount.replace(",", "."));
      const vat = Number(form.vatRate.replace(",", ".")) / 100;
      if (!form.customerName.trim() || !form.serviceType.trim())
        throw new Error("Müşteri ve hizmet türü zorunludur");
      if (
        !Number.isFinite(amount) ||
        amount < 0 ||
        !Number.isFinite(collected) ||
        collected < 0 ||
        !Number.isFinite(vat) ||
        vat < 0 ||
        vat > 1
      )
        throw new Error("Tutar veya KDV bilgisini kontrol edin");
      const { error } = await supabase
        .from("measurement_service_records")
        .insert({
          customer_name: form.customerName.trim(),
          contact_name: form.contactName.trim() || null,
          contact_phone: form.contactPhone.trim() || null,
          location: form.location.trim() || null,
          service_type: form.serviceType.trim(),
          service_date: form.serviceDate || null,
          report_status: form.reportStatus,
          payment_status: form.paymentStatus,
          agreed_amount: amount,
          vat_rate: vat,
          collected_amount: collected,
          due_date: form.dueDate || null,
          notes: form.notes.trim() || null,
        });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["measurement-services"] });
      setOpen(false);
      setForm(initial);
      toast.success("Hizmet kaydı eklendi");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          revenue: a.revenue + r.agreed_amount,
          collected: a.collected + r.collected_amount,
        }),
        { revenue: 0, collected: 0 },
      ),
    [rows],
  );
  async function exportExcel() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Hizmet ve Ödeme Takibi");
    ws.addRow([
      "Müşteri",
      "Hizmet",
      "Tarih",
      "Rapor durumu",
      "Ödeme durumu",
      "KDV hariç",
      "KDV",
      "Tahsilat",
      "Bakiye",
      "Vade",
    ]);
    rows.forEach((r) =>
      ws.addRow([
        r.customer_name,
        r.service_type,
        r.service_date,
        reportLabels[r.report_status],
        paymentLabels[r.payment_status],
        r.agreed_amount,
        r.agreed_amount * r.vat_rate,
        r.collected_amount,
        r.agreed_amount * (1 + r.vat_rate) - r.collected_amount,
        r.due_date,
      ]),
    );
    ws.columns.forEach((c) => (c.width = 22));
    const blob = new Blob([await wb.xlsx.writeBuffer()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nes-olcum-odeme-takibi.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }
  if (!canManage) return <AccessDenied />;
  if (query.isLoading)
    return <LoadingState label="Hizmet kayıtları yükleniyor..." />;
  return (
    <>
      <PageHeader
        title="Ölçüm, Raporlama ve Ödeme Takibi"
        description="Ölçüm hizmetlerini, rapor teslimini ve tahsilatları tek kayıttan yönetin."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportExcel}>
              <Download className="mr-2 h-4 w-4" />
              Excel Raporu Al
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Hizmet Kaydı Ekle
            </Button>
          </div>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="surface-panel p-4">
          <p className="text-xs text-muted-foreground">KDV hariç iş hacmi</p>
          <p className="text-xl font-black">{formatTRY(totals.revenue)}</p>
        </div>
        <div className="surface-panel p-4">
          <p className="text-xs text-muted-foreground">Toplam tahsilat</p>
          <p className="text-xl font-black text-success">
            {formatTRY(totals.collected)}
          </p>
        </div>
        <div className="surface-panel p-4">
          <p className="text-xs text-muted-foreground">Bekleyen alacak</p>
          <p className="text-xl font-black text-warning">
            {formatTRY(totals.revenue - totals.collected)}
          </p>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ölçüm / raporlama hizmeti ekle</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Müşteri / Firma", "customerName"],
              ["Yetkili", "contactName"],
              ["Telefon", "contactPhone"],
              ["İl / İlçe / Lokasyon", "location"],
              ["Hizmet türü", "serviceType"],
              ["KDV hariç bedel", "agreedAmount"],
              ["Tahsil edilen", "collectedAmount"],
            ].map(([label, key]) => (
              <label key={key} className="grid gap-1 text-sm">
                {label}
                <Input
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <label className="grid gap-1 text-sm">
              Ölçüm tarihi
              <Input
                type="date"
                value={form.serviceDate}
                onChange={(e) =>
                  setForm({ ...form, serviceDate: e.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Vade
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Rapor durumu
              <Select
                value={form.reportStatus}
                onValueChange={(v) => setForm({ ...form, reportStatus: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(reportLabels).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm">
              Ödeme durumu
              <Select
                value={form.paymentStatus}
                onValueChange={(v) => setForm({ ...form, paymentStatus: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(paymentLabels).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              Not
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </div>
          <DialogFooter>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {rows.length === 0 ? (
        <EmptyState
          title="Henüz hizmet kaydı yok"
          description="Ölçüm, test veya raporlama hizmetinizi ekleyin."
        />
      ) : (
        <section className="surface-panel overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Müşteri</TableHead>
                <TableHead>Hizmet</TableHead>
                <TableHead>Rapor</TableHead>
                <TableHead>Ödeme</TableHead>
                <TableHead className="text-right">Bakiye</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-bold">{r.customer_name}</TableCell>
                  <TableCell>{r.service_type}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {reportLabels[r.report_status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.payment_status === "paid" ? "success" : "warning"
                      }
                    >
                      {paymentLabels[r.payment_status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatTRY(
                      r.agreed_amount * (1 + r.vat_rate) - r.collected_amount,
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </>
  );
}
