import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, FileText, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage, photoTypeLabels } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { formatProjectDateTime } from "@/lib/projects";
import { EmptyState, LoadingState } from "@/components/page-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/job-report/$jobId")({
  component: JobReportPage,
});

// NES_ANTENT.docx şirket antet şablonundan alınmıştır (logo + iletişim).
const NES_LOGO_URL = "/nes-enerji-logo.png";
const NES_CONTACT_ADDRESS =
  "Orhaniye Mahallesi 12 Nolu Sokak Nur Apartmanı No:6/C Menteşe / Muğla";
const NES_CONTACT_PHONE = "+90 554 610 24 16";
const NES_CONTACT_EMAIL = "info@nesgrup.com";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function imageAsDataUrl(url: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function JobReportPage() {
  const { jobId } = Route.useParams();
  const reportQuery = useQuery({
    queryKey: ["job-photo-report", jobId],
    queryFn: async () => {
      const [orderResult, photosResult, materialsResult, submissionsResult] =
        await Promise.all([
          supabase
            .from("work_orders")
            .select("*, customers(name, contact)")
            .eq("id", jobId)
            .single(),
          supabase
            .from("photos")
            .select("*")
            .eq("work_order_id", jobId)
            .order("created_at"),
          supabase
            .from("work_order_materials")
            .select("*, stock_items(code, name)")
            .eq("work_order_id", jobId)
            .order("created_at"),
          supabase
            .from("work_completion_submissions")
            .select("*")
            .eq("work_order_id", jobId)
            .order("submitted_at", { ascending: false }),
        ]);
      if (orderResult.error) throw orderResult.error;
      if (photosResult.error) throw photosResult.error;
      if (materialsResult.error) throw materialsResult.error;

      const photos = await Promise.all(
        photosResult.data.map(async (photo) => {
          const signed = await supabase.storage
            .from("work-photos")
            .createSignedUrl(photo.storage_path, 3600);
          return {
            ...photo,
            signedUrl: signed.error ? null : signed.data.signedUrl,
          };
        }),
      );

      const submissions = submissionsResult.error ? [] : submissionsResult.data;
      const profileIds = [
        ...new Set(
          submissions.flatMap(
            (submission) =>
              [submission.submitted_by, submission.reviewed_by].filter(
                Boolean,
              ) as string[],
          ),
        ),
      ];
      const profilesResult = profileIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", profileIds)
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;

      return {
        order: orderResult.data,
        photos,
        materials: materialsResult.data,
        submissions,
        profiles: profilesResult.data ?? [],
      };
    },
  });

  if (reportQuery.isLoading) return <LoadingState />;
  if (reportQuery.error || !reportQuery.data) {
    return (
      <EmptyState
        title="Rapor açılamadı"
        description={
          reportQuery.error
            ? errorMessage(reportQuery.error)
            : "Görev bulunamadı."
        }
      />
    );
  }

  const { order, photos, materials, submissions, profiles } = reportQuery.data;
  const profileById = new Map(
    profiles.map((profile) => [profile.id, profile.full_name]),
  );
  const approvedSubmission = submissions.find(
    (submission) => submission.status === "approved",
  );

  async function downloadWordReport() {
    const logoDataUrl = await imageAsDataUrl(NES_LOGO_URL);
    const reportPhotos = await Promise.all(
      photos
        .filter((photo) => Boolean(photo.signedUrl) && !photo.is_document)
        .map(async (photo) => ({
          ...photo,
          dataUrl: await imageAsDataUrl(photo.signedUrl!),
        })),
    );
    const materialRows = materials.length
      ? materials
          .map(
            (material) => `
          <tr>
            <td>${escapeHtml(material.is_nes_stock ? material.stock_items?.name : material.custom_material_name)}</td>
            <td>${escapeHtml(material.quantity)} ${escapeHtml(material.unit)}</td>
            <td>${escapeHtml(material.is_nes_stock ? "NES deposu" : "Saha / taşeron")}</td>
          </tr>`,
          )
          .join("")
      : '<tr><td colspan="3">Malzeme kaydı bulunmuyor.</td></tr>';
    const photoBlocks = photos.length
      ? photos
          .map(
            (photo) => `
          <div class="photo">
            ${photo.is_document ? `<p><strong>PDF belge:</strong> ${escapeHtml(photo.caption || "Açıklama eklenmemiş")}</p>` : `<img src="${escapeHtml(reportPhotos.find((reportPhoto) => reportPhoto.id === photo.id)?.dataUrl || "")}" alt="${escapeHtml(photo.caption)}" />`}
            <strong>${escapeHtml(photo.is_document ? "PDF Belge" : photoTypeLabels[photo.photo_type])}</strong>
            <p>${escapeHtml(photo.caption || "Açıklama eklenmemiş")}</p>
          </div>`,
          )
          .join("")
      : "<p>Fotoğraf kaydı bulunmuyor.</p>";
    const html = `<!doctype html>
      <html><head><meta charset="utf-8"><style>
        body{font-family:Arial,sans-serif;color:#071225;margin:36px}
        h1{color:#0755b5} .meta{background:#eef5ff;padding:18px;border-radius:10px}
        table{width:100%;border-collapse:collapse;margin:18px 0}
        th,td{border:1px solid #cbd5e1;padding:9px;text-align:left}
        .photo{page-break-inside:avoid;margin:18px 0}
        .photo img{width:100%;max-height:520px;object-fit:contain;border:1px solid #cbd5e1}
        .letterhead{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:4px solid #0755b5;padding-bottom:14px}
        .letterhead img{height:44px}
        .report-footer{margin-top:32px;border-top:1px solid #cbd5e1;padding-top:10px;text-align:center;font-size:10px;color:#64748b}
      </style></head><body>
        <div class="letterhead">
          <h1 style="margin:0">FOTOĞRAFLI İŞ RAPORU</h1>
          <img src="${logoDataUrl}" alt="NES Enerji" />
        </div>
        <div class="meta">
          <h2>#${escapeHtml(order.work_order_no)} · ${escapeHtml(order.title)}</h2>
          <p><strong>Müşteri:</strong> ${escapeHtml(order.customers?.name)}</p>
          <p><strong>Planlanan tarih:</strong> ${escapeHtml(formatDate(order.scheduled_at))}</p>
          <p><strong>Konum:</strong> ${escapeHtml(order.location || order.location_url || "-")}</p>
        </div>
        <h2>İş Açıklaması</h2><p>${escapeHtml(order.description || "Açıklama girilmemiş.")}</p>
        <h2>Tamamlanma Özeti</h2>
        <p>${escapeHtml(approvedSubmission?.note || order.completion_note || "Tamamlanma açıklaması bulunmuyor.")}</p>
        <p><strong>Gönderen:</strong> ${escapeHtml(approvedSubmission ? profileById.get(approvedSubmission.submitted_by) : "-")}</p>
        <p><strong>Onaylayan:</strong> ${escapeHtml(approvedSubmission?.reviewed_by ? profileById.get(approvedSubmission.reviewed_by) : "-")}</p>
        <h2>Kullanılan Malzemeler</h2>
        <table><thead><tr><th>Malzeme</th><th>Miktar</th><th>Kaynak</th></tr></thead><tbody>${materialRows}</tbody></table>
        <h2>Saha Fotoğrafları ve Belgeleri</h2>${photoBlocks}
        <div class="report-footer">
          <p>${escapeHtml(NES_CONTACT_ADDRESS)}</p>
          <p>Telefon: ${escapeHtml(NES_CONTACT_PHONE)} &middot; Mail: ${escapeHtml(NES_CONTACT_EMAIL)}</p>
        </div>
      </body></html>`;
    const blob = new Blob(["\ufeff", html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `NES-is-raporu-${order.work_order_no}.doc`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="print:hidden mb-5 flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link to="/jobs/$jobId" params={{ jobId }}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Göreve dön
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> PDF / Yazdır
          </Button>
          <Button onClick={downloadWordReport}>
            <Download className="mr-2 h-4 w-4" /> Word İndir
          </Button>
        </div>
      </div>

      <article className="rounded-xl bg-white p-6 pb-20 text-slate-950 shadow-sm print:rounded-none print:p-0 print:pb-24 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-4 border-blue-700 pb-5">
          <div>
            <h1 className="text-3xl font-black">Fotoğraflı İş Raporu</h1>
            <p className="mt-1 text-slate-500">
              #{order.work_order_no} · {order.title}
            </p>
          </div>
          <img
            src={NES_LOGO_URL}
            alt="NES Enerji"
            className="h-10 w-auto shrink-0 object-contain print:h-12"
          />
        </header>

        <section className="mt-6 grid gap-3 rounded-xl bg-blue-50 p-5 sm:grid-cols-2">
          <p>
            <strong>Müşteri:</strong> {order.customers?.name}
          </p>
          <p>
            <strong>Planlanan tarih:</strong> {formatDate(order.scheduled_at)}
          </p>
          <p className="sm:col-span-2">
            <strong>Konum:</strong>{" "}
            {order.location || order.location_url || "-"}
          </p>
        </section>

        <section className="mt-7">
          <h2 className="text-xl font-black">İş ve Tamamlanma Özeti</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
            {order.description || "İş açıklaması girilmemiş."}
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
            {approvedSubmission?.note ||
              order.completion_note ||
              "Tamamlanma açıklaması bulunmuyor."}
          </p>
          {approvedSubmission ? (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">
                Gönderen:{" "}
                {profileById.get(approvedSubmission.submitted_by) || "Taşeron"}
              </Badge>
              <Badge variant="outline">
                Onaylayan:{" "}
                {profileById.get(approvedSubmission.reviewed_by ?? "") ||
                  "Yönetici"}
              </Badge>
              {approvedSubmission.reviewed_at ? (
                <Badge variant="outline">
                  {formatProjectDateTime(approvedSubmission.reviewed_at)}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="mt-7">
          <h2 className="text-xl font-black">Kullanılan Malzemeler</h2>
          <div className="mt-3 grid gap-2">
            {materials.map((material) => (
              <Card
                key={material.id}
                className="border-slate-200 bg-white text-slate-950 shadow-none"
              >
                <CardContent className="flex items-center justify-between gap-4 p-3">
                  <div>
                    <p className="font-bold">
                      {material.is_nes_stock
                        ? material.stock_items?.name
                        : material.custom_material_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {material.is_nes_stock ? "NES deposu" : "Saha / taşeron"}
                    </p>
                  </div>
                  <strong>
                    {material.quantity} {material.unit}
                  </strong>
                </CardContent>
              </Card>
            ))}
            {materials.length === 0 ? (
              <p className="text-sm text-slate-500">Malzeme kaydı yok.</p>
            ) : null}
          </div>
        </section>

        <section className="mt-7">
          <h2 className="flex items-center gap-2 text-xl font-black">
            <FileText className="h-5 w-5 text-blue-700" /> Saha Fotoğrafları ve
            Belgeleri
          </h2>
          <div className="mt-3 grid gap-5 sm:grid-cols-2">
            {photos.map((photo) => (
              <figure
                key={photo.id}
                className="break-inside-avoid overflow-hidden rounded-xl border border-slate-200"
              >
                {photo.is_document ? (
                  <a
                    href={photo.signedUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-slate-100 text-blue-700"
                  >
                    <FileText className="h-10 w-10" />
                    <span className="text-sm font-bold">PDF belgeyi aç</span>
                  </a>
                ) : photo.signedUrl ? (
                  <img
                    src={photo.signedUrl}
                    alt={photo.caption || "Saha fotoğrafı"}
                    className="aspect-video w-full object-cover"
                  />
                ) : null}
                <figcaption className="p-3">
                  <strong className="text-sm">
                    {photoTypeLabels[photo.photo_type]}
                  </strong>
                  <p className="mt-1 text-xs text-slate-600">
                    {photo.caption || "Açıklama eklenmemiş"}
                  </p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <footer className="fixed inset-x-0 bottom-0 hidden border-t border-slate-200 bg-white px-6 py-2 text-center text-[10px] leading-4 text-slate-500 print:block">
          <p>{NES_CONTACT_ADDRESS}</p>
          <p>
            Telefon: {NES_CONTACT_PHONE} · Mail: {NES_CONTACT_EMAIL}
          </p>
        </footer>
        <footer className="mt-10 border-t border-slate-200 pt-3 text-center text-xs leading-5 text-slate-500 print:hidden">
          <p>{NES_CONTACT_ADDRESS}</p>
          <p>
            Telefon: {NES_CONTACT_PHONE} · Mail: {NES_CONTACT_EMAIL}
          </p>
        </footer>
      </article>
    </div>
  );
}
