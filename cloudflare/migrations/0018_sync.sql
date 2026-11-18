-- 0018_sync.sql
-- Sincronizacao automatica com a pasta de rede (U:\Matriz\Back office\Dep).
-- Historico de execucoes do agente local (ver agente-sync/). Uma linha por
-- execucao (ter/sex 12:00 BRT ou manual). O Worker na nuvem NAO le a pasta; um
-- agente local empurra o arquivo-mestre para /api/sync/ingest.
--
-- Nota: index.ts cria esta tabela sob demanda (ensureSyncRuns, CREATE TABLE IF
-- NOT EXISTS) no mesmo padrao de pesquisas/varredura_pendentes — funciona mesmo
-- se esta migration ainda nao tiver sido aplicada no remoto. Esta migration
-- apenas versiona o schema oficial.
--
-- Marcadores do ultimo sync ficam na tabela `meta` (0001): sync_last_run,
-- sync_last_status, sync_last_stats (JSON) e sync_master_hash (SHA-256 do ultimo
-- arquivo-mestre ja importado — usado para NAO reprocessar arquivo identico).

CREATE TABLE IF NOT EXISTS sync_runs (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    executado_em         TEXT,                 -- "YYYY-MM-DD HH:MM:SS" (Brasilia)
    origem               TEXT,                 -- 'agendado' | 'manual'
    arquivos_encontrados INTEGER DEFAULT 0,
    novos                INTEGER DEFAULT 0,
    modificados          INTEGER DEFAULT 0,
    removidos            INTEGER DEFAULT 0,
    inalterados          INTEGER DEFAULT 0,
    master_mudou         INTEGER DEFAULT 0,    -- 0/1: o arquivo-mestre mudou nesta execucao
    import_criados       INTEGER DEFAULT 0,
    import_atualizados   INTEGER DEFAULT 0,
    import_mesclados     INTEGER DEFAULT 0,
    import_ignorados     INTEGER DEFAULT 0,
    status               TEXT,                 -- 'ok' | 'sem_alteracao' | 'falha'
    mensagem             TEXT,
    detalhe              TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_executado ON sync_runs (executado_em DESC);
