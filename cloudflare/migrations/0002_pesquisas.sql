-- Historico automatico de pesquisas de prospeccao (por regiao GO/TO/PA/MA).
-- Cada busca da aba "Prospeccao Starlink" e salva/atualizada aqui, permitindo
-- consultar, repesquisar ou excluir buscas anteriores sem refazer a consulta.
-- Dedup por `chave` (uf|cidade|microrregiao|termo normalizados): a mesma busca
-- ATUALIZA o registro existente em vez de duplicar.

CREATE TABLE IF NOT EXISTS pesquisas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uf TEXT,
    cidade TEXT,
    microrregiao TEXT,
    termo TEXT,
    text_query TEXT,
    chave TEXT UNIQUE,
    total INTEGER DEFAULT 0,
    novos INTEGER DEFAULT 0,
    excluidos INTEGER DEFAULT 0,
    resultados TEXT,          -- JSON com os candidatos encontrados
    criado_em TEXT,
    atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_pesquisas_uf ON pesquisas(uf);
CREATE INDEX IF NOT EXISTS idx_pesquisas_atualizado ON pesquisas(atualizado_em);
