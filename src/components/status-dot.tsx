import { cn } from "@/lib/utils";

type StatusTone = "danger" | "warning" | "success" | "info";

const toneClasses: Record<StatusTone, string> = {
  danger: "bg-destructive",
  warning: "bg-warning",
  success: "bg-success",
  info: "bg-highlight",
};

// Dikkat gerektiren kayıtların yanında küçük renkli nokta. pulse=true iken
// etrafında yavaşça genişleyen bir halka yanıp söner; kartın tamamı değil
// yalnız nokta hareket eder. "Hareketi azalt" tercihi olan cihazlarda
// animasyon kapalıdır (motion-safe).
export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: StatusTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("relative inline-flex h-2.5 w-2.5 shrink-0", className)}
      aria-hidden="true"
    >
      {pulse ? (
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping",
            toneClasses[tone],
          )}
        />
      ) : null}
      <span
        className={cn(
          "relative inline-flex h-2.5 w-2.5 rounded-full",
          toneClasses[tone],
        )}
      />
    </span>
  );
}

export function NewBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success",
        className,
      )}
    >
      <StatusDot
        tone="success"
        className="h-1.5 w-1.5 [&>span]:h-1.5 [&>span]:w-1.5"
      />
      Yeni
    </span>
  );
}
