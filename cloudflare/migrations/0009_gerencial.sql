-- Aba Gerencial: produtividade comercial.
--
-- (1) Log de auditoria append-only: CADA acao humana nos contatos/fichas gera um
--     registro proprio (nao so a "ultima atualizacao"). Permite contar varias
--     atualizacoes do mesmo colaborador no mesmo dia. SEM FK para empresas/contatos:
--     o historico sobrevive a edicao/exclusao do contato ou da empresa.
--     'origem': 'humano' conta como produtividade; 'sistema' (import/cron) NAO.
--     'ts'/'dia' sao gravados em horario de Brasilia (helpers agora()/hoje()).
--
-- (2) Permissao de acesso gerencial (independente dos demais modulos). O superadmin
--     do env (bradel) NAO vive na tabela e sempre tem acesso; aqui liberamos os
--     demais individualmente (perm_gerencial=1).

CREATE TABLE IF NOT EXISTS auditoria (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT,     -- "YYYY-MM-DD HH:MM:SS" (Brasilia)
    dia           TEXT,     -- "YYYY-MM-DD" (Brasilia) — agrupamento diario
    usuario       TEXT,     -- username de quem realizou a acao
    acao          TEXT,     -- contato | status | faixa | empresa_edit | empresa_nova | filial_nova | filial_remove | contato_remove
    empresa_id    INTEGER,  -- sem FK: sobrevive a exclusao da empresa
    empresa_nome  TEXT,     -- snapshot do nome (preserva o historico)
    alvo_id       INTEGER,  -- id do contato/filial afetado, quando aplicavel
    campo         TEXT,     -- campo(s) alterado(s), quando aplicavel
    valor_antes   TEXT,
    valor_depois  TEXT,
    origem        TEXT NOT NULL DEFAULT 'humano'  -- 'humano' conta; 'sistema' nao
);
CREATE INDEX IF NOT EXISTS idx_auditoria_dia      ON auditoria(dia);
CREATE INDEX IF NOT EXISTS idx_auditoria_user_dia ON auditoria(usuario, dia);

-- Permissao de acesso gerencial (default: ninguem; admin do env sempre tem).
ALTER TABLE usuarios ADD COLUMN perm_gerencial INTEGER NOT NULL DEFAULT 0;

-- Backfill: os contatos ja registrados tem autor (criado_por) e data/hora
-- (criado_em, Brasilia). Reaproveitamos esse historico para o painel nascer com
-- dados reais. So entram contatos com autor preenchido.
INSERT INTO auditoria (ts, dia, usuario, acao, empresa_id, empresa_nome, alvo_id, origem)
SELECT c.criado_em,
       substr(c.criado_em, 1, 10),
       c.criado_por,
       'contato',
       c.empresa_id,
       e.razao_social,
       c.id,
       'humano'
  FROM contatos c
  LEFT JOIN empresas e ON e.id = c.empresa_id
 WHERE c.criado_por IS NOT NULL AND TRIM(c.criado_por) <> '';
