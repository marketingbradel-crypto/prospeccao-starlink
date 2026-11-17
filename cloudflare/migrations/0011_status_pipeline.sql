-- Novo pipeline de status comercial (substitui os 9 status antigos).
-- Mapa de conversao dos registros existentes (decisao de produto 2026-11-17):
--   Prospectado                 -> Aguardando contato
--   Primeiro contato realizado  -> Em atendimento
--   Em negociacao               -> Em atendimento
--   Interessado                 -> Em atendimento
--   Aguardando documentacao     -> Preencher o VSM
--   Documentacao recebida       -> Preencher o VSM
--   Credenciado                 -> Parceiro
--   Nao interessado / Sem retorno -> mantem
--
-- OBS: a CONVERSAO nas metricas agora e "Pronto para venda". Os antigos
-- "Credenciado" viram "Parceiro" e, portanto, NAO contam mais como convertidos.
-- Se quiser que eles contem como convertidos, troque o destino abaixo para
-- 'Pronto para venda'.
UPDATE empresas SET status = 'Aguardando contato' WHERE status = 'Prospectado';
UPDATE empresas SET status = 'Em atendimento'     WHERE status IN ('Primeiro contato realizado', 'Em negociação', 'Interessado');
UPDATE empresas SET status = 'Preencher o VSM'    WHERE status IN ('Aguardando documentação', 'Documentação recebida');
UPDATE empresas SET status = 'Parceiro'           WHERE status = 'Credenciado';

-- Rede de seguranca: qualquer status vazio/nulo (ou fora da nova lista) volta ao inicio do funil.
UPDATE empresas
SET status = 'Aguardando contato'
WHERE status IS NULL
   OR TRIM(status) = ''
   OR status NOT IN (
     'Aguardando contato', 'Em atendimento', 'Preencher o VSM', 'Em treinamento',
     'Parceiro', 'Contrato assinado', 'Pronto para venda', 'Não interessado', 'Sem retorno'
   );
