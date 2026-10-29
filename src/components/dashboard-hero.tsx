import type { ReactNode } from "react";
import { FEATURES } from "@/lib/features";
import {
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cloud,
  Droplets,
  MapPin,
  Moon,
  Sun,
  Sunrise,
  Sunset,
  Umbrella,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { fieldNote, useWeather, weatherInfo } from "@/lib/weather";

// Genel Bakış karşılama alanı: saat, tarih ve hava durumu. Gökyüzü günün
// saatine göre değişir (gece / gün doğumu-batımı / gündüz); altta güneş
// paneli tarlası. Görsel kullanılmaz, yalnız CSS.

const ICONS: Record<ReturnType<typeof weatherInfo>["kind"], LucideIcon> = {
  clear: Sun,
  partly: CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

const SKY = {
  night:
    "bg-[linear-gradient(180deg,#0b1430_0%,#1b2650_45%,#3a3460_70%,#151826_100%)]",
  golden:
    "bg-[linear-gradient(180deg,#f3c7a4_0%,#e9a57f_38%,#c9785b_62%,#4a3a3f_100%)] dark:bg-[linear-gradient(180deg,#3b2c3f_0%,#7a4a4a_40%,#b8694f_62%,#1f1a22_100%)]",
  day: "bg-[linear-gradient(180deg,#3d7fd1_0%,#6aa6e6_40%,#a9cdf0_68%,#3a4a63_100%)] dark:bg-[linear-gradient(180deg,#1d3d6b_0%,#2f5f96_45%,#5a86b5_68%,#1a2232_100%)]",
};

function isoWeek(date: Date) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

const hhmm = (iso: string) => iso.slice(11, 16);
const deg = (v: number) => `${Math.round(v)}°`;

export function DashboardHero({
  greeting,
  now,
  actions,
}: {
  greeting: string;
  now: Date;
  actions?: ReactNode;
}) {
  const weather = useWeather();
  const w = weather.data;
  const today = w?.days[0];
  const tomorrow = w?.days[1];

  // Gökyüzü: gün doğumu/batımına yakın "altın saat", arası gündüz.
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMin = (iso: string | undefined, fallback: number) =>
    iso ? Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) : fallback;
  const rise = toMin(today?.sunrise, 7 * 60);
  const set = toMin(today?.sunset, 18 * 60);
  const phase =
    minutes < rise - 30 || minutes > set + 45
      ? "night"
      : minutes < rise + 60 || minutes > set - 60
        ? "golden"
        : "day";

  const time = new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const date = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("tr-TR", { weekday: "long" }).format(
    now,
  );

  const info = w ? weatherInfo(w.current.code) : null;
  const NowIcon = info
    ? !w?.current.isDay && info.kind === "clear"
      ? Moon
      : ICONS[info.kind]
    : Sun;
  const note = today && w ? fieldNote(today, w.current.wind) : null;
  const tomorrowInfo = tomorrow ? weatherInfo(tomorrow.code) : null;
  const TomorrowIcon = tomorrowInfo ? ICONS[tomorrowInfo.kind] : null;

  return (
    <section className="relative mb-6 overflow-hidden rounded-[32px] text-white shadow-[var(--float-shadow)]">
      <div className={`absolute inset-0 ${SKY[phase]}`} />
      {phase === "night" ? (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(1px_1px_at_12%_18%,white,transparent),radial-gradient(1px_1px_at_32%_9%,white,transparent),radial-gradient(1.5px_1.5px_at_48%_26%,white,transparent),radial-gradient(1px_1px_at_63%_12%,white,transparent),radial-gradient(1px_1px_at_82%_30%,white,transparent),radial-gradient(1.5px_1.5px_at_90%_8%,white,transparent),radial-gradient(1px_1px_at_22%_36%,white,transparent)] opacity-70" />
          <div className="absolute top-[22%] left-[72%] h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(230,236,255,0.55)_0%,rgba(180,195,255,0.15)_40%,transparent_70%)]" />
        </>
      ) : (
        <div
          className={`absolute left-[70%] h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full ${
            phase === "day"
              ? "top-[20%] bg-[radial-gradient(circle,rgba(255,250,225,0.95)_0%,rgba(255,240,190,0.35)_35%,transparent_70%)]"
              : "top-[42%] bg-[radial-gradient(circle,rgba(255,236,200,0.95)_0%,rgba(255,200,150,0.45)_35%,transparent_70%)]"
          }`}
        />
      )}
      {/* Perspektifli güneş paneli sıraları */}
      <div className="absolute inset-x-0 bottom-0 h-[38%] [perspective:420px]">
        <div className="absolute inset-x-[-30%] bottom-[-20%] h-[160%] origin-bottom [transform:rotateX(62deg)] bg-[repeating-linear-gradient(90deg,rgba(28,36,58,0.92)_0px,rgba(44,58,92,0.92)_46px,rgba(255,220,190,0.35)_47px,rgba(28,36,58,0.92)_49px),repeating-linear-gradient(0deg,transparent_0px,transparent_34px,rgba(255,215,180,0.5)_35px,transparent_37px)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
      </div>

      <div className="relative flex flex-col gap-5 p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/20 px-3 py-1.5 text-[13px] font-semibold backdrop-blur-md">
            <MapPin className="h-3.5 w-3.5" />
            {w?.label ?? "Menteşe, Muğla"}
          </span>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>

        <div className="grid items-end gap-5 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0 drop-shadow-sm">
            <p className="text-lg font-semibold text-white/90 sm:text-xl">
              {greeting}
            </p>
            <p className="mt-1 text-6xl leading-none font-bold tracking-tight tabular-nums sm:text-7xl">
              {time}
            </p>
            <p className="mt-2 text-[15px] font-medium text-white/90 sm:text-base">
              <span className="capitalize">{weekday}</span>, {date}
              <span className="text-white/70"> · {isoWeek(now)}. hafta</span>
            </p>
          </div>

          <div className="w-full rounded-3xl border border-white/30 bg-black/25 p-4 backdrop-blur-md lg:w-[400px]">
            {w && info && today ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <NowIcon className="h-11 w-11 shrink-0 text-amber-200" />
                    <div>
                      <p className="text-4xl leading-none font-bold tabular-nums">
                        {deg(w.current.temperature)}
                      </p>
                      <p className="mt-1 text-sm text-white/85">
                        {info.text} · hissedilen {deg(w.current.apparent)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold">
                      {deg(today.max)}{" "}
                      <span className="text-white/60">/ {deg(today.min)}</span>
                    </p>
                    <p className="text-xs text-white/70">bugün</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <Stat
                    icon={Umbrella}
                    label="Yağış"
                    value={`%${today.rain}`}
                  />
                  <Stat
                    icon={Wind}
                    label="Rüzgâr"
                    value={`${Math.round(w.current.wind)} km/sa`}
                  />
                  <Stat
                    icon={Droplets}
                    label="Nem"
                    value={`%${Math.round(w.current.humidity)}`}
                  />
                  <Stat
                    icon={Sunrise}
                    label="Doğuş"
                    value={hhmm(today.sunrise)}
                  />
                  <Stat
                    icon={Sunset}
                    label="Batış"
                    value={hhmm(today.sunset)}
                  />
                  {FEATURES.ges ? (
                    <Stat
                      icon={Zap}
                      label="Güneş/m²"
                      value={`${today.radiation.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} kWh`}
                    />
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  {note ? (
                    <span
                      className={`rounded-full px-2.5 py-1 font-semibold ${
                        note.ok
                          ? "bg-emerald-400/25 text-emerald-50"
                          : "bg-amber-400/30 text-amber-50"
                      }`}
                    >
                      {note.text}
                    </span>
                  ) : null}
                  {tomorrow && tomorrowInfo && TomorrowIcon ? (
                    <span className="inline-flex items-center gap-1.5 text-white/85">
                      Yarın <TomorrowIcon className="h-3.5 w-3.5" />
                      {deg(tomorrow.max)}/{deg(tomorrow.min)}
                      {tomorrow.rain >= 30 ? ` · yağış %${tomorrow.rain}` : ""}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-white/80">
                {weather.isError
                  ? "Hava durumu şu an alınamadı."
                  : "Hava durumu yükleniyor…"}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-white/10 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[11px] text-white/70">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-0.5 truncate font-semibold tabular-nums">{value}</p>
    </div>
  );
}
