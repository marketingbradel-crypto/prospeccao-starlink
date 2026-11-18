-- Indices B-Tree para a listagem/pesquisa de empresas (acesso indexado em vez de
-- full table scan). Objetivo: filtros por igualdade do construirWhere() e a
-- ordenacao padrao passam a usar indice (seek O(log n)) em vez de varrer a tabela.
--
-- O que NAO da para indexar aqui (e por que fica fora desta migration):
--   * busca textual "q" => usa LIKE '%termo%' (curinga a esquerda). Nenhum indice
--     B-Tree acelera isso; so FTS5 resolveria, e FTS5 muda a semantica de match
--     (substring -> token/prefixo). Mantido como LIKE para preservar o resultado.
-- Todos sao CREATE INDEX IF NOT EXISTS: a migration e idempotente e nao mexe em dados.

-- --- Filtros por igualdade (cada um vira um index seek no construirWhere) ---
CREATE INDEX IF NOT EXISTS idx_empresas_cidade        ON empresas(cidade);
CREATE INDEX IF NOT EXISTS idx_empresas_microrregiao  ON empresas(microrregiao);
CREATE INDEX IF NOT EXISTS idx_empresas_responsavel   ON empresas(responsavel);
CREATE INDEX IF NOT EXISTS idx_empresas_canal         ON empresas(canal);
CREATE INDEX IF NOT EXISTS idx_empresas_segmento      ON empresas(segmento);
CREATE INDEX IF NOT EXISTS idx_empresas_prioridade    ON empresas(prioridade);
CREATE INDEX IF NOT EXISTS idx_empresas_faixa         ON empresas(faixa_potencial);
CREATE INDEX IF NOT EXISTS idx_empresas_pendencia_vsm ON empresas(pendencia_vsm);
CREATE INDEX IF NOT EXISTS idx_empresas_codigo        ON empresas(codigo);
CREATE INDEX IF NOT EXISTS idx_empresas_id_vsm        ON empresas(id_vsm);

-- --- Ordenacao padrao da listagem: ORDER BY razao_social COLLATE NOCASE ---
-- Indice na MESMA collation (NOCASE) permite ler ja ordenado, sem sort em memoria.
CREATE INDEX IF NOT EXISTS idx_empresas_razao_nocase  ON empresas(razao_social COLLATE NOCASE);

-- --- Indices compostos para combinacoes de filtro frequentes ---
-- (uf, status): territorio + funil comercial, o combo mais usado no painel.
CREATE INDEX IF NOT EXISTS idx_empresas_uf_status     ON empresas(uf, status);
-- (uf, cidade): drill-down de estado para municipio.
CREATE INDEX IF NOT EXISTS idx_empresas_uf_cidade     ON empresas(uf, cidade);
-- (responsavel, status): carteira de cada responsavel por etapa do funil.
CREATE INDEX IF NOT EXISTS idx_empresas_resp_status   ON empresas(responsavel, status);

-- Atualiza as estatisticas do planejador (sqlite_stat1) para que ele escolha bem
-- entre os indices disponiveis. Barato e recomendado apos criar indices.
ANALYZE;
