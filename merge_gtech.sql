-- G TECH: move contato 218->691, preenche vazios na 691, remove 218
UPDATE contatos SET empresa_id=691 WHERE empresa_id=218;
UPDATE empresas SET "cnpj"='54.124.907/0001-91', "whatsapp"='93-99193-3683', "email_comercial"='KAINAN.FERNANDES@GMAIL.COM', "endereco"='RUA QUARTA- ITAITUBA, S/N', "cep"='68192200', "observacoes"='Proprietário: KAINÃ FERNANDES DA SILVA DUTRA · Contato: PROPRIETÁRIO · Interesse (form): Muito alto · Prazo p/ iniciar: Imediato', "data_ultimo_contato"='2026-11-17', "proxima_acao"='CONFIRMAR SE CONSEGUIU FAZER VENDAS COM OS KITS A PRONTA ENTREGA.', "proxima_acao_data"='2026-11-27', "cnpj_norm"='54124907000191', "atualizado_em"='2026-11-18 09:09:23' WHERE id=691;
DELETE FROM empresas WHERE id=218;
