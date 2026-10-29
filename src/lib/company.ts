// NES firma bilgileri (kesilmiş e-Faturalardaki satıcı bilgileriyle aynı).
// Fatura görünümü ve UBL-TR XML'de satıcı olarak kullanılır.
export type CompanyInfo = {
  brand: string;
  legalName: string;
  address: string;
  district: string;
  city: string;
  phone: string;
  email: string;
  web: string;
  taxNo: string;
  taxOffice: string;
  tradeRegistryNo: string;
  mersisNo: string;
  bank: string;
  iban: string;
  logoUrl: string;
  footerNote: string;
};

// Yedek değerler: company_profile okunamazsa kullanılır. Asıl kaynak
// Ön Muhasebe → Firma ve e-Fatura ekranıdır (company_profile tablosu).
export const NES_COMPANY: CompanyInfo = {
  brand: "NES Enerji",
  legalName:
    "NES TEKNİK ENERJİ MÜHENDİSLİK İNŞAAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ",
  address:
    "MUSLİHİTTİN MAHALLESİ MEHMET POLATOĞLU CADDESİ DEMET APARTMANI NO:10 KAT:2 DAİRE:3",
  district: "Menteşe, MUĞLA – Türkiye",
  city: "MUĞLA",
  phone: "0 (554) 610 24 16",
  email: "info@nesgrup.com",
  web: "nesgrup.com",
  taxNo: "6312027568",
  taxOffice: "MUĞLA VERGİ DAİRESİ",
  tradeRegistryNo: "12571",
  mersisNo: "0631202756800001",
  bank: "Akbank",
  iban: "TR21 0004 6001 2888 8000 3242 29",
  logoUrl: "/nes-enerji-logo.png",
  footerNote: "",
};

type ProfileRow = {
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
  invoice_footer_note: string;
};

/** company_profile satırı + faturada gösterilecek banka hesabından
 * CompanyInfo. Boş alanlar yedek değerle doldurulmaz (firma bağımsız). */
export function companyFromProfile(
  p: ProfileRow | null,
  bank: { bank_name: string | null; iban: string | null } | null,
): CompanyInfo {
  if (!p) return NES_COMPANY;
  return {
    brand: p.brand,
    legalName: p.legal_name,
    address: p.address,
    district: p.district,
    city: p.city,
    phone: p.phone,
    email: p.email,
    web: p.web,
    taxNo: p.tax_no,
    taxOffice: p.tax_office,
    tradeRegistryNo: p.trade_registry_no,
    mersisNo: p.mersis_no,
    bank: bank?.bank_name ?? "",
    iban: bank?.iban ?? "",
    logoUrl: p.logo_url || "/nes-enerji-logo.png",
    footerNote: p.invoice_footer_note,
  };
}
