const DEFAULT_MAX_BYTES = 300 * 1024;

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Fotoğraf sıkıştırılamadı"));
      },
      "image/jpeg",
      quality,
    );
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Fotoğraf okunamadı. JPG, PNG veya WEBP kullanın."));
    };
    image.src = objectUrl;
  });
}

/**
 * Görseli yüklemeden önce JPEG'e çevirir ve mümkün olduğunca 300 KB altında tutar.
 * Küçük görseller gereksiz büyütülmez; okunabilirlik için kalite 0.45'in altına inmez.
 */
export async function compressImage(
  file: File,
  maxDimension = 1920,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Seçilen dosya bir fotoğraf değil");
  }

  const image = await loadImage(file);
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  const initialRatio = Math.min(1, maxDimension / Math.max(width, height));
  width = Math.max(1, Math.round(width * initialRatio));
  height = Math.max(1, Math.round(height * initialRatio));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Tarayıcı fotoğraf sıkıştırmayı desteklemiyor");

  let quality = 0.86;
  let result: Blob | null = null;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    result = await canvasToJpeg(canvas, quality);

    if (result.size <= maxBytes) return result;

    if (quality > 0.5) {
      quality = Math.max(0.5, quality - 0.08);
    } else {
      width = Math.max(640, Math.round(width * 0.85));
      height = Math.max(480, Math.round(height * 0.85));
      quality = 0.72;
    }
  }

  if (!result) throw new Error("Fotoğraf sıkıştırılamadı");
  return result;
}
