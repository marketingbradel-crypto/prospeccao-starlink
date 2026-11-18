-- Backup automatico e autonomo: cada backup completo do banco (schema + todas as
-- linhas de todas as tabelas) vira UMA linha aqui, comprimido (gzip -> base64).
-- Decisao do usuario (2026-11-18): guardar no proprio D1 (ver nota de seguranca
-- no index.ts). O cron diario a meia-noite (BRT) insere com origem='auto'.
CREATE TABLE IF NOT EXISTS backups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em  TEXT,            -- "YYYY-MM-DD HH:MM:SS" em horario de Brasilia
  dia        TEXT,            -- "YYYY-MM-DD" (BRT)
  origem     TEXT,            -- 'auto' | 'manual' | 'pre-restauracao'
  usuario    TEXT,            -- quem disparou (manual); NULL no cron automatico
  status     TEXT,            -- 'ok' | 'erro'
  erro       TEXT,            -- mensagem quando status='erro'
  tabelas    INTEGER,         -- qtd de tabelas incluidas
  linhas     INTEGER,         -- qtd total de linhas copiadas
  bytes      INTEGER,         -- tamanho do conteudo comprimido (gzip)
  bytes_raw  INTEGER,         -- tamanho do JSON cru (antes do gzip)
  formato    TEXT,            -- 'json.gz.base64'
  conteudo   TEXT             -- snapshot {meta,schema,dados} em gzip -> base64
);
CREATE INDEX IF NOT EXISTS idx_backups_criado ON backups(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_backups_dia ON backups(dia);
