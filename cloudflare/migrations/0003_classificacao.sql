-- Classificacao comercial de parceiros/prospects (Bradel Starlink).
-- Dois campos preenchidos manualmente no contato com o cliente:
--   faixa_potencial — capacidade estimada de vendas/mes (10+/30+/50+/80+/100+)
--   ja_vendeu       — marcador simples Sim/Nao de "ja fez venda"
-- ALTER sem IF NOT EXISTS: D1 ignora a migracao ja aplicada pelo controle de versao.

ALTER TABLE empresas ADD COLUMN faixa_potencial TEXT;
ALTER TABLE empresas ADD COLUMN ja_vendeu INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_empresas_faixa ON empresas(faixa_potencial);
CREATE INDEX IF NOT EXISTS idx_empresas_javendeu ON empresas(ja_vendeu);
