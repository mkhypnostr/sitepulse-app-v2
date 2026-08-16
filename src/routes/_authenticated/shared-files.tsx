import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  FolderOpen,
  Landmark,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { getGoogleWorkspaceStatus } from "@/lib/google-workspace";
import {
  AccessDenied,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/shared-files")({
  component: SharedFilesPage,
});

function driveUrl(id: string | undefined) {
  return id ? `https://drive.google.com/drive/folders/${id}` : null;
}

function SharedFilesPage() {
  const { role } = useAuth();
  const canAccess = role === "admin" || role === "technical_office";
  const workspaceQuery = useQuery({
    queryKey: ["google-workspace-status"],
    enabled: canAccess,
    queryFn: getGoogleWorkspaceStatus,
  });

  if (!canAccess) return <AccessDenied />;
  if (workspaceQuery.isLoading) {
    return <LoadingState label="Ortak dosyalar hazırlanıyor..." />;
  }

  const resources = workspaceQuery.data?.resources ?? [];
  const operationsId =
    resources.find((item) => item.resource_key === "operations_drive")
      ?.resource_id ?? workspaceQuery.data?.operations_drive_id;
  const financeId = resources.find(
    (item) => item.resource_key === "finance_drive",
  )?.resource_id;
  const operationsUrl = driveUrl(operationsId);
  const financeUrl = driveUrl(financeId);
  const connectionError = workspaceQuery.error
    ? errorMessage(workspaceQuery.error)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ortak Dosyalar"
        description="NES Ortak Drive'larına tek yerden geçin. Proje detayındaki Drive düğmesi ise doğrudan o projenin klasörünü açar."
        action={
          <Button
            variant="outline"
            onClick={() => workspaceQuery.refetch()}
            disabled={workspaceQuery.isFetching}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${workspaceQuery.isFetching ? "animate-spin" : ""}`}
            />
            Yenile
          </Button>
        }
      />

      {connectionError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-5 text-sm text-destructive">
            Drive bağlantısı alınamadı: {connectionError}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <DriveCard
          title="NES Operasyon"
          description="Projeler, saha raporları, fotoğraflar, teknik şablonlar, stok ve operasyon dokümanları."
          icon={Wrench}
          href={operationsUrl}
          unavailableText="Operasyon Drive kaydı henüz bulunamadı."
        />
        {role === "admin" ? (
          <DriveCard
            title="NES Yönetim ve Finans"
            description="Fatura, ödeme, tahsilat, bütçe, maliyet, hakediş ve teklif dosyaları."
            icon={Landmark}
            href={financeUrl}
            unavailableText="Yönetim ve Finans Drive kaydı henüz bulunamadı."
          />
        ) : null}
      </div>

      <Card>
        <CardContent className="flex gap-3 p-5 text-sm text-muted-foreground">
          <FolderOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p>
            Teklif PDF ve Excel dosyalarını şimdilik{" "}
            <strong>NES Yönetim ve Finans</strong> Drive'ında tutacağız.
            Teklifin durum, revizyon ve müşteri onayı gibi kayıtlarını
            uygulamada açmak gerektiğinde ayrıca görünür hâle getireceğiz.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function DriveCard({
  title,
  description,
  icon: Icon,
  href,
  unavailableText,
}: {
  title: string;
  description: string;
  icon: typeof Wrench;
  href: string | null;
  unavailableText: string;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <Icon className="mb-2 h-7 w-7 text-primary" />
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        {href ? (
          <Button asChild className="w-full">
            <a href={href} target="_blank" rel="noreferrer">
              Drive'ı Aç <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{unavailableText}</p>
        )}
      </CardContent>
    </Card>
  );
}
