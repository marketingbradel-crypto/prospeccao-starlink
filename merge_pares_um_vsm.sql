-- Merge de 7 pares credenciamento x VSM (SO UM lado tem id_vsm; sem conflito).
-- Chave: id (UNICO). survivor=Formulario mantido; victim=VSM removido apos consolidar.
-- Aplicar: wrangler d1 execute prospeccao-starlink --remote --file=merge_pares_um_vsm.sql
-- (D1 aplica o arquivo atomicamente; em falha, volta ao estado original)

-- id_vsm 4281: manter id=56 (REV-054, 'Segur_ar') | remover id=48 (REV-048, origem VSM Vivensis)
UPDATE empresas SET resp_cargo='Proprietário(a)', interesse_parceiro='Muito alto', pendencia_vsm='Sem pendência', pendencia_cadastro='Pronto', id_vsm='4281', atualizado_em=datetime('now') WHERE id=56;
UPDATE contatos SET empresa_id=56 WHERE empresa_id=48;
UPDATE filiais  SET empresa_id=56 WHERE empresa_id=48;
DELETE FROM empresas WHERE id=48;

-- id_vsm 4296: manter id=95 (REV-078, 'Vit Sat') | remover id=253 (REV-176, origem VSM Vivensis)
UPDATE empresas SET inscricao_estadual='Isento', resp_nome='Vitória de Castro Ferreira Neves', resp_cargo='Venda e instalação', interesse_parceiro='Alto', pendencia_vsm='Sem pendência', pendencia_cadastro='Pronto', id_vsm='4296', atualizado_em=datetime('now') WHERE id=95;
UPDATE contatos SET empresa_id=95 WHERE empresa_id=253;
UPDATE filiais  SET empresa_id=95 WHERE empresa_id=253;
DELETE FROM empresas WHERE id=253;

-- id_vsm 4570: manter id=257 (REV-178, 'ATX TECH') | remover id=55 (REV-053, origem VSM Vivensis)
UPDATE empresas SET inscricao_estadual='ISENTO', resp_nome='NABIA AURORA DA SILVA LIMA', resp_cargo='Técnico de Informática', interesse_parceiro='Muito alto', pendencia_vsm='Sem pendência', pendencia_cadastro='Pronto', id_vsm='4570', atualizado_em=datetime('now') WHERE id=257;
UPDATE contatos SET empresa_id=257 WHERE empresa_id=55;
UPDATE filiais  SET empresa_id=257 WHERE empresa_id=55;
DELETE FROM empresas WHERE id=55;

-- id_vsm 4596: manter id=260 (REV-180, 'RHDTV SAT') | remover id=121 (REV-095, origem VSM Vivensis)
UPDATE empresas SET inscricao_estadual='Isento', resp_nome='RIVAS Roberto', resp_cargo='Proprietário', interesse_parceiro='Muito alto', pendencia_vsm='Falta treinar e assinar contrato', pendencia_cadastro='Pronto', id_vsm='4596', atualizado_em=datetime('now') WHERE id=260;
UPDATE contatos SET empresa_id=260 WHERE empresa_id=121;
UPDATE filiais  SET empresa_id=260 WHERE empresa_id=121;
DELETE FROM empresas WHERE id=121;

-- id_vsm 4617: manter id=270 (REV-187, 'Portal eletrônico seguranç') | remover id=159 (REV-119, origem VSM Vivensis)
UPDATE empresas SET microrregiao='Goiânia', resp_nome='Eduardo Costa barbosa', resp_cargo='Proprietário', interesse_parceiro='Muito alto', pendencia_vsm='Sem pendência', pendencia_cadastro='Pronto', id_vsm='4617', atualizado_em=datetime('now') WHERE id=270;
UPDATE contatos SET empresa_id=270 WHERE empresa_id=159;
UPDATE filiais  SET empresa_id=270 WHERE empresa_id=159;
DELETE FROM empresas WHERE id=159;

-- id_vsm 4616: manter id=276 (REV-191, 'Eletrônica Souza') | remover id=206 (REV-151, origem VSM Vivensis)
UPDATE empresas SET microrregiao='Inhumas–Itaberaí–Anicuns', resp_nome='Célio Cícero Pereira de Souza', resp_cargo='Técnico proprietário', interesse_parceiro='Muito alto', pendencia_vsm='Sem pendência', pendencia_cadastro='Pronto', id_vsm='4616', atualizado_em=datetime('now') WHERE id=276;
UPDATE contatos SET empresa_id=276 WHERE empresa_id=206;
UPDATE filiais  SET empresa_id=276 WHERE empresa_id=206;
DELETE FROM empresas WHERE id=206;

-- id_vsm 4659: manter id=288 (REV-198, 'Supermercado Brasil') | remover id=211 (REV-149, origem VSM Vivensis)
UPDATE empresas SET resp_nome='Wesley Marcos de Souza', resp_cargo='Proprietário', interesse_parceiro='Muito alto', pendencia_vsm='Falta treinar', pendencia_cadastro='Pronto', id_vsm='4659', atualizado_em=datetime('now') WHERE id=288;
UPDATE contatos SET empresa_id=288 WHERE empresa_id=211;
UPDATE filiais  SET empresa_id=288 WHERE empresa_id=211;
DELETE FROM empresas WHERE id=211;
