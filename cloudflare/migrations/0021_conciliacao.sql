-- Fila de CONCILIACAO (merge inteligente Formulario x VSM).
--
-- Um mesmo parceiro aparece 2x no painel quando entra pelo Formulario (sem ID
-- VSM, acompanha pendencias) e depois vira cadastro VSM (com ID VSM). O import
-- ja FUNDE automaticamente quando a chave e DECISIVA (mesmo CNPJ ou mesmo ID VSM
-- normalizado). Quando a correspondencia e apenas PROVAVEL (nome/telefone/cidade/
-- e-mail batem, mas sem chave decisiva) o parceiro NAO e fundido as cegas: cria-se
-- a ficha (o parceiro precisa aparecer) e registra-se aqui um CANDIDATO para um
-- admin revisar e aprovar/rejeitar a fusao. A varredura historica tambem popula
-- esta tabela com as duplicatas que ja existem na base (nunca funde sozinha).
--
-- Regras que esta fila respeita (ver trava-anti-duplicata-import / empresas-duplicadas):
--   * a CHAVE de qualquer fusao e o `id` inteiro (o REV-xxx NAO e unico);
--   * ID VSM diferente dos dois lados = cadastros distintos (filiais DIGISAT/
--     FRANCISCO ALVES), NUNCA viram candidato;
--   * `par_chave` (min-max dos ids) e UNICA: o mesmo par nunca enfileira 2x,
--     independentemente da ordem em que foi detectado.
CREATE TABLE IF NOT EXISTS conciliacao_candidatos (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    empresa_a        INTEGER NOT NULL,   -- mestre SUGERIDO (preserva id/historico)
    empresa_b        INTEGER NOT NULL,   -- absorvido SUGERIDO
    par_chave        TEXT NOT NULL,      -- "min-max" dos ids: dedup do par
    score            REAL DEFAULT 0,     -- 0..100
    confianca        TEXT,               -- 'alta' (chave decisiva) | 'media'
    sinais           TEXT,               -- JSON: {cnpj,id_vsm,nome,nome_fantasia,telefone,cidade,uf,email}
    status           TEXT NOT NULL DEFAULT 'pendente', -- pendente|aprovado|rejeitado|obsoleto
    origem_deteccao  TEXT,               -- 'import' | 'varredura'
    criado_em        TEXT,
    decidido_por     TEXT,
    decidido_em      TEXT,
    decisao_obs      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_concil_par    ON conciliacao_candidatos(par_chave);
CREATE INDEX        IF NOT EXISTS idx_concil_status ON conciliacao_candidatos(status);
