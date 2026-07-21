# NES Enerji İş Takip

Yönetici, taşeron ve müşteri rolleri için Supabase tabanlı saha iş takip uygulaması.

## Yerel kurulum

```sh
npm install
cp .env.example .env
npm run dev
```

`.env` dosyasındaki bütün `YOUR_...` alanlarını aynı Supabase projesinin bilgileriyle doldurun.

## Supabase kurulumu

Yeni ve boş bir Supabase projesinde migration dosyalarını tarih sırasıyla çalıştırın:

1. `supabase/migrations/20260721173614_fc90a967-b286-4bd4-96b2-4c0da994fcb3.sql`
2. `supabase/migrations/20260721173629_36cc7102-5015-4535-afdd-63ce230dde3f.sql`
3. `supabase/migrations/20260722000000_secure_workflow.sql`

İlk kullanıcıyı Supabase Dashboard → Authentication → Users bölümünden oluşturun. Ardından SQL Editor'de kullanıcıyı yönetici yapın:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin'::public.app_role
from auth.users
where email = 'YONETICI_EPOSTASI'
on conflict (user_id, role) do nothing;
```

## Vercel değişkenleri

Production, Preview ve Development ortamlarına aşağıdaki dört değişkeni ekleyin:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
```

Değerler Supabase → Project Settings → API bölümünden alınır. `SUPABASE_SERVICE_ROLE_KEY` tarayıcıya açılmaz ve `VITE_` önekiyle kullanılmaz.

## Stok CSV formatı

Excel dosyasını **CSV UTF-8** olarak kaydedin. Zorunlu sütunlar:

```text
kod;malzeme adı;birim;miktar;minimum stok;lokasyon;açıklama
```

`birim` değeri `adet` veya `metre` olmalıdır.
