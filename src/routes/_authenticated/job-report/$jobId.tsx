import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, FileText, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage, photoTypeLabels } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { formatProjectDateTime } from "@/lib/projects";
import { EmptyState, LoadingState } from "@/components/page-states";
import { Button } from "@/components/ui/button";
import { NES_COMPANY, NES_CONTACT_LINE } from "@/lib/nes-company";
import { coordinatesFromLocation, reverseGeocode } from "@/lib/reverse-geocode";

export const Route = createFileRoute("/_authenticated/job-report/$jobId")({
  component: JobReportPage,
});

// Antet bilgileri NES_ANTENT.docx'ten alınıp tek yerde tutulur.
const NES_LOGO_URL = NES_COMPANY.logoPath;
const NES_CONTACT_ADDRESS = NES_COMPANY.address;
const NES_CONTACT_PHONE = NES_COMPANY.phone;
const NES_CONTACT_EMAIL = NES_COMPANY.email;

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

  // Konum: yazılı adres varsa o; yoksa bağlantıdaki koordinattan adres
  // çözülür. Belgeye Google bağlantısı yazılmaz.
  const locationText = reportQuery.data?.order.location?.trim() || "";
  const coordinates = locationText
    ? null
    : coordinatesFromLocation(reportQuery.data?.order.location_url);
  const addressQuery = useQuery({
    queryKey: [
      "reverse-geocode",
      coordinates?.latitude,
      coordinates?.longitude,
    ],
    enabled: Boolean(coordinates),
    staleTime: Infinity,
    queryFn: () =>
      reverseGeocode(coordinates!.latitude, coordinates!.longitude),
  });
  const addressText =
    locationText ||
    addressQuery.data ||
    (coordinates
      ? addressQuery.isLoading
        ? "Adres alınıyor..."
        : `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`
      : "-");

  // A4'e sığdırma: içerik sayfadan uzunsa tamamı orantılı küçültülür.
  const sheetRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const fitToPage = useCallback(() => {
    const sheet = sheetRef.current;
    const content = contentRef.current;
    if (!sheet || !content) return;
    const style = getComputedStyle(sheet);
    const available =
      sheet.clientHeight -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom);
    content.style.zoom = "1";
    content.style.width = "100%";
    const natural = content.scrollHeight;
    const next = natural > available ? available / natural : 1;
    const rounded = Math.floor(next * 1000) / 1000;
    content.style.zoom = String(rounded);
    content.style.width = `${100 / rounded}%`;
    setScale(rounded);
  }, []);
  useEffect(() => {
    fitToPage();
  }, [fitToPage, reportQuery.data, addressText]);

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

  const { order, photos, materials, submissions } = reportQuery.data;
  const approvedSubmission = submissions.find(
    (submission) => submission.status === "approved",
  );
  // Müşteriye verilen belge: taşeron adı ve malzeme kaynağı yazılmaz.
  const isDraft = order.status !== "completed";
  const completedAt =
    approvedSubmission?.reviewed_at ?? order.completion_submitted_at ?? null;
  const completionText =
    approvedSubmission?.note ||
    order.completion_note ||
    "Tamamlanma açıklaması bulunmuyor.";
  const fileBase = `NES-teslim-tutanagi-${order.work_order_no}`;

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
          </tr>`,
          )
          .join("")
      : '<tr><td colspan="2">Malzeme kaydı bulunmuyor.</td></tr>';
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
        .sign td{height:90px;vertical-align:top;width:50%}
      </style></head><body>
        <div class="letterhead">
          <h1 style="margin:0">İŞ TAMAMLAMA VE TESLİM TUTANAĞI${isDraft ? " (TASLAK)" : ""}</h1>
          <img src="${logoDataUrl}" alt="NES Enerji" />
        </div>
        <div class="meta">
          <h2>#${escapeHtml(order.work_order_no)} · ${escapeHtml(order.title)}</h2>
          <p><strong>Müşteri:</strong> ${escapeHtml(order.customers?.name || "-")}</p>
          <p><strong>Başlangıç:</strong> ${escapeHtml(formatDate(order.scheduled_at))}</p>
          <p><strong>Tamamlanma:</strong> ${escapeHtml(completedAt ? formatDate(completedAt) : "-")}</p>
          <p><strong>Konum:</strong> ${escapeHtml(addressText)}</p>
        </div>
        ${order.description?.trim() ? `<h2>Yapılan İş</h2><p>${escapeHtml(order.description)}</p>` : ""}
        <h2>Tamamlanma Özeti</h2>
        <p>${escapeHtml(completionText)}</p>
        <h2>Kullanılan Malzemeler</h2>
        <table><thead><tr><th>Malzeme</th><th>Miktar</th></tr></thead><tbody>${materialRows}</tbody></table>
        <h2>Saha Fotoğrafları ve Belgeleri</h2>${photoBlocks}
        <h2>Teslim</h2>
        <p>Yukarıda belirtilen işler tamamlanmış ve çalışır durumda teslim edilmiştir. Teslim alan, işi yerinde kontrol ettiğini beyan eder.</p>
        <table class="sign"><tr>
          <td><strong>Teslim Eden — NES Enerji</strong><br/>Ad Soyad:<br/><br/>İmza:<br/><br/>Tarih:</td>
          <td><strong>Teslim Alan — Müşteri</strong><br/>Ad Soyad:<br/><br/>İmza:<br/><br/>Tarih:</td>
        </tr></table>
        <div class="report-footer">
          <p>${escapeHtml(NES_CONTACT_ADDRESS)}</p>
          <p>Telefon: ${escapeHtml(NES_CONTACT_PHONE)} &middot; Mail: ${escapeHtml(NES_CONTACT_EMAIL)}</p>
        </div>
      </body></html>`;
    const blob = new Blob(["\ufeff", html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileBase}.doc`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function printSheet() {
    const sheet = sheetRef.current;
    if (!sheet) return;
    // Yazdırma ayrı bir çerçevede yapılır: menü ve uygulama kabuğu basılmaz,
    // sayfa tam bir A4 olur.
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      frame.remove();
      return;
    }
    const styles = [
      ...document.querySelectorAll('link[rel="stylesheet"], style'),
    ]
      .map((node) => node.outerHTML)
      .join("");
    doc.open();
    doc.write(
      `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${escapeHtml(fileBase)}</title>${styles}<style>@page{size:A4;margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important}.a4-sheet{margin:0!important;box-shadow:none!important;border-radius:0!important}</style></head><body>${sheet.outerHTML}</body></html>`,
    );
    doc.close();
    const images = [...doc.images];
    void Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.onload = img.onerror = () => resolve(null);
            }),
      ),
    ).then(() => {
      setTimeout(() => {
        win.focus();
        win.print();
        setTimeout(() => frame.remove(), 60_000);
      }, 250);
    });
  }

  const visualPhotos = photos.filter((photo) => !photo.is_document);
  const documents = photos.filter((photo) => photo.is_document);
  const photoColumns =
    visualPhotos.length <= 2 ? 2 : visualPhotos.length <= 6 ? 3 : 4;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link to="/jobs/$jobId" params={{ jobId }}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Göreve dön
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {scale < 1 ? (
            <span className="text-xs text-muted-foreground">
              Tek A4 sayfaya sığdırıldı (%{Math.round(scale * 100)})
            </span>
          ) : null}
          <Button variant="outline" onClick={printSheet}>
            <Printer className="mr-2 h-4 w-4" /> PDF / Yazdır
          </Button>
          <Button onClick={downloadWordReport}>
            <Download className="mr-2 h-4 w-4" /> Word İndir
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto pb-6">
        <article
          ref={sheetRef}
          className="a4-sheet relative mx-auto overflow-hidden bg-white text-slate-950 shadow-[0_6px_30px_rgba(20,40,40,0.15)]"
          style={{
            width: "210mm",
            height: "297mm",
            padding: "11mm 13mm 24mm",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          <img
            src={NES_LOGO_URL}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 w-[150mm] -translate-x-1/2 -translate-y-1/2 opacity-[0.08]"
          />
          <div ref={contentRef} className="relative">
            <header className="flex items-end justify-between gap-4 border-b border-slate-800 pb-2">
              <div className="min-w-0">
                <h1 className="text-[20px] leading-tight font-black">
                  İş Tamamlama ve Teslim Tutanağı
                  {isDraft ? " (Taslak)" : ""}
                </h1>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  #{order.work_order_no} · {order.title}
                </p>
              </div>
              <img
                src={NES_LOGO_URL}
                alt="NES Enerji"
                className="h-[10mm] w-auto shrink-0 object-contain"
              />
            </header>

            {isDraft ? (
              <p className="mt-3 rounded border border-slate-400 p-2 text-[11px] font-semibold text-slate-700">
                Taslak: iş henüz NES onayından geçmedi. Onaydan sonra kesin
                tutanak olarak yazdırın.
              </p>
            ) : null}

            <section className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg bg-blue-50 p-3 text-[12px]">
              <p>
                <strong>Müşteri:</strong> {order.customers?.name || "-"}
              </p>
              <p>
                <strong>Başlangıç:</strong> {formatDate(order.scheduled_at)}
              </p>
              <p>
                <strong>Tamamlanma:</strong>{" "}
                {completedAt ? formatProjectDateTime(completedAt) : "-"}
              </p>
              <p>
                <strong>İş no:</strong> #{order.work_order_no}
              </p>
              <p className="col-span-2">
                <strong>Konum:</strong> {addressText}
              </p>
            </section>

            <section className="mt-4">
              <h2 className="text-[14px] font-black">
                Yapılan İş ve Tamamlanma Özeti
              </h2>
              {order.description?.trim() ? (
                <p className="mt-1 text-[12px] whitespace-pre-wrap text-slate-700">
                  {order.description}
                </p>
              ) : null}
              <p className="mt-1 text-[12px] whitespace-pre-wrap text-slate-700">
                {completionText}
              </p>
            </section>

            <section className="mt-4">
              <h2 className="text-[14px] font-black">Kullanılan Malzemeler</h2>
              {materials.length ? (
                <table className="mt-1.5 w-full border-collapse text-[11.5px]">
                  <thead>
                    <tr className="bg-slate-100 text-left">
                      <th className="border border-slate-300 px-2 py-1">
                        Malzeme
                      </th>
                      <th className="w-[35mm] border border-slate-300 px-2 py-1">
                        Miktar
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((material) => (
                      <tr key={material.id}>
                        <td className="border border-slate-300 px-2 py-1">
                          {material.is_nes_stock
                            ? material.stock_items?.name
                            : material.custom_material_name}
                        </td>
                        <td className="border border-slate-300 px-2 py-1">
                          {material.quantity} {material.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mt-1 text-[12px] text-slate-500">
                  Malzeme kaydı yok.
                </p>
              )}
            </section>

            {visualPhotos.length || documents.length ? (
              <section className="mt-4">
                <h2 className="flex items-center gap-1.5 text-[14px] font-black">
                  <FileText className="h-4 w-4 text-blue-700" /> Saha
                  Fotoğrafları ve Belgeleri
                </h2>
                {visualPhotos.length ? (
                  <div
                    className="mt-1.5 grid gap-2"
                    style={{
                      gridTemplateColumns: `repeat(${photoColumns}, minmax(0, 1fr))`,
                    }}
                  >
                    {visualPhotos.map((photo) => (
                      <figure
                        key={photo.id}
                        className="overflow-hidden rounded-md border border-slate-200 bg-white"
                      >
                        {photo.signedUrl ? (
                          <img
                            src={photo.signedUrl}
                            alt={photo.caption || "Saha fotoğrafı"}
                            onLoad={fitToPage}
                            className="aspect-[4/3] w-full object-cover"
                          />
                        ) : null}
                        <figcaption className="px-2 py-1 text-[10px] leading-snug text-slate-600">
                          <strong className="text-slate-900">
                            {photoTypeLabels[photo.photo_type]}
                          </strong>
                          {photo.caption ? ` · ${photo.caption}` : ""}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : null}
                {documents.length ? (
                  <p className="mt-1.5 text-[11px] text-slate-600">
                    <strong>Ekli belgeler:</strong>{" "}
                    {documents
                      .map((doc) => doc.caption || "PDF belge")
                      .join(" · ")}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="mt-4">
              <h2 className="text-[14px] font-black">Teslim</h2>
              <p className="mt-1 text-[11.5px] text-slate-700">
                Yukarıda belirtilen işler tamamlanmış ve çalışır durumda teslim
                edilmiştir. Teslim alan, işi yerinde kontrol ettiğini beyan
                eder.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-4">
                {["Teslim Eden — NES Enerji", "Teslim Alan — Müşteri"].map(
                  (label) => (
                    <div
                      key={label}
                      className="rounded-md border border-slate-300 p-3 text-[11.5px]"
                    >
                      <p className="font-bold">{label}</p>
                      <p className="mt-2">Ad Soyad:</p>
                      <p className="mt-5">İmza:</p>
                      <p className="mt-5">Tarih:</p>
                    </div>
                  ),
                )}
              </div>
            </section>
          </div>

          <footer
            className="absolute border-t border-slate-800 pt-1.5 text-center text-[9px] leading-4 text-slate-700"
            style={{ left: "13mm", right: "13mm", bottom: "8mm" }}
          >
            <p>{NES_COMPANY.address}</p>
            <p>{NES_CONTACT_LINE}</p>
          </footer>
        </article>
      </div>
    </div>
  );
}
