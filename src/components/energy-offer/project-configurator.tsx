import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { GesConfig } from "@/lib/energy-offer";

// Proje tipi seçici: tip seçilince sistem tipi, montaj yeri ve tipik güç
// aralığı önerilir. Seçim yalnız ön ayardır; alanlar sonra elle değiştirilebilir.

export type ProjectType = {
  id: string;
  title: string;
  description: string;
  /** Tipik kurulu güç aralığı (kWp), yalnız bilgi. */
  typicalKwp: [number, number];
  systemType: GesConfig["systemType"];
  roofType: GesConfig["roofType"];
  art: ReactNode;
};

const panel = "fill-sky-700/80 stroke-sky-950/40 dark:fill-sky-500/70";
const wall =
  "fill-zinc-200 stroke-zinc-400 dark:fill-zinc-700 dark:stroke-zinc-500";
const wallDark =
  "fill-zinc-300 stroke-zinc-400 dark:fill-zinc-800 dark:stroke-zinc-500";
const ground = "fill-lime-200/60 dark:fill-lime-900/30";

function PanelRow({
  x,
  y,
  n,
  w = 9,
  h = 6,
}: {
  x: number;
  y: number;
  n: number;
  w?: number;
  h?: number;
}) {
  return (
    <g>
      {Array.from({ length: n }, (_, i) => (
        <rect
          key={i}
          x={x + i * (w + 1.5)}
          y={y}
          width={w}
          height={h}
          rx={0.8}
          className={panel}
          strokeWidth={0.5}
        />
      ))}
    </g>
  );
}

