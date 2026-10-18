import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { useAccountingData } from "@/lib/accounting-data";
import { AccountsTab } from "@/components/accounting/accounts-tab";
import { CompanyTab } from "@/components/accounting/company-tab";
import { ExpensesTab } from "@/components/accounting/expenses-tab";
import { ReportsTab } from "@/components/accounting/reports-tab";
import { SuppliersTab } from "@/components/accounting/suppliers-tab";
import {
  AccessDenied,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Ön muhasebe: giderler, tedarikçiler, kasa/banka, raporlar, firma ve
// e-belge ayarı. Satış faturaları "Faturalar", müşteri carisi "Cari
// Hesaplar" sayfasındadır. Yalnız yönetici.
const TABS = [
  "giderler",
  "tedarikciler",
  "kasa-banka",
  "raporlar",
  "firma",
] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authenticated/accounting")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    TABS.includes(search.tab as Tab) ? { tab: search.tab as Tab } : {},
  component: AccountingPage,
});

function AccountingPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { tab = "giderler" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const query = useAccountingData(isAdmin);

  if (!isAdmin) return <AccessDenied />;
  if (query.isLoading)
    return <LoadingState label="Ön muhasebe yükleniyor..." />;
  if (query.error || !query.data) {
    return (
      <div className="surface-panel p-6 text-sm text-destructive">
        {errorMessage(query.error)}
      </div>
    );
  }
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Ön Muhasebe"
        description="Giderler, tedarikçiler, kasa ve banka, aylık KDV ve gelir-gider. Satış faturaları Faturalar'da, müşteri bakiyeleri Cari Hesaplar'da."
      />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          navigate({ search: { tab: v as Tab }, replace: true })
        }
      >
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="giderler">Giderler</TabsTrigger>
          <TabsTrigger value="tedarikciler">Tedarikçiler</TabsTrigger>
          <TabsTrigger value="kasa-banka">Kasa ve Banka</TabsTrigger>
          <TabsTrigger value="raporlar">Raporlar</TabsTrigger>
          <TabsTrigger value="firma">Firma ve e-Fatura</TabsTrigger>
        </TabsList>
        <TabsContent value="giderler">
          <ExpensesTab data={data} />
        </TabsContent>
        <TabsContent value="tedarikciler">
          <SuppliersTab data={data} />
        </TabsContent>
        <TabsContent value="kasa-banka">
          <AccountsTab data={data} />
        </TabsContent>
        <TabsContent value="raporlar">
          <ReportsTab data={data} />
        </TabsContent>
        <TabsContent value="firma">
          <CompanyTab data={data} />
        </TabsContent>
      </Tabs>
    </>
  );
}
