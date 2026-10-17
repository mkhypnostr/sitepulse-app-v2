import { AlertTriangle, LoaderCircle, PackageOpen } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    // Çok düğmeli sayfalarda (ör. enerji teklifi) başlık ile düğmeler orta
    // genişlikte yan yana sığmıyor, başlık tek kelimelik sütuna sıkışıyordu.
    // Yan yana düzen yalnız geniş ekranda (lg); düğmeler gerekirse alt satıra
    // kayar.
    <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 lg:flex-1">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-foreground sm:text-[34px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="min-w-0 max-w-full lg:max-w-[65%] lg:shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function LoadingState({
  label = "Veriler yükleniyor...",
}: {
  label?: string;
}) {
  return (
    <div className="flex min-h-52 items-center justify-center gap-3 text-muted-foreground">
      <LoaderCircle className="h-5 w-5 animate-spin text-highlight" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface-panel flex min-h-56 flex-col items-center justify-center p-8 text-center">
      <PackageOpen className="mb-4 h-10 w-10 text-highlight" />
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function AccessDenied() {
  return (
    <div className="surface-panel flex min-h-64 flex-col items-center justify-center p-8 text-center">
      <AlertTriangle className="mb-4 h-10 w-10 text-destructive" />
      <h1 className="text-xl font-bold">Bu sayfa için yetkiniz yok</h1>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Hesabınızın rolü bu ekrana erişmeye izin vermiyor.
      </p>
    </div>
  );
}
