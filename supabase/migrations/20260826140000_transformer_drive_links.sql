-- Firma klasörü ve yıllık sözleşme dosyası için doğrulanmış Drive bağlantıları.

ALTER TABLE public.transformer_companies
  ADD COLUMN drive_folder_url text
    CHECK (
      drive_folder_url IS NULL
      OR drive_folder_url ~* '^https://drive\\.google\\.com/'
    );

ALTER TABLE public.transformer_responsibility_contracts
  ADD COLUMN contract_document_url text
    CHECK (
      contract_document_url IS NULL
      OR contract_document_url ~* '^https://(drive|docs)\\.google\\.com/'
    );
