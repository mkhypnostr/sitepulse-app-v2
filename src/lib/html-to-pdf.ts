// Bizim ürettiğimiz A4 HTML belgeleri (keşif föyü vb.) PDF dosyasına çevirir:
// belge görünmez bir çerçevede çizilir, her ".page" bölümü resme dönüştürülüp
// A4 sayfalara yerleştirilir. Kütüphaneler yalnız gerektiğinde yüklenir.

export async function htmlToPdf(html: string, filename: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:860px;height:1200px;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("Belge hazırlanamadı.");
    doc.open();
    doc.write(html);
    doc.close();
    // Görsellerin ve yazı tiplerinin yüklenmesini bekle.
    await new Promise((r) => setTimeout(r, 300));
    await Promise.all(
      [...doc.images].map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((r) => {
              img.onload = img.onerror = () => r(null);
            }),
      ),
    );
    const pages = [...doc.querySelectorAll<HTMLElement>(".page")];
    const targets = pages.length ? pages : [doc.body];
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const pageW = 210;
    const pageH = 297;
    let first = true;
    for (const el of targets) {
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        windowWidth: 860,
      });
      // Uzun bölümü A4 yüksekliğinde dilimle.
      const pxPerMm = canvas.width / pageW;
      const sliceH = Math.floor(pageH * pxPerMm);
      for (let y = 0; y < canvas.height; y += sliceH) {
        const h = Math.min(sliceH, canvas.height - y);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = h;
        slice
          .getContext("2d")
          ?.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (!first) pdf.addPage();
        first = false;
        pdf.addImage(
          slice.toDataURL("image/jpeg", 0.85),
          "JPEG",
          0,
          0,
          pageW,
          h / pxPerMm,
        );
      }
    }
    const blob = pdf.output("blob");
    return new File([blob], filename, { type: "application/pdf" });
  } finally {
    frame.remove();
  }
}
