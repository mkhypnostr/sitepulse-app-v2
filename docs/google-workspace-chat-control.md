# NES Google Workspace sohbet yönetimi

Bu paket, ChatGPT'nin NES uygulamasındaki yönetici OAuth oturumunu kullanarak
Google Drive ve Calendar işlemlerini kontrollü araç çağrılarıyla yürütmesini sağlar.

## Güvenlik sınırları

- MCP yönetim araçları yalnızca NES uygulamasında `admin` rolü bulunan
  `@nesgrup.com` hesaplarını kabul eder. `technical_office` rolü yalnızca
  uygulamadaki proje akışından idempotent proje klasörü oluşturabilir.
- Edge gateway JWT doğrulaması Google callback nedeniyle kapalıdır; MCP istekleri
  fonksiyon içinde Supabase Auth ve NES admin rolüyle yeniden doğrulanır.
- Google access/refresh tokenları yalnızca Supabase Vault'ta tutulur.
- OAuth client secret kaynak koda, migration dosyasına veya işlem günlüklerine yazılmaz.
- Drive/Calendar yazma araçları MCP `annotations` alanında yazma işlemi olarak işaretlidir;
  ChatGPT çalıştırmadan önce kullanıcı onayı ister.
- Taşeron ve müşterilere Ortak Drive kök erişimi veren bir araç sunulmaz.
- Silme, üyelik kaldırma veya dosya taşıma aracı bu sürüme dahil değildir.

## Dağıtım sırası

Bu adımlar PR incelemesi ve açık canlıya alma onayından sonra uygulanır:

1. `20260815120000_google_workspace_chat_control.sql` migration'ını uygula.
2. Aşağıdaki Edge Function secretlarını ekle:
   - `GOOGLE_WORKSPACE_CLIENT_ID`
   - `GOOGLE_WORKSPACE_CLIENT_SECRET`
   - `GOOGLE_WORKSPACE_REDIRECT_URI`
   - isteğe bağlı `NES_OPERATIONS_DRIVE_ID`
3. `nes-workspace-control` Edge Function'ını dağıt.
4. Google OAuth web client'ında aşağıdaki dönüş adresini izinli URI olarak ekle:
   `https://nyfocdnlbknxpxbeeapj.supabase.co/functions/v1/nes-workspace-control/google/callback`
5. ChatGPT özel bağlayıcı adresi olarak aşağıdaki MCP URL'sini ekle:
   `https://nyfocdnlbknxpxbeeapj.supabase.co/functions/v1/nes-workspace-control`
6. Sohbetten `start_google_workspace_connection` aracını çağırıp Mehmet'in
   `@nesgrup.com` hesabıyla tek seferlik Google onayını tamamla.

## Sunulan araçlar

| Araç                                | Etki                                                          |
| ----------------------------------- | ------------------------------------------------------------- |
| `get_google_workspace_status`       | Bağlantı ve kayıtlı kaynakları okur                           |
| `start_google_workspace_connection` | Süreli Google OAuth bağlantısı üretir                         |
| `list_nes_workspace_candidates`     | Kurumsal yönetici/teknik ofis adaylarını okur                 |
| `initialize_nes_workspace`          | İki Ortak Drive'ın klasör ve erişimlerini idempotent kurar    |
| `ensure_nes_workspace_member`       | Uygulama rolüne göre güvenli Drive üyeliği ekler/günceller    |
| `create_project_workspace`          | Uygulamadaki proje için standart Drive klasörlerini oluşturur |
| `create_nes_calendar_event`         | Google Calendar etkinliği ve davetleri oluşturur              |

## Varsayılan yetki modeli

- Mehmet ve ikinci yönetici: iki Ortak Drive'da `organizer`.
- Operasyon yöneticisi: yalnız `NES Operasyon` içinde `fileOrganizer`.
- Finans Drive'ına operasyon yöneticisi eklenmez.
- İşlemler `google_workspace_operation_audit` tablosunda, token veya gizli değer
  içermeyen özetlerle kaydedilir.

## v8 klasör modeli

Ana klasörler yalnız bir kez oluşturulur:

- `NES Operasyon`: Projeler; Merkezi Stok, Ekipman ve Lojistik; Ortak Teknik
  Kütüphane ve Şablonlar; Genel Operasyon ve Toplantılar; Operasyon Arşivi.
- `NES Yönetim ve Finans`: Faturalar ve Muhasebe; Ödeme, Tahsilat ve Banka;
  Bütçe, Maliyet ve Hakediş; Mali Arşiv.

Her yeni proje kaydedildiğinde uygulama `create_project_workspace` aracını
otomatik çağırır. Operasyon projesinde Teklif ve Sözleşme, Teknik Dokümanlar,
Saha Raporları ve Tutanaklar, Fotoğraf ve Videolar, Satın Alma ve Sevkiyat,
Proje Kapanışı klasörleri oluşur. Finans tarafında aynı proje için yalnız Bütçe,
Maliyet ve Hakediş klasörleri açılır. Proje detayındaki **Drive Klasörlerini
Hazırla** düğmesi güvenli tekrar/iyileştirme yoludur; çağrı idempotent olduğu için
mükerrer klasör üretmez.
