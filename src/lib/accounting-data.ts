// Ön muhasebe sayfasının ortak verisi (tek sorgu, sekmeler paylaşır).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  CashAccount,
  CashTxn,
  IssuedInvoice,
  LedgerCollection,
  PurchaseBill,
} from "@/lib/accounting";

export type Supplier = {
  id: string;
  name: string;
  tax_no: string | null;
  tax_office: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  iban: string | null;
  notes: string | null;
  is_active: boolean;
};

export type CompanyProfile = {
  brand: string;
  legal_name: string;
  address: string;
  district: string;
  city: string;
  phone: string;
  email: string;
  web: string;
  tax_no: string;
  tax_office: string;
  trade_registry_no: string;
  mersis_no: string;
  logo_url: string;
  einvoice_provider: "manual" | "parasut";
  einvoice_activation_date: string | null;
  invoice_footer_note: string;
};

export const ACCOUNTING_KEY = ["accounting"] as const;

export function useAccountingData(enabled: boolean) {
  return useQuery({
    queryKey: ACCOUNTING_KEY,
    enabled,
    queryFn: async () => {
      const [
        suppliers,
        bills,
        accounts,
        txns,
        collections,
        invoices,
        projects,
        customers,
        company,
      ] = await Promise.all([
        supabase
          .from("suppliers")
          .select(
            "id, name, tax_no, tax_office, address, phone, email, iban, notes, is_active",
          )
          .order("name"),
        supabase
          .from("purchase_bills")
          .select(
            "id, supplier_id, document_type, document_no, ettn, issue_date, due_date, category, description, project_id, currency, exchange_rate, net_amount, vat_amount, withholding_amount, total_amount, attachment_path, source, notes",
          )
          .order("issue_date", { ascending: false }),
        supabase
          .from("cash_accounts")
          .select(
            "id, name, kind, currency, bank_name, iban, opening_balance, opening_date, show_on_invoice, is_active, sort_order",
          )
          .order("sort_order"),
        supabase
          .from("cash_transactions")
          .select(
            "id, account_id, txn_date, direction, amount, kind, category, description, supplier_id, purchase_bill_id, project_id, transfer_group",
          )
          .order("txn_date", { ascending: false }),
        supabase
          .from("customer_ledger_entries")
          .select(
            "id, account_id, entry_date, amount, currency, customer_id, description, document_no",
          )
          .eq("entry_type", "tahsilat"),
        supabase
          .from("invoices")
          .select(
            "id, issue_date, currency, exchange_rate, subtotal, vat_total, withholding_total, payable_total, invoice_type, gib_invoice_no, buyer_title, buyer_tax_no",
          )
          .eq("status", "kesildi"),
        supabase.from("projects").select("id, name").order("name"),
        supabase.from("customers").select("id, name"),
        supabase.from("company_profile").select("*").eq("id", 1).maybeSingle(),
      ]);
      for (const r of [
        suppliers,
        bills,
        accounts,
        txns,
        collections,
        invoices,
        projects,
        customers,
        company,
      ]) {
        if (r.error) throw r.error;
      }
      return {
        suppliers: (suppliers.data ?? []) as Supplier[],
        bills: (bills.data ?? []) as PurchaseBill[],
        accounts: (accounts.data ?? []) as CashAccount[],
        txns: (txns.data ?? []) as CashTxn[],
        collections: (collections.data ?? []) as LedgerCollection[],
        invoices: (invoices.data ?? []) as (IssuedInvoice & {
          gib_invoice_no: string | null;
          buyer_title: string;
          buyer_tax_no: string | null;
        })[],
        projects: projects.data ?? [],
        customers: customers.data ?? [],
        company: (company.data ?? null) as CompanyProfile | null,
      };
    },
  });
}

export type AccountingData = NonNullable<
  ReturnType<typeof useAccountingData>["data"]
>;

export function useRefreshAccounting() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ACCOUNTING_KEY });
    await queryClient.invalidateQueries({ queryKey: ["ledger"] });
    await queryClient.invalidateQueries({ queryKey: ["receivables-page"] });
  };
}

/** Belge eki için 10 dakikalık imzalı bağlantı. */
export async function openFinanceDocument(path: string) {
  const { data, error } = await supabase.storage
    .from("finance-documents")
    .createSignedUrl(path, 600);
  if (error) throw error;
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

export async function uploadFinanceDocument(prefix: string, file: File) {
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${prefix}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage
    .from("finance-documents")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return path;
}
