-- Campo "Possui estoque" na ficha do lojista (caixa de marcar Sim/Nao).
-- Armazenado como 0/1, igual aos demais booleanos (loja_fisica, equipe_tecnica, ...).
ALTER TABLE empresas ADD COLUMN possui_estoque INTEGER DEFAULT 0;
