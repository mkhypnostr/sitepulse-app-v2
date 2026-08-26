import { useState } from "react";
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

export const Route = createFileRoute(
  "/_authenticated/transformer-responsibility",
)({ component: TransformerResponsibilityPage });
const blank = {
  customer: "",
  facility: "",
  location: "",
  power: "",
  voltage: "",
  engineer: "",
  start: "",
  end: "",
  fee: "",
  notes: "",
};
const blankCheck = {
  month: new Date().toISOString().slice(0, 7),
  plannedDate: new Date().toISOString().slice(0, 10),
  status: "planned",
  checker: "",
  signer: "",
  notes: "",
};
const checkStatusLabels: Record<string, string> = {
  planned: "Planlandı",
  completed: "Tamamlandı",
  not_completed: "Yapılmadı",
};
function TransformerResponsibilityPage() {
  const { role } = useAuth();
  const allowed = role === "admin";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkContractId, setCheckContractId] = useState<string | null>(null);
  const [checkForm, setCheckForm] = useState(blankCheck);
  const q = useQuery({
    queryKey: ["transformer-contracts"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transformer_responsibility_contracts")
        .select("*, transformer_monthly_checks(*)")
        .order("contract_end_date");
      if (error) throw error;
      return data;
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const power = form.power ? Number(form.power.replace(",", ".")) : null,
        fee = form.fee ? Number(form.fee.replace(",", ".")) : 0;
      if (
        !form.customer.trim() ||
        !form.facility.trim() ||
        !form.start ||
        !form.end
      )
        throw new Error("Müşteri, tesis ve sözleşme tarihleri zorunludur");
      if (
        !Number.isFinite(fee) ||
        fee < 0 ||
        (power !== null && (!Number.isFinite(power) || power <= 0))
      )
        throw new Error("Güç veya aylık bedeli kontrol edin");
      const { error } = await supabase
        .from("transformer_responsibility_contracts")
        .insert({
          customer_name: form.customer.trim(),
          facility_name: form.facility.trim(),
          location: form.location.trim() || null,
          transformer_power_kva: power,
          voltage_level: form.voltage.trim() || null,
          responsible_engineer: form.engineer.trim() || null,
          contract_start_date: form.start,
          contract_end_date: form.end,
          monthly_fee: fee,
          notes: form.notes.trim() || null,
        });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["transformer-contracts"] });
      setOpen(false);
      setForm(blank);
      toast.success("İşletme sorumluluğu sözleşmesi kaydedildi");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveCheck = useMutation({
    mutationFn: async () => {
      if (!checkContractId) throw new Error("Sözleşme seçilemedi");
      const contract = rows.find((item) => item.id === checkContractId);
      if (!contract) throw new Error("Sözleşme bulunamadı");
      if (!checkForm.plannedDate)
        throw new Error("Takvim plan tarihi zorunludur");
      const checkMonth = `${checkForm.month}-01`;
      const { data: savedCheck, error } = await supabase
        .from("transformer_monthly_checks")
        .upsert(
          {
            contract_id: checkContractId,
            check_month: checkMonth,
            planned_date: checkForm.plannedDate,
            checked_at:
              checkForm.status === "completed"
                ? new Date().toISOString()
                : null,
            checker_name: checkForm.checker.trim() || null,
            signed_by: checkForm.signer.trim() || null,
            status: checkForm.status,
            notes: checkForm.notes.trim() || null,
          },
          { onConflict: "contract_id,check_month" },
        )
        .select()
        .single();
      if (error) throw error;

      const calendarPayload = {
        title: `Trafo aylık kontrol · ${contract.facility_name}`,
        event_type: "plan",
        scheduled_date: checkForm.plannedDate,
        end_date: checkForm.plannedDate,
        notes: `${contract.customer_name} · ${checkForm.month} aylık kontrol takibi`,
        status:
          checkForm.status === "completed"
            ? "completed"
            : checkForm.status === "not_completed"
              ? "cancelled"
              : "planned",
        transformer_contract_id: contract.id,
      };
      if (savedCheck.calendar_event_id) {
        const { error: calendarError } = await supabase
          .from("calendar_events")
          .update(calendarPayload)
          .eq("id", savedCheck.calendar_event_id);
        if (calendarError) throw calendarError;
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Oturum bulunamadı");
        const { data: calendarEvent, error: calendarError } = await supabase
          .from("calendar_events")
          .insert({ ...calendarPayload, created_by: user.id })
          .select("id")
          .single();
        if (calendarError) throw calendarError;
        const { error: linkError } = await supabase
          .from("transformer_monthly_checks")
          .update({ calendar_event_id: calendarEvent.id })
          .eq("id", savedCheck.id);
        if (linkError) throw linkError;
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["transformer-contracts"] });
      setCheckOpen(false);
      setCheckContractId(null);
      setCheckForm(blankCheck);
      toast.success("Aylık kontrol kaydı güncellendi");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = q.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  async function excel() {
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet("Aylık Kontrol Takibi");
    ws.addRow([
      "Müşteri",
      "Tesis",
      "Sözleşme Bitiş",
      "Sorumlu Mühendis",
      "Aylık Bedel",
      "Plan Tarihi",
      "Bu Ay Kontrol Durumu",
      "Kontrol Eden",
      "İmzalayan",
    ]);
    rows.forEach((r) => {
      const c = r.transformer_monthly_checks?.find(
        (x: { check_month: string }) =>
          x.check_month.slice(0, 7) === today.slice(0, 7),
      );
      ws.addRow([
        r.customer_name,
        r.facility_name,
        r.contract_end_date,
        r.responsible_engineer,
        r.monthly_fee,
        c?.planned_date ?? "",
        c?.status ?? "Planlanmadı",
        c?.checker_name ?? "",
        c?.signed_by ?? "",
      ]);
    });
    ws.columns.forEach((c) => (c.width = 24));
    const b = new Blob([await wb.xlsx.writeBuffer()], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      u = URL.createObjectURL(b),
      a = document.createElement("a");
    a.href = u;
    a.download = "nes-trafo-aylik-kontrol-listesi.xlsx";
    a.click();
    URL.revokeObjectURL(u);
  }
  if (!allowed) return <AccessDenied />;
  if (q.isLoading) return <LoadingState label="Sözleşmeler yükleniyor..." />;
  return (
    <>
      <PageHeader
        title="Trafo İşletme Sorumluluğu"
        description="Sözleşme bitişi ve aylık kontrol takip kaydı. Teknik rapor veya resmî imza yerine geçmez."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={excel}>
              <Download className="mr-2 h-4 w-4" />
              Excel Listesi
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Sözleşme Ekle
            </Button>
          </div>
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>İşletme sorumluluğu sözleşmesi</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Müşteri / Firma", "customer"],
              ["Tesis / Trafo adı", "facility"],
              ["Lokasyon", "location"],
              ["Trafo gücü (kVA)", "power"],
              ["Gerilim seviyesi", "voltage"],
              ["Sorumlu mühendis", "engineer"],
              ["Aylık bedel", "fee"],
            ].map(([l, k]) => (
              <label key={k} className="grid gap-1 text-sm">
                {l}
                <Input
                  value={form[k as keyof typeof form]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ))}
            <label className="grid gap-1 text-sm">
              Başlangıç
              <Input
                type="date"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Bitiş
              <Input
                type="date"
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
              />
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
      <Dialog
        open={checkOpen}
        onOpenChange={(value) => {
          setCheckOpen(value);
          if (!value) setCheckContractId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aylık kontrol / imza kaydı</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Bu kayıt takip amaçlıdır; teknik kontrol raporu veya resmî imza
            yerine geçmez.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Kontrol ayı
              <Input
                type="month"
                value={checkForm.month}
                onChange={(e) =>
                  setCheckForm({ ...checkForm, month: e.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Takvim plan tarihi
              <Input
                type="date"
                value={checkForm.plannedDate}
                onChange={(e) =>
                  setCheckForm({ ...checkForm, plannedDate: e.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Durum
              <Select
                value={checkForm.status}
                onValueChange={(status) =>
                  setCheckForm({ ...checkForm, status })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(checkStatusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm">
              Kontrol eden
              <Input
                value={checkForm.checker}
                onChange={(e) =>
                  setCheckForm({ ...checkForm, checker: e.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              İmzalayan / onaylayan
              <Input
                value={checkForm.signer}
                onChange={(e) =>
                  setCheckForm({ ...checkForm, signer: e.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              Not
              <Textarea
                value={checkForm.notes}
                onChange={(e) =>
                  setCheckForm({ ...checkForm, notes: e.target.value })
                }
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              onClick={() => saveCheck.mutate()}
              disabled={saveCheck.isPending}
            >
              {saveCheck.isPending ? "Kaydediliyor..." : "Kontrolü Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {rows.length === 0 ? (
        <EmptyState
          title="Kayıtlı trafo sorumluluğu yok"
          description="İlk tesis sözleşmesini ekleyin."
        />
      ) : (
        <section className="surface-panel overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Müşteri / Tesis</TableHead>
                <TableHead>Sözleşme</TableHead>
                <TableHead>Sorumlu</TableHead>
                <TableHead>Aylık bedel</TableHead>
                <TableHead>Bu ay kontrol</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <p className="font-bold">{r.customer_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.facility_name}
                    </p>
                  </TableCell>
                  <TableCell>
                    {r.contract_start_date} – {r.contract_end_date}
                  </TableCell>
                  <TableCell>{r.responsible_engineer || "—"}</TableCell>
                  <TableCell>{formatTRY(r.monthly_fee)}</TableCell>
                  <TableCell>
                    {(() => {
                      const check = r.transformer_monthly_checks?.find(
                        (item: { check_month: string }) =>
                          item.check_month.slice(0, 7) === today.slice(0, 7),
                      );
                      return check ? (
                        <Badge
                          variant={
                            check.status === "completed"
                              ? "success"
                              : check.status === "not_completed"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {checkStatusLabels[check.status]}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">Kayıt yok</span>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.contract_end_date < today ? "destructive" : "success"
                      }
                    >
                      {r.contract_end_date < today ? "Süresi geçti" : "Aktif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const existing = r.transformer_monthly_checks?.find(
                          (item: { check_month: string }) =>
                            item.check_month.slice(0, 7) === today.slice(0, 7),
                        );
                        setCheckContractId(r.id);
                        setCheckForm(
                          existing
                            ? {
                                month: today.slice(0, 7),
                                plannedDate: existing.planned_date ?? today,
                                status: existing.status,
                                checker: existing.checker_name ?? "",
                                signer: existing.signed_by ?? "",
                                notes: existing.notes ?? "",
                              }
                            : blankCheck,
                        );
                        setCheckOpen(true);
                      }}
                    >
                      {r.transformer_monthly_checks?.some(
                        (item: { check_month: string }) =>
                          item.check_month.slice(0, 7) === today.slice(0, 7),
                      )
                        ? "Kontrolü Güncelle"
                        : "Kontrol Ekle"}
                    </Button>
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