const PROJECT_TYPES: ProjectType[] = [
  {
    id: "konut",
    title: "Müstakil ev / villa",
    description: "Kiremit çatı, şebeke bağlantılı, fazlası şebekeye.",
    typicalKwp: [5, 15],
    systemType: "ongrid",
    roofType: "kiremit",
    art: (
      <svg viewBox="0 0 120 70" aria-hidden className="h-full w-full">
        <ellipse cx="60" cy="62" rx="50" ry="6" className={ground} />
        <rect
          x="28"
          y="34"
          width="64"
          height="26"
          className={wall}
          strokeWidth={0.8}
        />
        <rect
          x="52"
          y="44"
          width="12"
          height="16"
          className={wallDark}
          strokeWidth={0.6}
        />
        <path
          d="M22 36 L60 12 L98 36 Z"
          className="fill-orange-300/80 stroke-orange-700/50 dark:fill-orange-900/60"
          strokeWidth={0.8}
        />
        <g transform="translate(64 16) skewY(32) scale(0.9 0.62)">
          <PanelRow x={0} y={0} n={3} />
          <PanelRow x={0} y={8} n={3} />
        </g>
      </svg>
    ),
  },
  {
    id: "ticari",
    title: "Ticari / ofis çatısı",
    description: "Trapez veya sandviç çatı, gündüz tüketimi yüksek.",
    typicalKwp: [20, 100],
    systemType: "ongrid",
    roofType: "trapez",
    art: (
      <svg viewBox="0 0 120 70" aria-hidden className="h-full w-full">
        <ellipse cx="60" cy="62" rx="52" ry="6" className={ground} />
        <rect
          x="18"
          y="28"
          width="84"
          height="32"
          className={wall}
          strokeWidth={0.8}
        />
        {Array.from({ length: 6 }, (_, i) => (
          <rect
            key={i}
            x={24 + i * 13}
            y={36}
            width={8}
            height={8}
            className="fill-sky-200 dark:fill-sky-900"
          />
        ))}
        <rect
          x="16"
          y="24"
          width="88"
          height="5"
          className={wallDark}
          strokeWidth={0.6}
        />
        <PanelRow x={20} y={16} n={7} w={10} h={6} />
      </svg>
    ),
  },
  {
    id: "sanayi",
    title: "Fabrika / depo çatısı",
    description: "Geniş trapez çatı, yüksek güç, trifaze bağlantı.",
    typicalKwp: [100, 1000],
    systemType: "ongrid",
    roofType: "trapez",
    art: (
      <svg viewBox="0 0 120 70" aria-hidden className="h-full w-full">
        <ellipse cx="60" cy="62" rx="56" ry="6" className={ground} />
        <rect
          x="10"
          y="32"
          width="100"
          height="28"
          className={wall}
          strokeWidth={0.8}
        />
        <rect
          x="20"
          y="44"
          width="16"
          height="16"
          className={wallDark}
          strokeWidth={0.6}
        />
        <rect
          x="42"
          y="44"
          width="16"
          height="16"
          className={wallDark}
          strokeWidth={0.6}
        />
        <path
          d="M8 33 L30 20 L52 33 L74 20 L96 33 L112 24 L112 33 Z"
          className={wallDark}
          strokeWidth={0.6}
        />
        <g transform="translate(12 22) skewY(-28) scale(0.95 0.6)">
          <PanelRow x={0} y={0} n={2} />
        </g>
        <g transform="translate(56 22) skewY(-28) scale(0.95 0.6)">
          <PanelRow x={0} y={0} n={2} />
        </g>
        <g transform="translate(34 20) skewY(28) scale(0.95 0.6)">
          <PanelRow x={0} y={0} n={2} />
        </g>
        <g transform="translate(78 20) skewY(28) scale(0.95 0.6)">
          <PanelRow x={0} y={0} n={2} />
        </g>
      </svg>
    ),
  },
  {
    id: "arazi",
    title: "Arazi GES",
    description: "Sehpa (konstrüksiyon) üzerinde sıra sıra panel.",
    typicalKwp: [100, 5000],
    systemType: "ongrid",
    roofType: "arazi",
    art: (
      <svg viewBox="0 0 120 70" aria-hidden className="h-full w-full">
        <ellipse cx="60" cy="58" rx="58" ry="11" className={ground} />
        {[0, 1, 2, 3].map((row) => (
          <g key={row} transform={`translate(${14 + row * 6} ${26 + row * 9})`}>
            <PanelRow x={0} y={0} n={7} w={10} h={5} />
            <line
              x1={2}
              y1={5}
              x2={2}
              y2={9}
              className="stroke-zinc-500"
              strokeWidth={0.8}
            />
            <line
              x1={78}
              y1={5}
              x2={78}
              y2={9}
              className="stroke-zinc-500"
              strokeWidth={0.8}
            />
          </g>
        ))}
      </svg>
    ),
  },
  {
    id: "hibrit",
    title: "Hibrit (bataryalı)",
    description: "Gece ve kesintide batarya; şebeke ya da jeneratör yedek.",
    typicalKwp: [5, 50],
    systemType: "hibrit",
    roofType: "kiremit",
    art: (
      <svg viewBox="0 0 120 70" aria-hidden className="h-full w-full">
        <ellipse cx="60" cy="62" rx="50" ry="6" className={ground} />
        <rect
          x="18"
          y="34"
          width="56"
          height="26"
          className={wall}
          strokeWidth={0.8}
        />
        <path
          d="M12 36 L46 14 L80 36 Z"
          className="fill-orange-300/80 stroke-orange-700/50 dark:fill-orange-900/60"
          strokeWidth={0.8}
        />
        <g transform="translate(50 18) skewY(32) scale(0.85 0.6)">
          <PanelRow x={0} y={0} n={2} />
          <PanelRow x={0} y={8} n={2} />
        </g>
        <rect
          x="84"
          y="36"
          width="16"
          height="24"
          rx="2"
          className="fill-emerald-500/80 stroke-emerald-800/50"
          strokeWidth={0.8}
        />
        <rect
          x="89"
          y="33"
          width="6"
          height="3"
          rx="1"
          className="fill-emerald-700"
        />
        <path
          d="M93 42 L89 49 L93 49 L91 55 L96 47 L92 47 Z"
          className="fill-white"
        />
        <rect
          x="102"
          y="46"
          width="12"
          height="14"
          rx="1.5"
          className={wallDark}
          strokeWidth={0.6}
        />
      </svg>
    ),
  },
  {
    id: "tarim",
    title: "Tarımsal sulama",
    description: "Arazide pompa için GES; sulama sezonuna göre boyutlanır.",
    typicalKwp: [5, 100],
    systemType: "ongrid",
    roofType: "arazi",
    art: (
      <svg viewBox="0 0 120 70" aria-hidden className="h-full w-full">
        <ellipse cx="60" cy="58" rx="58" ry="11" className={ground} />
        {[0, 1, 2, 3, 4].map((i) => (
          <path
            key={i}
            d={`M${6 + i * 6} ${52 + i * 3} Q60 ${44 + i * 3} ${114 - i * 6} ${52 + i * 3}`}
            className="fill-none stroke-lime-600/50"
            strokeWidth={1}
          />
        ))}
        <g transform="translate(16 22)">
          <PanelRow x={0} y={0} n={4} w={10} h={6} />
          <PanelRow x={4} y={8} n={4} w={10} h={6} />
          <line
            x1={20}
            y1={14}
            x2={20}
            y2={22}
            className="stroke-zinc-500"
            strokeWidth={1}
          />
        </g>
        <rect
          x="82"
          y="28"
          width="12"
          height="14"
          rx="1.5"
          className={wallDark}
          strokeWidth={0.6}
        />
        <path
          d="M94 36 L108 36 L108 30"
          className="fill-none stroke-sky-500"
          strokeWidth={2}
        />
        <circle cx="108" cy="26" r="3" className="fill-sky-400/70" />
      </svg>
    ),
  },
];

