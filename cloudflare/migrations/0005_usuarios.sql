-- Logins da equipe. O bradel NAO fica aqui: continua autenticando pelo secret
-- APP_PASSWORD (admin). Os demais usuarios entram no primeiro acesso com a senha
-- padrao (APP_DEFAULT_PASSWORD) e sao obrigados a trocar; a partir dai a linha
-- abaixo guarda o hash PBKDF2 da senha pessoal.
--
-- Reset de senha de um usuario (admin): apagar a linha dele. Ele volta a entrar
-- com a senha padrao e troca de novo.
--   DELETE FROM usuarios WHERE username='mateus';

CREATE TABLE IF NOT EXISTS usuarios (
    username      TEXT PRIMARY KEY,   -- minusculo, sem acento/espaco (ex: luiscarlos)
    senha_hash    TEXT NOT NULL,      -- PBKDF2-SHA256, hex
    salt          TEXT NOT NULL,      -- hex
    must_change   INTEGER NOT NULL DEFAULT 0,
    criado_em     TEXT DEFAULT (datetime('now')),
    atualizado_em TEXT
);
