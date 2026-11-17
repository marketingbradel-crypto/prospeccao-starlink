-- Campo dedicado "ID VSM": identificador do parceiro no VSM/Vivensis.
-- Antes ficava embutido em observacoes como "ID Parceiro VSM: N". Agora vira
-- coluna propria (somente leitura na ficha quando ja preenchida) e observacoes
-- volta a ser um campo livre, em branco.
ALTER TABLE empresas ADD COLUMN id_vsm TEXT;

-- Backfill: move o numero do marcador "ID Parceiro VSM: N" de observacoes para
-- id_vsm. Pega o texto apos o ":" e remove espacos. Quando o marcador vem sem
-- numero ("ID Parceiro VSM: "), id_vsm fica em branco (sera preenchido no futuro).
UPDATE empresas
SET id_vsm = TRIM(substr(observacoes, instr(observacoes, 'ID Parceiro VSM:') + length('ID Parceiro VSM:')))
WHERE TRIM(observacoes) LIKE 'ID Parceiro VSM:%'
  AND (id_vsm IS NULL OR id_vsm = '');

-- Observacoes volta a ficar em branco onde so continha o marcador do VSM.
UPDATE empresas
SET observacoes = ''
WHERE TRIM(observacoes) LIKE 'ID Parceiro VSM:%';