export function ProjectTypePicker({
  value,
  onSelect,
}: {
  value: string | undefined;
  onSelect: (type: ProjectType) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Proje tipi
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {PROJECT_TYPES.map((type) => {
          const active = value === type.id;
          return (
            <button
              key={type.id}
              type="button"
              onClick={() => onSelect(type)}
              aria-pressed={active}
              className={`group relative flex flex-col overflow-hidden rounded-2xl border text-left transition ${
                active
                  ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                  : "border-border bg-card hover:border-primary/50 hover:bg-muted/40"
              }`}
            >
              <span className="block aspect-[12/7] w-full bg-gradient-to-b from-sky-50 to-transparent px-2 pt-2 dark:from-sky-950/30">
                {type.art}
              </span>
              <span className="grid gap-0.5 p-2.5 pt-1.5">
                <span className="text-sm font-bold leading-tight">
                  {type.title}
                </span>
                <span className="text-[11px] leading-4 text-muted-foreground">
                  {type.description}
                </span>
                <span className="mt-1 text-[11px] font-semibold text-primary">
                  {type.typicalKwp[0].toLocaleString("tr-TR")}–
                  {type.typicalKwp[1].toLocaleString("tr-TR")} kWp
                </span>
              </span>
              {active ? (
                <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type OfferStep = {
  id: string;
  label: string;
  done: boolean;
  /** Adımın kısa durumu, ör. "2 yüzey · 24 panel". */
  detail: string;
  target: string;
};

export type OfferKpi = { label: string; value: string };

/** Teklifin akışı: Çatı → Tasarım → Sistem → Teklif. Üstte sabit durur;
 * adıma basınca ilgili bölüme kaydırır. */
export function OfferStepper({
  steps,
  kpis,
}: {
  steps: OfferStep[];
  kpis: OfferKpi[];
}) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <nav
      aria-label="Teklif adımları"
      className="surface-panel sticky top-2 z-20 grid gap-3 p-3 backdrop-blur supports-[backdrop-filter]:bg-card/85 lg:grid-cols-[1fr_auto] lg:items-center"
    >
      <ol className="grid grid-cols-4 gap-1.5">
        {steps.map((step, index) => {
          const isCurrent = index === current;
          return (
            <li key={step.id} className="min-w-0">
              <a
                href={`#${step.target}`}
                className={`flex h-full min-w-0 flex-col items-center gap-1 rounded-xl text-center sm:flex-row sm:gap-2 sm:text-left border px-2 py-1.5 transition hover:bg-muted/60 ${
                  isCurrent
                    ? "border-primary/60 bg-primary/5"
                    : "border-transparent"
                }`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${
                    step.done
                      ? "bg-emerald-500 text-white"
                      : isCurrent
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {step.done ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span className="w-full min-w-0">
                  <span className="block truncate text-xs font-bold leading-tight sm:text-sm">
                    {step.label}
                  </span>
                  <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                    {step.detail}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
      <dl className="grid grid-cols-4 gap-2 border-t lg:flex lg:gap-x-5 pt-2 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="min-w-0">
            <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {kpi.label}
            </dt>
            <dd className="truncate text-xs font-black tabular-nums sm:text-sm">
              {kpi.value}
            </dd>
          </div>
        ))}
      </dl>
    </nav>
  );
}
