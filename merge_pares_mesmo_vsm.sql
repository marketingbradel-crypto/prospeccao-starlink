-- Merge de 7 pares duplicados (MESMO id_vsm, gravado float vs int).
-- Chave: id (UNICO). survivor mantido; victim removido apos consolidar.
-- Aplicar: wrangler d1 execute prospeccao-starlink --remote --file=merge_pares_mesmo_vsm.sql
-- (D1 aplica o arquivo atomicamente; em falha, volta ao estado original)

-- id_vsm 3919: manter id=81 (REV-069, 'DIVINO EMPREENDIMENTOS') | remover id=934 (REV-811, origem VSM Vivensis)
UPDATE empresas SET pendencia_vsm='Sem pendência', id_vsm='3919', atualizado_em=datetime('now') WHERE id=81;
UPDATE contatos SET empresa_id=81 WHERE empresa_id=934;
UPDATE filiais  SET empresa_id=81 WHERE empresa_id=934;
DELETE FROM empresas WHERE id=934;

-- id_vsm 4530: manter id=229 (REV-161, 'CL ENXOVAIS E SERVICOS') | remover id=267 (REV-185, origem VSM Vivensis)
UPDATE empresas SET pendencia_vsm='Falta treinar', id_vsm='4530', atualizado_em=datetime('now') WHERE id=229;
UPDATE contatos SET empresa_id=229 WHERE empresa_id=267;
UPDATE filiais  SET empresa_id=229 WHERE empresa_id=267;
DELETE FROM empresas WHERE id=267;

-- id_vsm 4597: manter id=251 (REV-174, 'JOSUE LEITE') | remover id=448 (REV-325, origem VSM Vivensis)
UPDATE empresas SET microrregiao='Imperatriz', pendencia_vsm='Sem pendência', id_vsm='4597', atualizado_em=datetime('now') WHERE id=251;
UPDATE contatos SET empresa_id=251 WHERE empresa_id=448;
UPDATE filiais  SET empresa_id=251 WHERE empresa_id=448;
DELETE FROM empresas WHERE id=448;

-- id_vsm 4733: manter id=311 (REV-214, 'Souza eletrônicos') | remover id=874 (REV-751, origem VSM Vivensis)
UPDATE empresas SET microrregiao='Guaraí', pendencia_vsm='Sem pendência', id_vsm='4733', atualizado_em=datetime('now') WHERE id=311;
UPDATE contatos SET empresa_id=311 WHERE empresa_id=874;
UPDATE filiais  SET empresa_id=311 WHERE empresa_id=874;
DELETE FROM empresas WHERE id=874;

-- id_vsm 4775: manter id=14 (REV-014, 'FRANCO ANTENAS STARLINK | ') | remover id=781 (REV-658, origem VSM Vivensis)
UPDATE empresas SET pendencia_vsm='Sem pendência', id_vsm='4775', atualizado_em=datetime('now') WHERE id=14;
UPDATE contatos SET empresa_id=14 WHERE empresa_id=781;
UPDATE filiais  SET empresa_id=14 WHERE empresa_id=781;
DELETE FROM empresas WHERE id=781;

-- id_vsm 4790: manter id=254 (REV-176, 'Central sat') | remover id=542 (REV-419, origem VSM Vivensis)
UPDATE empresas SET microrregiao='Itapecuru Mirim', pendencia_vsm='Sem pendência', id_vsm='4790', atualizado_em=datetime('now') WHERE id=254;
UPDATE contatos SET empresa_id=254 WHERE empresa_id=542;
UPDATE filiais  SET empresa_id=254 WHERE empresa_id=542;
DELETE FROM empresas WHERE id=542;

-- id_vsm 4941: manter id=383 (REV-263, 'JOTERPI') | remover id=949 (REV-826, origem VSM Vivensis)
UPDATE empresas SET pendencia_vsm='Falta treinar e assinar contrato', id_vsm='4941', atualizado_em=datetime('now') WHERE id=383;
UPDATE contatos SET empresa_id=383 WHERE empresa_id=949;
UPDATE filiais  SET empresa_id=383 WHERE empresa_id=949;
DELETE FROM empresas WHERE id=949;