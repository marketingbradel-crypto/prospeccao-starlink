-- 0013_seguranca.sql — Camada de segurança do painel administrativo.
-- ADITIVA e rollback-safe: só CREATE/ALTER (nunca apaga/altera dados existentes).
--
-- (1) RBAC — papel do usuário. 3 papéis: 'admin' | 'operador' | 'consulta'.
--     Default 'operador' = preserva o comportamento atual dos logins existentes
--     (criar/editar). Exclusão de empresa e gestão de usuários já eram só do admin.
--     O superadmin do env (APP_USER/bradel) é admin permanente e NÃO vive na tabela.
-- (2) Sessões revogáveis no D1 — habilita expiração por inatividade, logout global
--     e lista de sessões ativas. O cookie passa a carregar o id (aleatório) da sessão
--     + HMAC anti-forjação (em vez de um HMAC estático do login).
-- (3) Brute-force / credential stuffing — contador de tentativas de login por
--     (usuario|ip) com bloqueio temporário.
-- (4) IP na auditoria — rastreabilidade (requisito §5 do brief).

-- (1) RBAC -----------------------------------------------------------------
ALTER TABLE usuarios ADD COLUMN papel TEXT NOT NULL DEFAULT 'operador';

-- (2) Sessões --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessoes (
    id               TEXT PRIMARY KEY,   -- 256 bits aleatórios (hex)
    usuario          TEXT NOT NULL,      -- username (ou o admin do env)
    criado_em        TEXT NOT NULL,      -- "YYYY-MM-DD HH:MM:SS" (Brasília)
    ultima_atividade TEXT NOT NULL,      -- atualizada a cada requisição (throttled)
    expira_em        TEXT NOT NULL,      -- expiração absoluta (30 dias)
    ip               TEXT,
    user_agent       TEXT,
    revogada         INTEGER NOT NULL DEFAULT 0  -- 1 = encerrada (logout / revogação admin)
);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario);
CREATE INDEX IF NOT EXISTS idx_sessoes_exp     ON sessoes(expira_em);

-- (3) Brute-force ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_tentativas (
    chave          TEXT PRIMARY KEY,     -- "usuario|ip"
    tentativas     INTEGER NOT NULL DEFAULT 0,
    bloqueado_ate  TEXT,                 -- timestamp até quando está bloqueado (NULL = livre)
    atualizado_em  TEXT
);

-- (4) IP na auditoria ------------------------------------------------------
ALTER TABLE auditoria ADD COLUMN ip TEXT;
