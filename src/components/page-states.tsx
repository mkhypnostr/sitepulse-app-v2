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
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Veriler yükleniyor..." }: { label?: string }) {
  return (
    <div className="flex min-h-52 items-center justify-center gap-3 text-muted-foreground">
      <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
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
      <PackageOpen className="mb-4 h-10 w-10 text-primary" />
      <h2 className="font-bold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
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
      <p className="mt-2 text-sm text-muted-foreground">
        Hesabınızın rolü bu ekrana erişmeye izin vermiyor.
      </p>
    </div>
  );
}
