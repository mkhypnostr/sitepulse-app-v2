-- Denetim günlüğündeki hedef kullanıcı yabancı anahtarını indeksle.
CREATE INDEX IF NOT EXISTS user_management_audit_target_idx
  ON public.user_management_audit (target_user_id, created_at DESC);

