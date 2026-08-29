-- Her müşteri portal hesabı yalnızca tek bir müşteri kartına bağlı olabilir.
-- Teknik servis ekranı giriş yapan kullanıcı için tek firma beklediğinden bu
-- kural hem veri bütünlüğünü hem de müşteri izolasyonunu garanti eder.
CREATE UNIQUE INDEX IF NOT EXISTS customers_contact_user_id_unique_idx
  ON public.customers (contact_user_id)
  WHERE contact_user_id IS NOT NULL;

-- Müşteri kartına bağlı bir hesabın rolü doğrudan değiştirilirse bağlantı
-- geride kalır ve portal davranışı belirsizleşir. Önce müşteri kartından
-- eşleştirme kaldırılmalıdır. Yönetici ve teknik ofis rolleri bu RPC üzerinden
-- verilmez; bu ayrıcalıklı roller güvenli kullanıcı yönetimi akışında kalır.
CREATE OR REPLACE FUNCTION public.set_user_role(
  target_user_id UUID,
  new_role public.app_role
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
BEGIN
  IF current_user_id IS NULL OR NOT public.has_role(current_user_id, 'admin') THEN
    RAISE EXCEPTION 'Bu işlem için yönetici yetkisi gerekir';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'Kullanıcı bulunamadı';
  END IF;

  IF new_role NOT IN (
    'contractor'::public.app_role,
    'customer'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Bu ekrandan yalnızca taşeron veya müşteri rolü verilebilir';
  END IF;

  IF public.has_role(target_user_id, 'admin') THEN
    RAISE EXCEPTION 'Yönetici hesabının rolü Ekip ekranından değiştirilemez';
  END IF;

  IF new_role <> 'customer'::public.app_role
     AND EXISTS (
       SELECT 1
       FROM public.customers
       WHERE contact_user_id = target_user_id
     ) THEN
    RAISE EXCEPTION 'Bu hesap bir müşteriye bağlı. Rolü değiştirmeden önce müşteri eşleştirmesini kaldırın';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = target_user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (target_user_id, new_role);
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_role(UUID, public.app_role)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(UUID, public.app_role)
  TO authenticated;
