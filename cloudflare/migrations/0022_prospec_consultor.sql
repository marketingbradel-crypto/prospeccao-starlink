-- Atribuicao automatica de consultor aos leads de prospeccao (varredura_pendentes).
-- Guarda a microrregiao e o consultor responsavel resolvidos no momento em que o
-- lead e encontrado, espelhando listas.ts::responsavelPara (UF padrao + excecoes
-- por microrregiao). Mesmo criterio aplicado ao salvar na base (empresas).
ALTER TABLE varredura_pendentes ADD COLUMN microrregiao TEXT;
ALTER TABLE varredura_pendentes ADD COLUMN responsavel TEXT;
CREATE INDEX IF NOT EXISTS idx_pendentes_resp ON varredura_pendentes(responsavel);
