-- Dados de Capilaridade VSM (planilha Vivensis "Capilaridade-vsm", colunas I/J/K).
-- Campos SOMENTE LEITURA, alimentados por import/backfill a partir da planilha;
-- NAO entram no formulario de edicao da ficha (ficam fora de EMPRESA_CAMPOS).
--   pendencia_vsm   = Pendencia Treino/Contrato (coluna I)
--   vendas_vsm      = Vendas Concluidas (coluna J)
--   instalacoes_vsm = Instalacoes Executadas (coluna K)
ALTER TABLE empresas ADD COLUMN pendencia_vsm TEXT;
ALTER TABLE empresas ADD COLUMN vendas_vsm INTEGER DEFAULT 0;
ALTER TABLE empresas ADD COLUMN instalacoes_vsm INTEGER DEFAULT 0;
