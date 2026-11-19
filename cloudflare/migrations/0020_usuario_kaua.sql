-- 0020_usuario_kaua.sql — Novo login "kaua" com ACESSO TOTAL.
--
-- Acesso total = papel 'admin' (RBAC completo: cria/edita/exclui + gerencia
-- usuarios e seguranca) + perm_gerencial=1 (aba Gerencial). O superadmin do env
-- (bradel) continua separado; este e um admin que vive na tabela.
--
-- 1o acesso: must_change=1 => o login aceita a SENHA PADRAO (APP_DEFAULT_PASSWORD)
-- e obriga a trocar no primeiro login. Enquanto pendente, hash/salt sao
-- placeholders e NUNCA sao conferidos (ver autenticar() no index.ts).
--
-- INSERT OR IGNORE: reaplicar a migration nao mexe se o kaua ja existir/ja trocou.

INSERT OR IGNORE INTO usuarios (username, senha_hash, salt, must_change, papel, perm_gerencial)
VALUES ('kaua', 'pendente', 'pendente', 1, 'admin', 1);
