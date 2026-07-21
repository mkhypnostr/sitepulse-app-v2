# NES Enerji İş Takip - Temiz Kurulum Kontrol Listesi

## 1. Eski sistemi koru

- Mevcut Supabase ve Vercel projelerini hemen silmeyin.
- Yeni kurulum doğrulanana kadar eski proje yalnızca yedek olarak kalsın.
- GitHub'da tercihen `rebuild-v2` branch'i veya `sitepulse-app-v2` isimli yeni repo kullanın.

## 2. Yeni Supabase projesi

Mevcut `bqmzjkrbekjsfjalxmwt` projesinde birbiriyle çakışan eski tablolar bulunduğu için en güvenli yol boş bir Supabase projesi oluşturmaktır.

SQL Editor'de aşağıdaki dosyaları sırayla ve ayrı ayrı çalıştırın:

1. `supabase/migrations/20260721173614_fc90a967-b286-4bd4-96b2-4c0da994fcb3.sql`
2. `supabase/migrations/20260721173629_36cc7102-5015-4535-afdd-63ce230dde3f.sql`
3. `supabase/migrations/20260722000000_secure_workflow.sql`

Üç işlem de `Success` sonucu vermeden sonraki adıma geçmeyin.

## 3. İlk yönetici

Supabase → Authentication → Users → Add user ile ilk kullanıcıyı oluşturun.

Ardından SQL Editor'de e-posta adresini değiştirerek çalıştırın:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin'::public.app_role
from auth.users
where email = 'YONETICI_EPOSTASI'
on conflict (user_id, role) do nothing;
```

Bu işlemden sonra çıkış yapıp tekrar giriş yapın.

## 4. Diğer kullanıcılar

- Kullanıcıları Authentication → Users bölümünden oluşturun.
- Yeni kullanıcılar güvenlik gereği otomatik olarak `customer` rolüyle başlar.
- Uygulamadaki **Ekip** ekranından `Taşeron`, `Müşteri` veya `Yönetici` rolünü atayın.
- Müşteri kullanıcısını **Müşteriler** ekranındaki ilgili firmaya bağlayın.

## 5. Vercel

GitHub repo'yu yeni bir Vercel projesi olarak içe aktarın.

- Framework otomatik algılamayı kullanın.
- Build Command: `npm run build`
- Output Directory alanını boş bırakın.
- Root Directory repo kökü olmalıdır.

Environment Variables bölümünde Production, Preview ve Development için:

```text
VITE_SUPABASE_URL=https://YENI_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YENI_PUBLISHABLE_KEY
SUPABASE_URL=https://YENI_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YENI_PUBLISHABLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` eklemeyin. Değişkenleri ekledikten sonra yeni deployment başlatın.

## 6. Supabase Auth URL ayarı

Supabase → Authentication → URL Configuration:

- Site URL: Vercel production adresi
- Redirect URLs: production adresi ve gerekiyorsa Vercel preview adresleri

## 7. Kabul testi

- Yönetici giriş yapabiliyor.
- Yönetici müşteri, iş emri ve stok kartı oluşturabiliyor.
- Taşeron yalnızca kendisine atanmış işi görüyor.
- Taşeron başka kullanıcıların profilini göremiyor.
- Taşeron ilerleme, özel malzeme ve NES stok tüketimi girebiliyor.
- Yetersiz stok girişinde işlem tamamen reddediliyor.
- Kamera ve galeriden çoklu fotoğraf yüklenebiliyor.
- Fotoğraflar yüklenmeden önce yaklaşık 300 KB altına sıkıştırılıyor.
- Müşteri yalnızca kendisine açılan iş emrini ve `Müşteriye Göster` işaretli fotoğrafları görüyor.
- Müşteri ve taşeron finansal iş emri tablosuna erişemiyor.
- Aylık rapor CSV olarak indirilebiliyor ve Excel'de Türkçe karakterlerle açılıyor.
