-- Regra geral de responsavel por territorio (equipe de prospeccao).
-- Preenche quem esta SEM responsavel; NAO sobrescreve atribuicao manual existente.
-- As excecoes por microrregiao tem prioridade sobre o padrao por UF, por isso
-- rodam primeiro (enquanto o registro ainda esta em branco).
-- Espelha listas.ts::responsavelPara — manter os dois em sincronia.
--
-- Padrao por UF:  PA->Luis Carlos | MA->Ronaldo | TO->Mateus | GO->Leandro
-- Excecoes:
--   Tucurui, Parauapebas, Maraba, Paragominas          -> Leandro
--   Redencao, Tucuma-Sao Felix do Xingu, Xinguara      -> Mateus
--   Araguaina, Tocantinopolis, Araguatins              -> Ronaldo

-- 1) Excecoes por microrregiao (so registros ainda em branco)
UPDATE empresas SET responsavel='Leandro'
 WHERE TRIM(COALESCE(responsavel,''))=''
   AND microrregiao IN ('Tucuruí','Parauapebas','Marabá','Paragominas');

UPDATE empresas SET responsavel='Mateus'
 WHERE TRIM(COALESCE(responsavel,''))=''
   AND (microrregiao IN ('Redenção','Xinguara') OR microrregiao LIKE 'Tucumã%');

UPDATE empresas SET responsavel='Ronaldo'
 WHERE TRIM(COALESCE(responsavel,''))=''
   AND microrregiao IN ('Araguaína','Araguatins','Tocantinópolis');

-- 2) Padrao por UF para o restante em branco
UPDATE empresas SET responsavel='Luis Carlos'
 WHERE TRIM(COALESCE(responsavel,''))='' AND uf='PA';

UPDATE empresas SET responsavel='Ronaldo'
 WHERE TRIM(COALESCE(responsavel,''))='' AND uf='MA';

UPDATE empresas SET responsavel='Mateus'
 WHERE TRIM(COALESCE(responsavel,''))='' AND uf='TO';

UPDATE empresas SET responsavel='Leandro'
 WHERE TRIM(COALESCE(responsavel,''))='' AND uf='GO';
