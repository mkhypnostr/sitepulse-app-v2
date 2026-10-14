<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

<!-- NES:BEGIN -->

# NES Enerji İş Takip — Çalışma Kuralları

Bu dosya, bu depoda çalışan her yapay zekâ oturumu için bağlayıcıdır. Proje
sahibi Mehmet Kılınçkaya'dır; kod bilmez, kararları o verir. Yanıtlar ve PR
açıklamaları **Türkçe**, açık ve teknik jargonu gereksiz kullanmadan yazılır.

## Komut sözlüğü

Kullanıcının kullandığı kelimeler şu anlama gelir; kapsamı aşma:

| Kelime     | Anlamı                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| İncele     | Yalnızca analiz et. Hiçbir dosyayı, veritabanını veya ayarı değiştirme. |
| Kontrol et | Hata ve eksikleri bul, raporla. Henüz düzeltme.                         |
| Öner       | Alternatifleri gerekçesiyle sun. Uygulama.                              |
| Hazırla    | İstenen metni, planı veya dosyayı oluştur.                              |
| Düzelt     | Yalnızca belirtilen kapsamda değişiklik yap.                            |
| Uygula     | Kararlaştırılmış değişikliği yap, test et, sonucu bildir.               |
| Test et    | Sonucu doğrula, bulguları raporla.                                      |
| Birleştir  | Belirtilen dalı hedef dala merge et.                                    |
| Yayınla    | Canlıya al (main'e merge, migration, Edge Function deploy).             |

"Uygula" denmişse ve kapsam netse aynı onayı tekrar tekrar isteme.

## Kesin kurallar

1. **Onaysız `main`'e merge veya canlıya yayın yok.** Her değişiklik ayrı dalda
   yapılır ve PR olarak açılır. `main`'e her push Vercel'de canlıya çıkar ve
   Lovable'a senkronize olur.
2. **Canlı veritabanına onaysız yazma yok.** Migration uygulama, Edge Function
   deploy, secret değiştirme, kullanıcı/rol değiştirme açık onay ister.
   Okuma amaçlı SQL serbesttir.
3. **Önce kök nedeni doğrula, sonra kodu değiştir.** Varsayımla düzeltme yapma;
   canlı şemayı ve gerçek veriyi kontrol et.
4. **Çalışan özelliği bozma.** Değişikliği küçük ve tek amaçlı tut.
5. **Veri kaybı riski varsa açıkça uyar** ve onay olmadan ilerleme.
6. **"Yaptım" demeden önce doğrula.** Doğrulayamadığın şeyi doğrulanmış gibi
   raporlama; neyi test edemediğini açıkça yaz.
7. **Git geçmişini yeniden yazma.** Force push, push edilmiş commit'te rebase,
   amend veya squash yok (Lovable geçmişi bozulur).

## Güvenlik ve roller

- Roller: `admin` (Yönetici), `technical_office` (Teknik Ofis), `contractor`
  (Taşeron), `customer` (Müşteri).
- **Finansal veriler yalnızca `admin`'e görünür.** Teknik ofis operasyonu
  yönetir ama satış/maliyet/kâr göremez.
- Taşeron yalnızca kendine atanan kayıtları, müşteri yalnızca kendi firmasının
  müşteriye açık kayıtlarını görür.
- Yetki kontrolü **yalnızca arayüzde yapılmaz**; Supabase RLS ve RPC içindeki rol
  kontrolleriyle de korunur.
- Yeni `SECURITY DEFINER` fonksiyonlarda `anon` rolünden `EXECUTE` kaldırılır:
  `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`
- Rol veya görünürlük değişikliğinde yönetici, teknik ofis, taşeron ve müşteri
  ayrı ayrı düşünülür. Mobil görünüm ayrıca kontrol edilir.

## Altyapı

| Öğe              | Değer                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Canlı adres      | https://app.nesgrup.com                                                                   |
| Supabase projesi | `nyfocdnlbknxpxbeeapj` (nes-enerji-is-takip-v2). Eski `bqmzjkrbekjsfjalxmwt` kullanılmaz. |
| Vercel projesi   | `sitepulse-app-v2`, ekip `nesenerji`                                                      |
| Paket yöneticisi | bun (`bun.lock`). `package-lock.json` eklenmez.                                           |
| Arayüz           | TypeScript, React, TanStack Start/Router/Query, Tailwind, Radix                           |

## Migration kuralı

- Her migration `supabase/migrations/` altında dosya olarak eklenir.
- **Canlı geçmişteki sürüm numarası dosya adıyla aynı olmalıdır.** MCP
  `apply_migration` kendi zaman damgasını üretir ve geçmişi kaydırır. Uyguladıktan
  sonra canlı sürümü dosya adıyla eşitle veya `supabase db push` kullan.
  Uyguladıktan sonra `list_migrations` ile kontrol et.
- Migration'lar tekrar çalıştırılabilir (idempotent) yazılır.
- Şema değişikliğinden sonra `src/integrations/supabase/types.ts` yeniden üretilir
  ve Supabase güvenlik uyarıları (advisors) kontrol edilir.

## PR öncesi zorunlu kontroller

1. `npx tsc --noEmit` hatasız olmalı. **`vite build` tip hatalarını yakalamaz**,
   tek başına yeterli değildir.
2. `npm run build` başarılı olmalı.
3. Değişen dosyalarda `npx eslint` ve `npx prettier --check` temiz olmalı.
4. PR açıklaması Türkçe yazılır ve şunları içerir: ne değişti, neden, hangi
   rolleri etkiler, migration/Edge Function var mı, nasıl test edildi, neyin test
   edilemediği.

## Kapsam dışı (ayrı karar gerektirir)

- WhatsApp: Twilio sandbox +90 numaralara çalışmadı. Teknik servis için Meta
  WhatsApp Business altyapısı kodda var; Meta hattı ve şablonları onaylanmadan
  canlıda etkinleştirilmez.
- Müşteriye e-posta bildirimi: `show_to_customer` portal görünürlüğüdür, bildirim
  izni değildir. Ayrı bir müşteri bildirim tercihi olmadan müşteriye e-posta
  gönderilmez.

<!-- NES:END -->
