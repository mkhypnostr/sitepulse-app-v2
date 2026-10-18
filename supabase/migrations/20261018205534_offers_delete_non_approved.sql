-- Teklifler listesinden silme: taslak dışındaki teklifler de (gönderilmiş,
-- revizyon bekleyen, kaybedilen, iptal…) silinebilir. Onaylanmış teklif
-- fatura/cari kaydına bağlanabildiği için silinmez; "İptal" durumuna alınır.
-- Kalemler, teklif dosyası ve müşteri linkleri ON DELETE CASCADE ile gider.
DROP POLICY IF EXISTS "finance managers can delete draft offers" ON public.offers;
CREATE POLICY "finance managers can delete non-approved offers"
  ON public.offers
  FOR DELETE
  TO authenticated
  USING (
    (SELECT public.can_manage_finance(auth.uid())) AND status <> 'approved'
  );
