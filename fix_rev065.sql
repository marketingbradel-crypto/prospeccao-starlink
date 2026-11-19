-- REV-065 Lucas Miranda Tavares: ficha ativa id=75 (Inbound, "Pronto para venda")
-- tinha o CNAE 3210-00 no campo CNPJ. Merge da gemea VSM id=841 (mesmo telefone,
-- id_vsm 4373) que traz o CNPJ correto 41.245.816/0001-62 + IE. Chave: id.
-- NAO tocar id=76 (LUCIANO CAVALCANTE, outra empresa que divide o codigo REV-065).
UPDATE empresas SET cnpj='41.245.816/0001-62', cnpj_norm='41245816000162', inscricao_estadual='Isento', id_vsm='4373', atualizado_em=datetime('now') WHERE id=75;
UPDATE contatos SET empresa_id=75 WHERE empresa_id=841;
UPDATE filiais  SET empresa_id=75 WHERE empresa_id=841;
DELETE FROM empresas WHERE id=841;
