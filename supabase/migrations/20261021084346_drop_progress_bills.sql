-- Hakedişler ayrı sayfada tutulmuyor; asistan PDF'leri doğrudan sohbette
-- üretiyor. Boş tablolar kaldırılır. assistant-uploads deposu kalır.
DROP TABLE IF EXISTS public.progress_bill_lines;
DROP TABLE IF EXISTS public.progress_bills;
DROP FUNCTION IF EXISTS public.progress_bills_before_insert();
DROP FUNCTION IF EXISTS public.progress_bills_before_update();
