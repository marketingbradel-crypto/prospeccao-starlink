-- Flag de PENDENCIA CADASTRAL do parceiro, lida da planilha-mestre do formulario
-- ("Cadastros Starlink - consolidado Oficial.xlsx"), coluna BC "Situacao do
-- cadastro (auto)". SOMENTE LEITURA: alimentada pela sincronizacao/import a partir
-- da coluna BC e atualizada a cada sync (autoridade da planilha). Fica FORA de
-- EMPRESA_CAMPOS (nao editavel na ficha).
--
-- IMPORTANTE: e INDEPENDENTE da ORIGEM do contato (origem_contato = de onde o
-- parceiro veio: VSM / Formulario / Indicacao...). Um parceiro de origem
-- Formulario pode ter pendencia "Cadastro VSM"; um de origem VSM NAO recebe
-- automaticamente essa pendencia. Tambem e distinta de pendencia_vsm (treino/
-- contrato da aba Capilaridade-vsm).
--   pendencia_cadastro     = flag classificada: Chave PIX / Inapto CNAE /
--                            Cadastro VSM / Pronto / Nao cadastrado ainda / Outro
--   pendencia_cadastro_obs = texto original da coluna BC, preservado para
--                            conferencia (sobretudo quando cai em "Outro")
ALTER TABLE empresas ADD COLUMN pendencia_cadastro TEXT;
ALTER TABLE empresas ADD COLUMN pendencia_cadastro_obs TEXT;
