-- Teknik ofis, Onay ve Uyarı Merkezi'nde saha ilerleme ve iş bitirme onay
-- kayıtlarını görebilmelidir (finansal veriye erişim bu politikalarla
-- verilmez; work_order_financials hâlâ yalnızca yöneticiye açıktır).
-- Onaylama/reddetme yetkisi bu tablolarda hâlâ yalnızca admin'e özeldir
-- (review_progress_update ve review_work_completion "admin" ister); bu
-- migration yalnızca görünürlük (SELECT) sağlar, yazma yetkisi vermez.

DROP POLICY IF EXISTS "technical_office_progress_updates_read" ON public.progress_updates;
CREATE POLICY "technical_office_progress_updates_read"
ON public.progress_updates
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

DROP POLICY IF EXISTS "technical_office_completion_submissions_read" ON public.work_completion_submissions;
CREATE POLICY "technical_office_completion_submissions_read"
ON public.work_completion_submissions
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));

-- İş bitirme kanıtlarının sayısı da görünür olmalı; aksi halde teknik ofis
-- onay bekleyen kaydı görür ama kanıt sayısını hiçbir zaman göremez.
DROP POLICY IF EXISTS "technical_office_completion_evidence_read" ON public.work_completion_evidence;
CREATE POLICY "technical_office_completion_evidence_read"
ON public.work_completion_evidence
FOR SELECT TO authenticated
USING (public.can_manage_projects((SELECT auth.uid())));
