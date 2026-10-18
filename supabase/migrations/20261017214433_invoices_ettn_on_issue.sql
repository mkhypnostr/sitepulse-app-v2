-- Fatura kesilirken ETTN'yi GİB'in verdiği değerle değiştirmeye izin ver.
-- GİB portalı veya entegratör kendi ETTN'sini üretir; taslağın ETTN'si
-- yalnızca öneridir. Kesilmiş faturada ETTN yine değişmez (kilit aynı).
-- Yalnız fonksiyonu yeniler; tekrar çalıştırılabilir. Not: canlıda bu sürüm
-- numarasıyla uygulandı (20261018090000_invoices'dan önce sıralanır); aynı
-- son hal invoices dosyasında da var, sıra fark etmez.

CREATE OR REPLACE FUNCTION public.invoices_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  yr text;
  next_no integer;
  reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'taslak' THEN
      RAISE EXCEPTION 'Fatura taslak olarak oluşturulur.';
    END IF;
    yr := to_char(NEW.issue_date, 'YYYY');
    PERFORM pg_advisory_xact_lock(hashtext('invoice-draft-no-' || yr));
    SELECT COALESCE(MAX(split_part(draft_no, '-', 4)::integer), 0) + 1
      INTO next_no
      FROM public.invoices
     WHERE draft_no LIKE 'NES-FTR-' || yr || '-%';
    NEW.draft_no := 'NES-FTR-' || yr || '-' || lpad(next_no::text, 4, '0');
    NEW.issued_at := NULL;
    NEW.issued_by := NULL;
    NEW.cancelled_at := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = 'iptal' THEN
    RAISE EXCEPTION 'İptal edilmiş fatura değiştirilemez.';
  END IF;

  IF OLD.status = 'kesildi' THEN
    IF NEW.status <> 'iptal' THEN
      RAISE EXCEPTION 'Kesilmiş fatura değiştirilemez; gerekirse iptal edin.';
    END IF;
    reason := NEW.cancel_reason;
    IF reason IS NULL OR btrim(reason) = '' THEN
      RAISE EXCEPTION 'İptal nedeni yazılmalı.';
    END IF;
    NEW := OLD;
    NEW.status := 'iptal';
    NEW.cancel_reason := reason;
    NEW.cancelled_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Taslak üzerinde düzenleme (ETTN yalnız kesilirken değişebilir).
  NEW.draft_no := OLD.draft_no;
  IF NEW.status <> 'kesildi' THEN
    NEW.ettn := OLD.ettn;
  END IF;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  IF NEW.status = 'kesildi' THEN
    IF NOT EXISTS (SELECT 1 FROM public.invoice_lines WHERE invoice_id = OLD.id) THEN
      RAISE EXCEPTION 'Satırı olmayan fatura kesilemez.';
    END IF;
    NEW.issued_at := now();
    NEW.issued_by := auth.uid();
  ELSIF NEW.status = 'iptal' THEN
    NEW.cancelled_at := now();
    NEW.issued_at := NULL;
  ELSE
    NEW.issued_at := NULL;
    NEW.issued_by := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
