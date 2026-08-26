import { useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  Download,
  ExternalLink,
  Plus,
  RotateCcw,
  WalletCards,
} from "lucide-react";
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

const blankContract = {
  companyName: "",
  contactName: "",
  contactTitle: "",
  contactPhone: "",
  contactEmail: "",
  contractDocumentUrl: "",
  subscriberNo: "",
  location: "",
  power: "",
  transformerType: "direk_tipi",
  engineer: "",
  start: "",
  end: "",
  fee: "",
  notes: "",
  renewedFrom: null as string | null,
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
const transformerTypeLabels: Record<string, string> = {
  direk_tipi: "Direk tipi",
  bina_tipi: "Bina tipi",
  diger: "Diğer",
};
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const isDriveFolderUrl = (value: string) =>
  /^https:\/\/drive\.google\.com\//i.test(value);
const isDriveDocumentUrl = (value: string) =>
  /^https:\/\/(drive|docs)\.google\.com\//i.test(value);
function contractMonths(start: string, end: string) {
  const result: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  cursor.setUTCDate(1);
  last.setUTCDate(1);
  while (cursor <= last) {
    result.push(isoDate(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}
function nextContractDates(endDate: string) {
  const start = new Date(`${endDate}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return { start: isoDate(start), end: isoDate(end) };
}
function renewalReminderDate(endDate: string) {
  const date = new Date(`${endDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 30);
  return isoDate(date);
}
function monthLabel(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}
function daysUntil(value: string, today: string) {
  return Math.ceil(
    (new Date(`${value}T12:00:00Z`).getTime() -
      new Date(`${today}T12:00:00Z`).getTime()) /
      86_400_000,
  );
}

function TransformerResponsibilityPage() {
  const { role } = useAuth();
  const allowed = role === "admin";
  const queryClient = useQueryClient();
  const [contractOpen, setContractOpen] = useState(false);
  const [contractForm, setContractForm] = useState(blankContract);
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkContractId, setCheckContractId] = useState<string | null>(null);
  const [checkForm, setCheckForm] = useState(blankCheck);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [paymentContractId, setPaymentContractId] = useState<string | null>(
    null,
  );
  const [companyDetailId, setCompanyDetailId] = useState<string | null>(null);
  const [companyContactId, setCompanyContactId] = useState<string | null>(null);
  const [companyContactForm, setCompanyContactForm] = useState({
    name: "",
    title: "",
    phone: "",
    email: "",
    driveFolderUrl: "",
  });
  const [contractDocumentId, setContractDocumentId] = useState<string | null>(
    null,
  );
  const [contractDocumentUrl, setContractDocumentUrl] = useState("");
  const [checkHistoryContractId, setCheckHistoryContractId] = useState<
    string | null
  >(null);
  const query = useQuery({
    queryKey: ["transformer-contracts"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transformer_responsibility_contracts")
        .select(
          "*, transformer_companies(*), transformer_monthly_checks(*), transformer_monthly_payments(*)",
        )
        .order("contract_end_date");
      if (error) throw error;
      return data;
    },
  });
  const teamQuery = useQuery({
    queryKey: ["team", "transformer-control-assignees"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "list_operational_team_members",
      );
      if (error) throw error;
      return data;
    },
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const teamMembers = useMemo(() => teamQuery.data ?? [], [teamQuery.data]);
  const today = isoDate(new Date());
  const selectedPaymentContract = useMemo(
    () => rows.find((item) => item.id === paymentContractId) ?? null,
    [paymentContractId, rows],
  );
  const selectedCompanyContracts = useMemo(
    () =>
      rows
        .filter((item) => item.company_id === companyDetailId)
        .sort((left, right) =>
          right.contract_end_date.localeCompare(left.contract_end_date),
        ),
    [companyDetailId, rows],
  );
  const selectedCompanyName = selectedCompanyContracts[0]?.customer_name ?? "";
  const selectedCompany = selectedCompanyContracts[0]?.transformer_companies;
  const selectedCheckHistoryContract = useMemo(
    () => rows.find((item) => item.id === checkHistoryContractId) ?? null,
    [checkHistoryContractId, rows],
  );

  const saveContract = useMutation({
    mutationFn: async () => {
      const power = contractForm.power
        ? Number(contractForm.power.replace(",", "."))
        : null;
      const fee = contractForm.fee
        ? Number(contractForm.fee.replace(",", "."))
        : 0;
      if (
        !contractForm.companyName.trim() ||
        !contractForm.subscriberNo.trim() ||
        !contractForm.start ||
        !contractForm.end
      )
        throw new Error("Firma adı, abone no ve sözleşme tarihleri zorunludur");
      if (
        !Number.isFinite(fee) ||
        fee < 0 ||
        (power !== null && (!Number.isFinite(power) || power <= 0))
      )
        throw new Error("Güç veya aylık bedeli kontrol edin");
      const companyName = contractForm.companyName.trim();
      const companyContact = {
        ...(contractForm.contactName.trim()
          ? { contact_name: contractForm.contactName.trim() }
          : {}),
        ...(contractForm.contactTitle.trim()
          ? { contact_title: contractForm.contactTitle.trim() }
          : {}),
        ...(contractForm.contactPhone.trim()
          ? { contact_phone: contractForm.contactPhone.trim() }
          : {}),
        ...(contractForm.contactEmail.trim()
          ? { contact_email: contractForm.contactEmail.trim().toLowerCase() }
          : {}),
      };
      const documentUrl = contractForm.contractDocumentUrl.trim();
      if (documentUrl && !isDriveDocumentUrl(documentUrl))
        throw new Error(
          "Sözleşme dosyası için geçerli bir Google Drive bağlantısı girin",
        );
      const { data: company, error: companyError } = await supabase
        .from("transformer_companies")
        .upsert(
          { company_name: companyName, ...companyContact },
          { onConflict: "company_name" },
        )
        .select("id")
        .single();
      if (companyError) throw companyError;
      const { error } = await supabase
        .from("transformer_responsibility_contracts")
        .insert({
          company_id: company.id,
          customer_name: companyName,
          subscriber_no: contractForm.subscriberNo.trim(),
          location: contractForm.location.trim() || null,
          transformer_power_kva: power,
          transformer_type: contractForm.transformerType,
          responsible_engineer: contractForm.engineer.trim() || null,
          contract_start_date: contractForm.start,
          contract_end_date: contractForm.end,
          monthly_fee: fee,
          contract_document_url: documentUrl || null,
          notes: contractForm.notes.trim() || null,
          renewed_from_contract_id: contractForm.renewedFrom,
        });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["transformer-contracts"],
      });
      setContractOpen(false);
      setContractForm(blankContract);
      toast.success("Yıllık sözleşme kaydedildi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveCheck = useMutation({
    mutationFn: async () => {
      if (!checkContractId) throw new Error("Sözleşme seçilemedi");
      const contract = rows.find((item) => item.id === checkContractId);
      if (!contract) throw new Error("Sözleşme bulunamadı");
      if (!checkForm.plannedDate)
        throw new Error("Takvim plan tarihi zorunludur");
      const { data: savedCheck, error } = await supabase
        .from("transformer_monthly_checks")
        .upsert(
          {
            contract_id: checkContractId,
            check_month: `${checkForm.month}-01`,
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
        title: `Trafo aylık kontrol · ${contract.subscriber_no}`,
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
      await queryClient.invalidateQueries({
        queryKey: ["transformer-contracts"],
      });
      setCheckOpen(false);
      setCheckContractId(null);
      setCheckForm(blankCheck);
      toast.success("Aylık kontrol kaydı güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveCompanyContact = useMutation({
    mutationFn: async () => {
      if (!companyContactId) throw new Error("Firma seçilemedi");
      const email = companyContactForm.email.trim().toLowerCase();
      const folderUrl = companyContactForm.driveFolderUrl.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Geçerli bir e-posta adresi girin");
      if (folderUrl && !isDriveFolderUrl(folderUrl))
        throw new Error(
          "Firma klasörü için geçerli bir Google Drive bağlantısı girin",
        );
      const { error } = await supabase
        .from("transformer_companies")
        .update({
          contact_name: companyContactForm.name.trim() || null,
          contact_title: companyContactForm.title.trim() || null,
          contact_phone: companyContactForm.phone.trim() || null,
          contact_email: email || null,
          drive_folder_url: folderUrl || null,
        })
        .eq("id", companyContactId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["transformer-contracts"],
      });
      setCompanyContactId(null);
      toast.success("Firma iletişim bilgileri güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveContractDocument = useMutation({
    mutationFn: async () => {
      if (!contractDocumentId) throw new Error("Sözleşme seçilemedi");
      const url = contractDocumentUrl.trim();
      if (url && !isDriveDocumentUrl(url))
        throw new Error("Geçerli bir Google Drive sözleşme bağlantısı girin");
      const { error } = await supabase
        .from("transformer_responsibility_contracts")
        .update({ contract_document_url: url || null })
        .eq("id", contractDocumentId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["transformer-contracts"],
      });
      setContractDocumentId(null);
      toast.success("Sözleşme bağlantısı güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveRenewalReminder = useMutation({
    mutationFn: async (contract: (typeof rows)[number]) => {
      const scheduledDate = renewalReminderDate(contract.contract_end_date);
      const payload = {
        title: `Sözleşme yenileme · ${contract.customer_name}`,
        event_type: "plan",
        scheduled_date: scheduledDate,
        end_date: scheduledDate,
        notes: `Abone No: ${contract.subscriber_no} · Sözleşme bitişi: ${contract.contract_end_date}`,
        status: "planned",
        transformer_contract_id: contract.id,
      };
      if (contract.renewal_calendar_event_id) {
        const { error } = await supabase
          .from("calendar_events")
          .update(payload)
          .eq("id", contract.renewal_calendar_event_id);
        if (error) throw error;
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Oturum bulunamadı");
      const { data: event, error: eventError } = await supabase
        .from("calendar_events")
        .insert({ ...payload, created_by: user.id })
        .select("id")
        .single();
      if (eventError) throw eventError;
      const { error: contractError } = await supabase
        .from("transformer_responsibility_contracts")
        .update({ renewal_calendar_event_id: event.id })
        .eq("id", contract.id);
      if (contractError) throw contractError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["transformer-contracts"],
      });
      toast.success("Yenileme planı uygulama takvimine eklendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const setPaid = useMutation({
    mutationFn: async ({ month, paid }: { month: string; paid: boolean }) => {
      if (!selectedPaymentContract) throw new Error("Sözleşme seçilemedi");
      const { error } = await supabase
        .from("transformer_monthly_payments")
        .upsert(
          {
            contract_id: selectedPaymentContract.id,
            payment_month: month,
            expected_amount: selectedPaymentContract.monthly_fee,
            received_amount: paid ? selectedPaymentContract.monthly_fee : 0,
            paid_at: paid ? today : null,
            status: paid ? "paid" : "pending",
          },
          { onConflict: "contract_id,payment_month" },
        );
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["transformer-contracts"] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const openCheckForMonth = (
    contract: (typeof rows)[number],
    monthDate: string,
  ) => {
    const existing = contract.transformer_monthly_checks?.find(
      (item: { check_month: string }) => item.check_month === monthDate,
    );
    setCheckContractId(contract.id);
    setCheckForm(
      existing
        ? {
            month: monthDate.slice(0, 7),
            plannedDate: existing.planned_date ?? monthDate,
            status: existing.status,
            checker: existing.checker_name ?? "",
            signer: existing.signed_by ?? "",
            notes: existing.notes ?? "",
          }
        : {
            ...blankCheck,
            month: monthDate.slice(0, 7),
            plannedDate: monthDate,
            checker: contract.responsible_engineer ?? "",
          },
    );
    setCheckOpen(true);
  };
  const openMonthlyCheck = (contract: (typeof rows)[number]) =>
    openCheckForMonth(contract, `${today.slice(0, 7)}-01`);

  async function excel() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Kontrol ve Tahsilat Takibi");
    worksheet.addRow([
      "Firma",
      "Abone No",
      "Adres / Lokasyon",
      "Trafo Tipi",
      "Sözleşme Bitiş",
      "Sorumlu Mühendis",
      "Aylık Bedel",
      "Ödeme Özeti",
      "Bu Ay Kontrol Durumu",
    ]);
    rows.forEach((contract) => {
      const currentCheck = contract.transformer_monthly_checks?.find(
        (item: { check_month: string }) =>
          item.check_month.slice(0, 7) === today.slice(0, 7),
      );
      const months = contractMonths(
        contract.contract_start_date,
        contract.contract_end_date,
      );
      const paidCount = contract.transformer_monthly_payments?.filter(
        (item: { status: string }) => item.status === "paid",
      ).length;
      worksheet.addRow([
        contract.customer_name,
        contract.subscriber_no,
        contract.location,
        transformerTypeLabels[contract.transformer_type ?? "diger"] ?? "Diğer",
        contract.contract_end_date,
        contract.responsible_engineer,
        contract.monthly_fee,
        `${paidCount ?? 0}/${months.length} ay ödendi`,
        currentCheck ? checkStatusLabels[currentCheck.status] : "Kayıt yok",
      ]);
    });
    worksheet.columns.forEach((column) => (column.width = 24));
    const blob = new Blob([await workbook.xlsx.writeBuffer()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "nes-trafo-kontrol-ve-tahsilat-listesi.xlsx";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!allowed) return <AccessDenied />;
  if (query.isLoading)
    return <LoadingState label="Sözleşmeler yükleniyor..." />;
  const openRenewal = (contract: (typeof rows)[number]) => {
    const dates = nextContractDates(contract.contract_end_date);
    setContractForm({
      companyName: contract.customer_name,
      contactName: contract.transformer_companies?.contact_name ?? "",
      contactTitle: contract.transformer_companies?.contact_title ?? "",
      contactPhone: contract.transformer_companies?.contact_phone ?? "",
      contactEmail: contract.transformer_companies?.contact_email ?? "",
      contractDocumentUrl: "",
      subscriberNo: contract.subscriber_no,
      location: contract.location ?? "",
      power: contract.transformer_power_kva?.toString() ?? "",
      transformerType: contract.transformer_type ?? "diger",
      engineer: contract.responsible_engineer ?? "",
      start: dates.start,
      end: dates.end,
      fee: contract.monthly_fee.toString(),
      notes: "",
      renewedFrom: contract.id,
    });
    setContractOpen(true);
  };
  const checkerSelection =
    teamMembers.find((member) => member.full_name === checkForm.checker)?.id ??
    (checkForm.checker ? "manual" : "none");

  return (
    <>
      <PageHeader
        title="Trafo İşletme Sorumluluğu"
        description="Firma sözleşmeleri, aylık tahsilat ve kontrol planı. Teknik rapor veya resmî imza yerine geçmez."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={excel}>
              <Download className="mr-2 h-4 w-4" />
              Excel Listesi
            </Button>
            <Button
              onClick={() => {
                setContractForm(blankContract);
                setContractOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Sözleşme Ekle
            </Button>
          </div>
        }
      />
      <Dialog open={contractOpen} onOpenChange={setContractOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {contractForm.renewedFrom ? "Sözleşme yenile" : "Yeni sözleşme"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm sm:col-span-2">
              Firma şirket adı
              <Input
                value={contractForm.companyName}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    companyName: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Firma yetkilisi
              <Input
                value={contractForm.contactName}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    contactName: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Yetkili unvanı
              <Input
                placeholder="Örn. İşletme müdürü"
                value={contractForm.contactTitle}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    contactTitle: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Muhatap telefon numarası
              <Input
                inputMode="tel"
                value={contractForm.contactPhone}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    contactPhone: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Yetkili e-posta
              <Input
                type="email"
                value={contractForm.contactEmail}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    contactEmail: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Abone No
              <Input
                value={contractForm.subscriberNo}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    subscriberNo: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Trafo tipi
              <Select
                value={contractForm.transformerType}
                onValueChange={(transformerType) =>
                  setContractForm({ ...contractForm, transformerType })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(transformerTypeLabels).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm">
              Adres / lokasyon
              <Input
                value={contractForm.location}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    location: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Trafo gücü (kVA)
              <Input
                inputMode="decimal"
                value={contractForm.power}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    power: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Sorumlu mühendis
              <Input
                value={contractForm.engineer}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    engineer: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Aylık bedel
              <Input
                inputMode="decimal"
                value={contractForm.fee}
                onChange={(event) =>
                  setContractForm({ ...contractForm, fee: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Sözleşme başlangıcı
              <Input
                type="date"
                value={contractForm.start}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    start: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Sözleşme bitişi
              <Input
                type="date"
                value={contractForm.end}
                onChange={(event) =>
                  setContractForm({ ...contractForm, end: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              İmzalı sözleşme Drive bağlantısı (opsiyonel)
              <Input
                type="url"
                placeholder="https://drive.google.com/..."
                value={contractForm.contractDocumentUrl}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    contractDocumentUrl: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              Not
              <Textarea
                value={contractForm.notes}
                onChange={(event) =>
                  setContractForm({
                    ...contractForm,
                    notes: event.target.value,
                  })
                }
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              onClick={() => saveContract.mutate()}
              disabled={saveContract.isPending}
            >
              {saveContract.isPending ? "Kaydediliyor..." : "Sözleşmeyi Kaydet"}
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
                onChange={(event) =>
                  setCheckForm({ ...checkForm, month: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Takvim plan tarihi
              <Input
                type="date"
                value={checkForm.plannedDate}
                onChange={(event) =>
                  setCheckForm({
                    ...checkForm,
                    plannedDate: event.target.value,
                  })
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
              Kontrole gidecek kişi
              <Select
                value={checkerSelection}
                onValueChange={(value) =>
                  setCheckForm({
                    ...checkForm,
                    checker:
                      value === "none" || value === "manual"
                        ? ""
                        : (teamMembers.find((member) => member.id === value)
                            ?.full_name ?? ""),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Kişi seçilmedi</SelectItem>
                  {teamMembers.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.full_name}
                    </SelectItem>
                  ))}
                  <SelectItem value="manual">Elle isim yaz</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm">
              Kontrol eden adı
              <Input
                placeholder="Ekip dışı kişi için elle yazın"
                value={checkForm.checker}
                onChange={(event) =>
                  setCheckForm({ ...checkForm, checker: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              İmzalayan / onaylayan
              <Input
                value={checkForm.signer}
                onChange={(event) =>
                  setCheckForm({ ...checkForm, signer: event.target.value })
                }
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              Not
              <Textarea
                value={checkForm.notes}
                onChange={(event) =>
                  setCheckForm({ ...checkForm, notes: event.target.value })
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
      <Dialog
        open={Boolean(checkHistoryContractId)}
        onOpenChange={(open) => {
          if (!open) setCheckHistoryContractId(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Aylık kontrol takvimi</DialogTitle>
          </DialogHeader>
          {selectedCheckHistoryContract && (
            <>
              <p className="text-sm text-muted-foreground">
                {selectedCheckHistoryContract.customer_name} · Abone No:{" "}
                {selectedCheckHistoryContract.subscriber_no}
              </p>
              <p className="text-sm text-muted-foreground">
                Kayıtlar takip içindir; teknik rapor veya resmî imza yerine
                geçmez.
              </p>
              <div className="max-h-[55vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ay</TableHead>
                      <TableHead>Plan tarihi</TableHead>
                      <TableHead>Durum</TableHead>
                      <TableHead>Kontrol eden</TableHead>
                      <TableHead className="text-right">İşlem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contractMonths(
                      selectedCheckHistoryContract.contract_start_date,
                      selectedCheckHistoryContract.contract_end_date,
                    ).map((month) => {
                      const check =
                        selectedCheckHistoryContract.transformer_monthly_checks?.find(
                          (item: { check_month: string }) =>
                            item.check_month === month,
                        );
                      return (
                        <TableRow key={month}>
                          <TableCell className="capitalize">
                            {monthLabel(month)}
                          </TableCell>
                          <TableCell>{check?.planned_date ?? "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                check?.status === "completed"
                                  ? "success"
                                  : check?.status === "not_completed"
                                    ? "destructive"
                                    : "secondary"
                              }
                            >
                              {check
                                ? checkStatusLabels[check.status]
                                : "Kayıt yok"}
                            </Badge>
                          </TableCell>
                          <TableCell>{check?.checker_name ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setCheckHistoryContractId(null);
                                openCheckForMonth(
                                  selectedCheckHistoryContract,
                                  month,
                                );
                              }}
                            >
                              {check ? "Düzenle" : "Kontrol Ekle"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={paymentsOpen} onOpenChange={setPaymentsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Aylık ödeme takibi</DialogTitle>
          </DialogHeader>
          {selectedPaymentContract && (
            <>
              <p className="text-sm text-muted-foreground">
                {selectedPaymentContract.customer_name} · Abone No:{" "}
                {selectedPaymentContract.subscriber_no}
              </p>
              <div className="max-h-[55vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ay</TableHead>
                      <TableHead>Beklenen bedel</TableHead>
                      <TableHead>Durum</TableHead>
                      <TableHead className="text-right">İşlem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contractMonths(
                      selectedPaymentContract.contract_start_date,
                      selectedPaymentContract.contract_end_date,
                    ).map((month) => {
                      const payment =
                        selectedPaymentContract.transformer_monthly_payments?.find(
                          (item: { payment_month: string }) =>
                            item.payment_month === month,
                        );
                      const paid = payment?.status === "paid";
                      return (
                        <TableRow key={month}>
                          <TableCell className="capitalize">
                            {monthLabel(month)}
                          </TableCell>
                          <TableCell>
                            {formatTRY(selectedPaymentContract.monthly_fee)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={paid ? "success" : "secondary"}>
                              {paid ? "Ödendi" : "Bekliyor"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={paid ? "outline" : "default"}
                              disabled={setPaid.isPending}
                              onClick={() =>
                                setPaid.mutate({ month, paid: !paid })
                              }
                            >
                              {paid
                                ? "Ödemeyi Geri Al"
                                : "Ödendi Olarak İşaretle"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(contractDocumentId)}
        onOpenChange={(open) => {
          if (!open) setContractDocumentId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>İmzalı sözleşme Drive bağlantısı</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Bu bağlantı yalnızca ilgili yıllık sözleşmeye aittir.
          </p>
          <label className="grid gap-1 text-sm">
            Google Drive / Doküman bağlantısı
            <Input
              type="url"
              placeholder="https://drive.google.com/..."
              value={contractDocumentUrl}
              onChange={(event) => setContractDocumentUrl(event.target.value)}
            />
          </label>
          <DialogFooter>
            <Button
              onClick={() => saveContractDocument.mutate()}
              disabled={saveContractDocument.isPending}
            >
              {saveContractDocument.isPending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(companyContactId)}
        onOpenChange={(open) => {
          if (!open) setCompanyContactId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Firma iletişim ve Drive bilgileri</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Yetkili adı
              <Input
                value={companyContactForm.name}
                onChange={(event) =>
                  setCompanyContactForm({
                    ...companyContactForm,
                    name: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Unvanı
              <Input
                value={companyContactForm.title}
                onChange={(event) =>
                  setCompanyContactForm({
                    ...companyContactForm,
                    title: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              Muhatap telefon numarası
              <Input
                inputMode="tel"
                value={companyContactForm.phone}
                onChange={(event) =>
                  setCompanyContactForm({
                    ...companyContactForm,
                    phone: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              E-posta
              <Input
                type="email"
                value={companyContactForm.email}
                onChange={(event) =>
                  setCompanyContactForm({
                    ...companyContactForm,
                    email: event.target.value,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              Firma Drive klasörü bağlantısı
              <Input
                type="url"
                placeholder="https://drive.google.com/..."
                value={companyContactForm.driveFolderUrl}
                onChange={(event) =>
                  setCompanyContactForm({
                    ...companyContactForm,
                    driveFolderUrl: event.target.value,
                  })
                }
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              onClick={() => saveCompanyContact.mutate()}
              disabled={saveCompanyContact.isPending}
            >
              {saveCompanyContact.isPending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(companyDetailId)}
        onOpenChange={(open) => {
          if (!open) setCompanyDetailId(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {selectedCompanyName || "Firma detayı"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Bu firmaya ait yıllık sözleşme geçmişi, tahsilat ve bu ayın kontrol
            durumu.
          </p>
          {selectedCompany && (
            <section className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row">
                <div>
                  <p className="text-sm font-medium">Firma yetkilisi</p>
                  {selectedCompany.contact_name ? (
                    <p className="mt-1">
                      {selectedCompany.contact_name}
                      {selectedCompany.contact_title
                        ? ` · ${selectedCompany.contact_title}`
                        : ""}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Yetkili bilgisi eklenmedi.
                    </p>
                  )}
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedCompany.contact_phone || "Telefon kaydı yok"}
                    {selectedCompany.contact_email
                      ? ` · ${selectedCompany.contact_email}`
                      : ""}
                  </p>
                  {selectedCompany.drive_folder_url && (
                    <Button
                      asChild
                      className="mt-3"
                      size="sm"
                      variant="outline"
                    >
                      <a
                        href={selectedCompany.drive_folder_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="mr-1 h-4 w-4" />
                        Firma Klasörünü Aç
                      </a>
                    </Button>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCompanyContactForm({
                      name: selectedCompany.contact_name ?? "",
                      title: selectedCompany.contact_title ?? "",
                      phone: selectedCompany.contact_phone ?? "",
                      email: selectedCompany.contact_email ?? "",
                      driveFolderUrl: selectedCompany.drive_folder_url ?? "",
                    });
                    setCompanyContactId(selectedCompany.id);
                    setCompanyDetailId(null);
                  }}
                >
                  İletişimi Düzenle
                </Button>
              </div>
            </section>
          )}
          <div className="max-h-[65vh] space-y-3 overflow-auto pr-1">
            {selectedCompanyContracts.map((contract) => {
              const months = contractMonths(
                contract.contract_start_date,
                contract.contract_end_date,
              );
              const paidCount = contract.transformer_monthly_payments?.filter(
                (item: { status: string }) => item.status === "paid",
              ).length;
              const currentCheck = contract.transformer_monthly_checks?.find(
                (item: { check_month: string }) =>
                  item.check_month.slice(0, 7) === today.slice(0, 7),
              );
              const renewalSoon =
                daysUntil(contract.contract_end_date, today) >= 0 &&
                daysUntil(contract.contract_end_date, today) <= 30;
              return (
                <section key={contract.id} className="rounded-lg border p-4">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row">
                    <div>
                      <p className="font-semibold">
                        Abone No: {contract.subscriber_no}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {transformerTypeLabels[
                          contract.transformer_type ?? "diger"
                        ] ?? "Diğer"}
                        {contract.transformer_power_kva
                          ? ` · ${contract.transformer_power_kva} kVA`
                          : ""}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {contract.contract_start_date} –{" "}
                        {contract.contract_end_date}
                      </p>
                      {contract.renewal_calendar_event_id && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Yenileme planı:{" "}
                          {renewalReminderDate(contract.contract_end_date)}
                        </p>
                      )}
                      {contract.location && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Adres: {contract.location}
                        </p>
                      )}
                    </div>
                    <Badge
                      className="h-fit w-fit"
                      variant={
                        contract.contract_end_date < today
                          ? "destructive"
                          : renewalSoon
                            ? "warning"
                            : "success"
                      }
                    >
                      {contract.contract_end_date < today
                        ? "Süresi geçti"
                        : renewalSoon
                          ? "Yenileme yaklaşıyor"
                          : "Aktif"}
                    </Badge>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="text-muted-foreground">Aylık bedel</p>
                      <p className="mt-1 font-semibold">
                        {formatTRY(contract.monthly_fee)}
                      </p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="text-muted-foreground">Tahsilat</p>
                      <p className="mt-1 font-semibold">
                        {paidCount ?? 0}/{months.length} ay ödendi
                      </p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="text-muted-foreground">Bu ay kontrol</p>
                      <p className="mt-1 font-semibold">
                        {currentCheck
                          ? checkStatusLabels[currentCheck.status]
                          : "Kayıt yok"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCompanyDetailId(null);
                        setPaymentContractId(contract.id);
                        setPaymentsOpen(true);
                      }}
                    >
                      <WalletCards className="mr-1 h-4 w-4" />
                      Ödemeleri Gör
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCompanyDetailId(null);
                        openMonthlyCheck(contract);
                      }}
                    >
                      <ClipboardCheck className="mr-1 h-4 w-4" />
                      Kontrol Kaydı
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCompanyDetailId(null);
                        setCheckHistoryContractId(contract.id);
                      }}
                    >
                      <CalendarDays className="mr-1 h-4 w-4" />
                      Kontrol Takvimi
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saveRenewalReminder.isPending}
                      onClick={() => saveRenewalReminder.mutate(contract)}
                    >
                      <CalendarPlus className="mr-1 h-4 w-4" />
                      {contract.renewal_calendar_event_id
                        ? "Yenileme Planını Güncelle"
                        : "Yenilemeyi Takvime Ekle"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setContractDocumentUrl(
                          contract.contract_document_url ?? "",
                        );
                        setContractDocumentId(contract.id);
                        setCompanyDetailId(null);
                      }}
                    >
                      Sözleşme Bağlantısı
                    </Button>
                    {contract.contract_document_url && (
                      <Button asChild size="sm" variant="outline">
                        <a
                          href={contract.contract_document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="mr-1 h-4 w-4" />
                          Sözleşmeyi Aç
                        </a>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCompanyDetailId(null);
                        openRenewal(contract);
                      }}
                    >
                      <RotateCcw className="mr-1 h-4 w-4" />
                      Yenile
                    </Button>
                  </div>
                </section>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
      {rows.length === 0 ? (
        <EmptyState
          title="Kayıtlı trafo sözleşmesi yok"
          description="İlk firma ve yıllık sözleşme kaydını ekleyin."
        />
      ) : (
        <section className="surface-panel overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Firma / Abone No</TableHead>
                <TableHead>Tip</TableHead>
                <TableHead>Sözleşme</TableHead>
                <TableHead>Aylık bedel</TableHead>
                <TableHead>Ödeme</TableHead>
                <TableHead>Bu ay kontrol</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((contract) => {
                const currentCheck = contract.transformer_monthly_checks?.find(
                  (item: { check_month: string }) =>
                    item.check_month.slice(0, 7) === today.slice(0, 7),
                );
                const months = contractMonths(
                  contract.contract_start_date,
                  contract.contract_end_date,
                );
                const paidCount = contract.transformer_monthly_payments?.filter(
                  (item: { status: string }) => item.status === "paid",
                ).length;
                const renewalSoon =
                  daysUntil(contract.contract_end_date, today) >= 0 &&
                  daysUntil(contract.contract_end_date, today) <= 30;
                return (
                  <TableRow key={contract.id}>
                    <TableCell>
                      <Button
                        variant="link"
                        className="h-auto p-0 font-bold text-foreground"
                        onClick={() => setCompanyDetailId(contract.company_id)}
                      >
                        {contract.customer_name}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Abone No: {contract.subscriber_no}
                      </p>
                      {contract.location && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {contract.location}
                        </p>
                      )}
                      {contract.transformer_companies?.contact_name && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Yetkili: {contract.transformer_companies.contact_name}
                          {contract.transformer_companies.contact_phone
                            ? ` · ${contract.transformer_companies.contact_phone}`
                            : ""}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {transformerTypeLabels[
                        contract.transformer_type ?? "diger"
                      ] ?? "Diğer"}
                    </TableCell>
                    <TableCell>
                      {contract.contract_start_date} –{" "}
                      {contract.contract_end_date}
                    </TableCell>
                    <TableCell>{formatTRY(contract.monthly_fee)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPaymentContractId(contract.id);
                          setPaymentsOpen(true);
                        }}
                      >
                        <WalletCards className="mr-1 h-4 w-4" />
                        {paidCount ?? 0}/{months.length}
                      </Button>
                    </TableCell>
                    <TableCell>
                      {currentCheck ? (
                        <Badge
                          variant={
                            currentCheck.status === "completed"
                              ? "success"
                              : currentCheck.status === "not_completed"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {checkStatusLabels[currentCheck.status]}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">Kayıt yok</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          contract.contract_end_date < today
                            ? "destructive"
                            : renewalSoon
                              ? "warning"
                              : "success"
                        }
                      >
                        {contract.contract_end_date < today
                          ? "Süresi geçti"
                          : renewalSoon
                            ? "Yenileme yaklaşıyor"
                            : "Aktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="min-w-[280px] text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openMonthlyCheck(contract)}
                        >
                          Kontrol
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openRenewal(contract)}
                        >
                          <RotateCcw className="mr-1 h-4 w-4" />
                          Yenile
                        </Button>
                      </div>
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
