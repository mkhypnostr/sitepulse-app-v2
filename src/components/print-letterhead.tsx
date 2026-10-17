import { NES_COMPANY, NES_CONTACT_LINE } from "@/lib/nes-company";

// NES anteti (NES_ANTENT.docx düzeni) — rapor sayfaları için.
// Ekranda: başlık solda, logo sağda, altında ince çizgi; sayfa sonunda
// adres/iletişim. Yazdırırken/PDF'te: aynı başlık ve alt bilgi her sayfada
// tekrarlanır, sayfa ortasında soluk logo filigranı olur.

export function LetterheadHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <>
      <header className="flex items-end justify-between gap-6 border-b border-slate-800 pb-3 print:hidden">
        <div>
          <h1 className="text-3xl font-black">{title}</h1>
          <p className="mt-1 text-slate-500">{subtitle}</p>
        </div>
        <img
          src={NES_COMPANY.logoPath}
          alt="NES Enerji"
          className="h-11 w-auto shrink-0 object-contain"
        />
      </header>
      <header className="fixed inset-x-0 top-0 z-10 hidden items-end justify-between gap-4 border-b border-slate-800 bg-white px-8 pt-5 pb-2 print:flex">
        <div>
          <p className="text-sm font-bold">{title}</p>
          <p className="text-[10px] text-slate-500">{subtitle}</p>
        </div>
        <img
          src={NES_COMPANY.logoPath}
          alt="NES Enerji"
          className="h-10 w-auto shrink-0 object-contain"
        />
      </header>
      <img
        src={NES_COMPANY.logoPath}
        alt=""
        aria-hidden="true"
        className="pointer-events-none fixed top-1/2 left-1/2 z-0 hidden w-[150mm] -translate-x-1/2 -translate-y-1/2 opacity-[0.13] mix-blend-multiply print:block"
      />
    </>
  );
}

export function LetterheadFooter() {
  return (
    <>
      <footer className="fixed inset-x-0 bottom-0 z-10 hidden border-t border-slate-800 bg-white px-8 py-2 text-center text-[10px] leading-4 text-slate-700 print:block">
        <p>{NES_COMPANY.address}</p>
        <p>{NES_CONTACT_LINE}</p>
      </footer>
      <footer className="mt-10 border-t border-slate-800 pt-3 text-center text-xs leading-5 text-slate-600 print:hidden">
        <p>{NES_COMPANY.address}</p>
        <p>{NES_CONTACT_LINE}</p>
      </footer>
    </>
  );
}
