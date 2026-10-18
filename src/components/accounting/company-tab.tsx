// Firma bilgileri (faturadaki satıcı) ve e-belge sağlayıcısı ayarı.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/domain";
import {
  useRefreshAccounting,
  type AccountingData,
  type CompanyProfile,
} from "@/lib/accounting-data";
import { einvoiceStatus, providerLabels } from "@/lib/einvoice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/accounting/expenses-tab";

const fields: { key: keyof CompanyProfile; label: string; wide?: boolean }[] = [
  { key: "legal_name", label: "Ticari unvan", wide: true },
  { key: "brand", label: "Marka" },
  { key: "web", label: "Web" },
  { key: "address", label: "Adres", wide: true },
  { key: "district", label: "İlçe / il (faturada ikinci satır)" },
  { key: "city", label: "İl" },
  { key: "phone", label: "Telefon" },
  { key: "email", label: "E-posta" },
  { key: "tax_no", label: "Vergi no (VKN)" },
  { key: "tax_office", label: "Vergi dairesi" },
  { key: "trade_registry_no", label: "Ticaret sicil no" },
  { key: "mersis_no", label: "MERSİS no (16 hane)" },
];

export function CompanyTab({ data }: { data: AccountingData }) {
  const refresh = useRefreshAccounting();
  const [form, setForm] = useState<CompanyProfile | null>(data.company);
  const status = useQuery({
    queryKey: ["einvoice-status"],
    queryFn: einvoiceStatus,
    retry: false,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const { error } = await supabase
        .from("company_profile")
        .update({
          brand: form.brand.trim(),
          legal_name: form.legal_name.trim(),
          address: form.address.trim(),
          district: form.district.trim(),
          city: form.city.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          web: form.web.trim(),
          tax_no: form.tax_no.replace(/\D/g, ""),
          tax_office: form.tax_office.trim(),
          trade_registry_no: form.trade_registry_no.trim(),
          mersis_no: form.mersis_no.replace(/\D/g, ""),
          einvoice_provider: form.einvoice_provider,
          einvoice_activation_date: form.einvoice_activation_date || null,
          invoice_footer_note: form.invoice_footer_note.trim(),
        })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Firma bilgileri kaydedildi.");
      await refresh();
      await status.refetch();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!form) {
    return (
      <p className="text-sm text-muted-foreground">Firma kaydı bulunamadı.</p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="surface-panel p-4">
        <h3 className="mb-1 font-bold">Firma bilgileri</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Faturalarda satıcı olarak bu bilgiler yazar. Yazılım firmadan
          bağımsızdır; başka bir şirket için kurulduğunda yalnız bu sayfa
          değişir.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              className={f.wide ? "sm:col-span-2" : undefined}
            >
              <Input
                value={String(form[f.key] ?? "")}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className="h-11"
              />
            </Field>
          ))}
          <Field
            label="Fatura alt notu (isteğe bağlı)"
            className="sm:col-span-2"
          >
            <Textarea
              value={form.invoice_footer_note}
              maxLength={500}
              rows={2}
              onChange={(e) =>
                setForm({ ...form, invoice_footer_note: e.target.value })
              }
            />
          </Field>
        </div>
      </div>

      <div className="space-y-4">
        <div className="surface-panel p-4">
          <h3 className="mb-1 flex items-center gap-2 font-bold">
            <PlugZap className="h-4 w-4" /> e-Fatura gönderimi
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Faturanın GİB&apos;e nasıl gideceği. &quot;Elle&quot;de faturayı GİB
            portalında veya entegratör ekranında kesip numarasını girersiniz.
            &quot;Paraşüt API&quot;de Faturalar ekranındaki &quot;Kes&quot;
            düğmesi faturayı doğrudan gönderir.
          </p>
          <Field label="Yöntem">
            <Select
              value={form.einvoice_provider}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  einvoice_provider: v as CompanyProfile["einvoice_provider"],
                })
              }
            >
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(providerLabels).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="e-Fatura aktivasyon tarihi" className="mt-3">
            <Input
              type="date"
              value={form.einvoice_activation_date ?? ""}
              onChange={(e) =>
                setForm({ ...form, einvoice_activation_date: e.target.value })
              }
              className="h-11"
            />
          </Field>
          <div className="mt-3 rounded-xl border border-border p-3 text-xs">
            {status.isLoading ? (
              "Bağlantı durumu kontrol ediliyor..."
            ) : status.data?.ready ? (
              <span className="flex items-start gap-2 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{" "}
                {status.data.message}
              </span>
            ) : (
              <span className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {status.data?.message ?? errorMessage(status.error)}
              </span>
            )}
          </div>
        </div>
        <Button
          className="h-11 w-full font-bold"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>
    </div>
  );
}
