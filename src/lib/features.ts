// Uygulama genelinde açılıp kapatılabilen bölümler.
//
// GES (güneş enerjisi) işleri şimdilik yüklenici firma üzerinden, teklif dahil
// uygulama dışında yürütülüyor. GES ekranları, seçenekleri ve asistan aracı
// gizlendi; kod ve kayıtlar duruyor. Geri açmak için `ges: true` yapılır.
export const FEATURES = {
  ges: false,
} as const;
