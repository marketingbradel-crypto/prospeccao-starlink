-- Fichas ativas com CNAE gravado no campo CNPJ (deslocamento do form 2 blocos).
-- CNPJ correto confirmado pela gemea VSM / formulario consolidado. Chave: id.
UPDATE empresas SET cnpj='35.954.055/0001-15', cnpj_norm='35954055000115', atualizado_em=datetime('now') WHERE id=73;  -- MATHEUS MONTEIRO (era 00.000.006/1906-99)
UPDATE empresas SET cnpj='33.083.325/0001-34', cnpj_norm='33083325000134', atualizado_em=datetime('now') WHERE id=100; -- Lucio antenas (era 00.000.000/0000-33)
