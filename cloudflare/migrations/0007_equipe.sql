-- Pre-cadastro da equipe (acesso restrito). Cada um entra com a senha padrao
-- (APP_DEFAULT_PASSWORD) e e obrigado a definir a senha pessoal no 1o acesso.
--
-- must_change=1 => enquanto pendente, o login aceita a senha padrao e o hash/salt
-- abaixo NUNCA sao conferidos (sao placeholders). Quando a pessoa define a senha,
-- o sistema grava o hash PBKDF2 real e zera must_change.
--
-- INSERT OR IGNORE: reaplicar a migration nao mexe em quem ja trocou a senha.
-- O bradel NAO entra aqui (autentica pelo secret APP_PASSWORD).

INSERT OR IGNORE INTO usuarios (username, senha_hash, salt, must_change) VALUES
  ('mateus',     'pendente', 'pendente', 1),
  ('leandro',    'pendente', 'pendente', 1),
  ('sunamita',   'pendente', 'pendente', 1),
  ('ronaldo',    'pendente', 'pendente', 1),
  ('luiscarlos', 'pendente', 'pendente', 1),
  ('elionay',    'pendente', 'pendente', 1),
  ('alessandra', 'pendente', 'pendente', 1),
  ('jossy',      'pendente', 'pendente', 1),
  ('romulo',     'pendente', 'pendente', 1);
