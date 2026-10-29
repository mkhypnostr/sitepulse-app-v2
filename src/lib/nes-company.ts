// NES şirket bilgileri ve antet — tek kaynak.
//
// Kaynak: NES_ANTENT.docx (logo sağ üstte ve altında ince çizgi, sayfa
// ortasında soluk logo filigranı, altta çizgi ve "adres / telefon / e-posta"
// satırı, sağ altta sayfa numarası) ve NES Operasyon çalışma talimatı.
// Teklif dosyaları, raporlar ve müşteri linki bu bilgileri buradan alır;
// adres veya telefon değişirse yalnız burası güncellenir.

export const NES_COMPANY = {
  brand: "NES Enerji",
  legalName:
    "Nes Teknik Enerji Mühendislik İnşaat Sanayi ve Ticaret Limited Şirketi",
  legalNameShort: "NES Teknik Enerji Mühendislik İnşaat San. ve Tic. Ltd. Şti.",
  legalNameUpper:
    "NES TEKNİK ENERJİ MÜHENDİSLİK İNŞAAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ",
  addressUpper:
    "MUSLİHİTTİN MAHALLESİ MEHMET POLATOĞLU CADDESİ DEMET APARTMANI NO:10 KAT:2 DAİRE:3",
  cityUpper: "MUĞLA / Menteşe",
  /** Antetteki adres satırı. */
  address:
    "Muslihittin Mahallesi Mehmet Polatoğlu Caddesi Demet Apartmanı No:10 Kat:2 Daire:3 Menteşe / Muğla",
  /** Antetteki telefon biçimi. */
  phone: "+90 554 610 24 16",
  phoneCompact: "05546102416",
  email: "info@nesgrup.com",
  web: "nesgrup.com",
  taxOffice: "MUĞLA VERGİ DAİRESİ",
  taxNo: "6312027568",
  bank: "Akbank",
  bankAccountName: "Nes Teknik Enerji Mühendislik İnş. San. ve Tic. Ltd. Şti.",
  iban: "TR21 0004 6001 2888 8000 3242 29",
  logoPath: "/nes-enerji-logo.png",
  assetsPath: "/offer-assets",
} as const;

/** Antet alt satırı: "Telefon: … · Mail: …". */
export const NES_CONTACT_LINE = `Telefon: ${NES_COMPANY.phone} · Mail: ${NES_COMPANY.email}`;

const esc = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Sabit A4 sayfalı (`.page`, position:relative) HTML belgeler için antet
 * stili. Sayfa numarası CSS sayacıyla verilir.
 */
export const LETTERHEAD_PAGE_CSS = `
body{counter-reset:lhpage}
.page.lh{counter-increment:lhpage;isolation:isolate}
.lh-head{position:absolute;left:15mm;right:15mm;top:8mm;height:15mm;display:flex;align-items:flex-end;justify-content:flex-end;border-bottom:.6pt solid #222;padding-bottom:2mm;z-index:2}
.lh-head img{height:10.5mm;width:auto}
.lh-head .lh-title{margin-right:auto;font-family:Arial,sans-serif;font-size:7.5pt;color:#666;letter-spacing:.02em}
.lh-mark{position:absolute;left:50%;top:50%;width:150mm;transform:translate(-50%,-50%);opacity:.13;pointer-events:none;z-index:-1}
.lh-foot{position:absolute;left:15mm;right:15mm;bottom:7mm;height:13mm;border-top:.6pt solid #222;padding-top:2mm;font-family:Arial,sans-serif;font-size:7pt;line-height:1.45;color:#333;text-align:center;z-index:2}
.lh-foot .lh-left{position:absolute;left:0;top:2.6mm;font-size:6.5pt;color:#666;text-align:left}
.lh-foot .lh-no{position:absolute;right:0;top:2.6mm;font-size:7pt;color:#333}
.lh-foot .lh-no:not(.fixed)::after{content:"Sayfa " counter(lhpage)}
`;

/** Bir `.page` bölümüne eklenecek antet parçaları. */
export function letterheadHtml(options: {
  logoUrl: string;
  /** Üst çizginin solunda küçük başlık (ör. teklif no ve iş adı). */
  title?: string;
  /** Alt çizginin solunda küçük not (ör. hazırlanma tarihi). */
  footLeft?: string;
  /** Sayfa numarası metni verilirse CSS sayacı yerine bu yazılır. */
  pageLabel?: string;
  head?: boolean;
  watermark?: boolean;
}): string {
  const head =
    options.head === false
      ? ""
      : `<div class="lh-head">${options.title ? `<span class="lh-title">${esc(options.title)}</span>` : ""}<img src="${esc(options.logoUrl)}" alt="NES Enerji"></div>`;
  const mark =
    options.watermark === false
      ? ""
      : `<img class="lh-mark" src="${esc(options.logoUrl)}" alt="">`;
  const no = options.pageLabel
    ? `<span class="lh-no fixed">${esc(options.pageLabel)}</span>`
    : `<span class="lh-no"></span>`;
  return `${head}${mark}<div class="lh-foot">${options.footLeft ? `<span class="lh-left">${options.footLeft}</span>` : ""}${esc(NES_COMPANY.address)}<br>${esc(NES_CONTACT_LINE)}${no}</div>`;
}
