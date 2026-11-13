-- Staging da varredura automatica: empresas encontradas pela varredura ficam
-- aqui aguardando revisao manual antes de entrar na base (tabela `empresas`).
-- O usuario aprova (salva na base) ou descarta na aba "Prospeccao Starlink".
-- Dedup por `chave` (telefone normalizado OU nome+cidade normalizados): o mesmo
-- candidato encontrado de novo NAO duplica (INSERT OR IGNORE).

CREATE TABLE IF NOT EXISTS varredura_pendentes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT,
    tipo TEXT,
    endereco TEXT,
    cidade TEXT,
    uf TEXT,
    telefone TEXT,
    whatsapp TEXT,
    site TEXT,
    fonte TEXT,
    lat REAL,
    lng REAL,
    place_id TEXT,
    chave TEXT UNIQUE,
    encontrado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_pendentes_uf ON varredura_pendentes(uf);
CREATE INDEX IF NOT EXISTS idx_pendentes_encontrado ON varredura_pendentes(encontrado_em);
