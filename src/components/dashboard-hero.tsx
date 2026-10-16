import type { ReactNode } from "react";

// Genel Bakış karşılama alanı (referans: faers.tech). Görsel kullanmadan,
// yalnız CSS ile gün batımında güneş paneli tarlası hissi: sıcak gökyüzü
// geçişi, güneş parıltısı ve perspektifli panel sıraları. Üzerinde buzlu cam
// "hap" etiketler ve butonlar durur.
export function DashboardHero({
  greeting,
  subtitle,
  chips,
  actions,
}: {
  greeting: string;
  subtitle: string;
  chips: Array<{ label: string; value: number; tone?: "danger" | "default" }>;
  actions?: ReactNode;
}) {
  return (
    <section className="relative mb-6 overflow-hidden rounded-[32px] text-white shadow-[var(--float-shadow)]">
      {/* Gökyüzü */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#f3c7a4_0%,#e9a57f_38%,#c9785b_62%,#4a3a3f_100%)] dark:bg-[linear-gradient(180deg,#3b2c3f_0%,#7a4a4a_40%,#b8694f_62%,#1f1a22_100%)]" />
      {/* Güneş parıltısı */}
      <div className="absolute top-[38%] left-[68%] h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,236,200,0.95)_0%,rgba(255,200,150,0.45)_35%,transparent_70%)]" />
      {/* Perspektifli güneş paneli sıraları */}
      <div className="absolute inset-x-0 bottom-0 h-[46%] [perspective:420px]">
        <div className="absolute inset-x-[-30%] bottom-[-20%] h-[160%] origin-bottom [transform:rotateX(62deg)] bg-[repeating-linear-gradient(90deg,rgba(28,36,58,0.92)_0px,rgba(44,58,92,0.92)_46px,rgba(255,220,190,0.35)_47px,rgba(28,36,58,0.92)_49px),repeating-linear-gradient(0deg,transparent_0px,transparent_34px,rgba(255,215,180,0.5)_35px,transparent_37px)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
      </div>

      <div className="relative flex min-h-[260px] flex-col justify-between gap-6 p-6 sm:min-h-[300px] sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/50 bg-white/60 px-3 py-1.5 text-[13px] font-semibold text-neutral-900 backdrop-blur-md dark:bg-white/20 dark:text-white">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            Saha Operasyon
          </span>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
        <div>
          <h1 className="text-[34px] leading-[1.05] font-bold tracking-tight drop-shadow-sm sm:text-5xl">
            {greeting}
          </h1>
          <p className="mt-2 text-[15px] text-white/85">{subtitle}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/20 py-1.5 pr-1.5 pl-3.5 text-[13px] font-medium backdrop-blur-md"
              >
                {chip.label}
                <span
                  className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${
                    chip.tone === "danger" && chip.value > 0
                      ? "bg-red-500 text-white"
                      : "bg-white text-neutral-900"
                  }`}
                >
                  {chip.value}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
