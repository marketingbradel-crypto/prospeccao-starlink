-- Correcao de fichas com campos de identidade deslocados (form 2 blocos).
-- Base: snapshot _prod_empresas.json (regenerar antes de aplicar). Chave: id (UNICO; codigo NAO e unico - 67 grupos duplicados!).
-- Aplicar: wrangler d1 execute <DB> --remote --file=correcoes_fichas.sql
-- (D1 aplica o arquivo atomicamente; em falha, volta ao estado original)
-- Total de UPDATEs: 57

-- id=666 (REV-543): nome_fantasia, cnpj  [de: fant='LUIS G DA PAIXAO' cnpj=00.000.007/4901-04]  ()
UPDATE empresas SET nome_fantasia='GUILHERME INFORMATICA', cnpj='47.516.438/0001-90', cnpj_norm='47516438000190', atualizado_em=datetime('now') WHERE id=666;

-- id=33 (REV-033): razao_social, nome_fantasia  [de: fant='ARYANE ARANTES ABADIA PONTES 0' cnpj=46.292.829/0001-06]  ()
UPDATE empresas SET razao_social='ARYANE ARANTES ABADIA PONTES', nome_fantasia='Genjoy', atualizado_em=datetime('now') WHERE id=33;

-- id=782 (REV-659): nome_fantasia  [de: fant='40.977.726 WHANDSON CALDAS TEN' cnpj=40.977.726/0001-01]  ()
UPDATE empresas SET nome_fantasia='T A SERVIÇOS', atualizado_em=datetime('now') WHERE id=782;

-- id=703 (REV-580): nome_fantasia, cnpj  [de: fant='68.599.589 ROSILENE BARBOSA MI' cnpj=00.000.004/3215-00]  ()
UPDATE empresas SET nome_fantasia='TVRM', cnpj='68.599.589/0001-20', cnpj_norm='68599589000120', atualizado_em=datetime('now') WHERE id=703;

-- id=557 (REV-434): nome_fantasia  [de: fant='63.982.457 EVA MARIA JORGE DE ' cnpj=63.982.457/0001-69]  ()
UPDATE empresas SET nome_fantasia='NET SERVIÇOS', atualizado_em=datetime('now') WHERE id=557;

-- id=554 (REV-431): nome_fantasia  [de: fant='58.623.837 EDSON LIMA OLIVEIRA' cnpj=58.623.837/0001-77]  ()
UPDATE empresas SET nome_fantasia='STARLINK AFUA', atualizado_em=datetime('now') WHERE id=554;

-- id=572 (REV-449): nome_fantasia  [de: fant='FERNANDO M BELO LTDA' cnpj=45.763.591/0001-97]  ()
UPDATE empresas SET nome_fantasia='XINGU SOLAR', atualizado_em=datetime('now') WHERE id=572;

-- id=631 (REV-508): nome_fantasia  [de: fant='MULT PATH TELECOM LTDA' cnpj=37.705.174/0001-60]  ()
UPDATE empresas SET nome_fantasia='FENIX CELL', atualizado_em=datetime('now') WHERE id=631;

-- id=633 (REV-510): nome_fantasia  [de: fant='54.528.771 ADELSON GABRIEL SIL' cnpj=54.528.771/0001-85]  ()
UPDATE empresas SET nome_fantasia='MICROTEK', atualizado_em=datetime('now') WHERE id=633;

-- id=653 (REV-530): nome_fantasia  [de: fant='MEGATEC INFORMATICA E SEGURANC' cnpj=46.639.870/0001-06]  ()
UPDATE empresas SET nome_fantasia='LOJA MEGATEC', atualizado_em=datetime('now') WHERE id=653;

-- id=133 (REV-103): inscricao_estadual  [de: fant='Jr sat' cnpj=44.655.986/0001-03]  (ambiguo(2) resolvido por nome (score 1.00))
UPDATE empresas SET inscricao_estadual='Não tenho ainda', atualizado_em=datetime('now') WHERE id=133;

-- id=145 (REV-111): inscricao_estadual  [de: fant='Net Fibra' cnpj=49.784.305/0001-20]  ()
UPDATE empresas SET inscricao_estadual='Isento', atualizado_em=datetime('now') WHERE id=145;

-- id=785 (REV-662): nome_fantasia  [de: fant='58.982.154 RAPHAEL FERREIRA DO' cnpj=58.982.154/0001-06]  ()
UPDATE empresas SET nome_fantasia='R P LINK', atualizado_em=datetime('now') WHERE id=785;

-- id=151 (REV-114): razao_social, nome_fantasia  [de: fant='Marcos Macedo' cnpj=68.917.128/0001-58]  ()
UPDATE empresas SET razao_social='68.917.128 MARCOS MACEDO ARAUJO', nome_fantasia='68.917.128 MARCOS MACEDO ARAUJO', atualizado_em=datetime('now') WHERE id=151;

-- id=939 (REV-816): nome_fantasia  [de: fant='ROSCLEI OLIVEIRA DA PURIFICACA' cnpj=34.557.996/0001-52]  ()
UPDATE empresas SET nome_fantasia='Asterix Representação e Comercio', atualizado_em=datetime('now') WHERE id=939;

-- id=165 (REV-124): inscricao_estadual  [de: fant='CHAPADA ELÉTRICA' cnpj=68.754.496/0001-22]  (ambiguo(2) resolvido por nome (score 1.00))
UPDATE empresas SET inscricao_estadual='ISENTO', atualizado_em=datetime('now') WHERE id=165;

-- id=656 (REV-533): nome_fantasia  [de: fant='40.149.612 VAGNER SOUZA DA SIL' cnpj=40.149.612/0001-65]  ()
UPDATE empresas SET nome_fantasia='VAPTECH', atualizado_em=datetime('now') WHERE id=656;

-- id=614 (REV-491): nome_fantasia  [de: fant='68.698.965 EWELLEN JULE LIMA D' cnpj=68.698.965/0001-33]  ()
UPDATE empresas SET nome_fantasia='EB ELÉTRICA', atualizado_em=datetime('now') WHERE id=614;

-- id=607 (REV-484): nome_fantasia  [de: fant='25.326.445 MARCUS AFONSO SANTO' cnpj=25.326.445/0001-97]  ()
UPDATE empresas SET nome_fantasia='MJ TECNOLOGIA', atualizado_em=datetime('now') WHERE id=607;

-- id=583 (REV-460): nome_fantasia  [de: fant='40.125.237 TIAGO GOMES DA SILV' cnpj=40.125.237/0001-13]  ()
UPDATE empresas SET nome_fantasia='T. G SMART HOME', atualizado_em=datetime('now') WHERE id=583;

-- id=616 (REV-493): nome_fantasia  [de: fant='EDSON RODRIGO BEZERRA SOUSA 84' cnpj=35.732.473/0001-68]  ()
UPDATE empresas SET nome_fantasia='BRAND T.I', atualizado_em=datetime('now') WHERE id=616;

-- id=951 (REV-828): nome_fantasia  [de: fant='VCNETOWORK SOLUCOES TECNOLOGIC' cnpj=42.625.364/0001-07]  ()
UPDATE empresas SET nome_fantasia='VCNETWORK SOLUCOES TECNOLOGICAS', atualizado_em=datetime('now') WHERE id=951;

-- id=705 (REV-582): nome_fantasia  [de: fant='44.789.145 RAIMUNDO RICARDO AV' cnpj=44.789.145/0001-99]  ()
UPDATE empresas SET nome_fantasia='AVIZTEC', atualizado_em=datetime('now') WHERE id=705;

-- id=686 (REV-563): nome_fantasia  [de: fant='36.301.295 BENIVALDO DO SOCORR' cnpj=36.301.295/0001-83]  ()
UPDATE empresas SET nome_fantasia='BENNY ELETRONICA', atualizado_em=datetime('now') WHERE id=686;

-- id=612 (REV-489): nome_fantasia  [de: fant='66.071.989 EDSON RIBEIRO DE ME' cnpj=66.071.989/0001-32]  ()
UPDATE empresas SET nome_fantasia='EDSON RIBEIRO DE MELO', atualizado_em=datetime('now') WHERE id=612;

-- id=602 (REV-479): nome_fantasia  [de: fant='67.806.790 ANDEL JUNIOR DOS RE' cnpj=67.806.790/0001-78]  ()
UPDATE empresas SET nome_fantasia='ANDEL JR', atualizado_em=datetime('now') WHERE id=602;

-- id=806 (REV-683): nome_fantasia  [de: fant='68.918.767 ALAN CONCEICAO MACE' cnpj=68.918.767/0001-38]  ()
UPDATE empresas SET nome_fantasia='ALAN MACEDO', atualizado_em=datetime('now') WHERE id=806;

-- id=151 (REV-114): inscricao_estadual  [de: fant='Marcos Macedo' cnpj=68.917.128/0001-58]  ()
UPDATE empresas SET inscricao_estadual='Nao', atualizado_em=datetime('now') WHERE id=151;

-- id=691 (REV-568): nome_fantasia  [de: fant='G TECH SOLUTIONS SERVICOS LTDA' cnpj=54.124.907/0001-91]  ()
UPDATE empresas SET nome_fantasia='G TECH', atualizado_em=datetime('now') WHERE id=691;

-- id=229 (REV-161): nome_fantasia  [de: fant='CL ENXOVAIS E SERVICOS' cnpj=29.899.163/0001-30]  ()
UPDATE empresas SET nome_fantasia='CL VARIEDADES', atualizado_em=datetime('now') WHERE id=229;

-- id=804 (REV-681): nome_fantasia  [de: fant='NORTEVIA TECNOLOGIA LTDA' cnpj=50.816.345/0001-96]  (ambiguo(2) resolvido por nome (score 1.00))
UPDATE empresas SET nome_fantasia='HOMEVIGIL', atualizado_em=datetime('now') WHERE id=804;

-- id=585 (REV-462): nome_fantasia  [de: fant='59.921.027 PAULO HENRIQUE MARQ' cnpj=59.921.027/0001-60]  ()
UPDATE empresas SET nome_fantasia='MARQUES & SOUSA REPRESENTAÇÕES', atualizado_em=datetime('now') WHERE id=585;

-- id=759 (REV-636): nome_fantasia  [de: fant='ANTONIO CARLOS DA COSTA LIMA 6' cnpj=17.994.868/0001-57]  ()
UPDATE empresas SET nome_fantasia='CARLOS ANTENAS', atualizado_em=datetime('now') WHERE id=759;

-- id=832 (REV-709): nome_fantasia  [de: fant='59.272.475 RADFI ADORNO COELHO' cnpj=59.272.475/0001-80]  ()
UPDATE empresas SET nome_fantasia='RR TECNOLOGIA', atualizado_em=datetime('now') WHERE id=832;

-- id=223 (REV-157): nome_fantasia  [de: fant='33.271.286 INGRID ARANTES MATI' cnpj=33.271.286/0001-07]  ()
UPDATE empresas SET nome_fantasia='**********', atualizado_em=datetime('now') WHERE id=223;

-- id=715 (REV-592): nome_fantasia  [de: fant='55.798.150 JOSE SAMPAIO DA CUN' cnpj=55.798.150/0001-84]  ()
UPDATE empresas SET nome_fantasia='JS SAT', atualizado_em=datetime('now') WHERE id=715;

-- id=351 (REV-242): nome_fantasia  [de: fant='V TAVARES NETO COMERCIO DISTRI' cnpj=12.008.300/0001-04]  ()
UPDATE empresas SET nome_fantasia='VANCLEI ANTENAS', atualizado_em=datetime('now') WHERE id=351;

-- id=639 (REV-516): nome_fantasia  [de: fant='ADENILSON BATISTA DE SOUZA 016' cnpj=40.748.065/0001-34]  ()
UPDATE empresas SET nome_fantasia='JUNIOR BATISTA TECNOLOGIA', atualizado_em=datetime('now') WHERE id=639;

-- id=580 (REV-457): nome_fantasia  [de: fant='69.556.944 LEANDRO VILHENA FRA' cnpj=69.556.944/0001-46]  ()
UPDATE empresas SET nome_fantasia='CLICK DIGITAL', atualizado_em=datetime('now') WHERE id=580;

-- id=499 (REV-376): nome_fantasia  [de: fant='55.644.374 MELQUEZEDEQUE DA SI' cnpj=55.644.374/0001-31]  ()
UPDATE empresas SET nome_fantasia='LIVE SERVIÇOS TELECOM', atualizado_em=datetime('now') WHERE id=499;

-- id=43 (REV-043): nome_fantasia  [de: fant='58.976.727 FABIO LUIZ ALVES ME' cnpj=58.976.727/0001-99]  ()
UPDATE empresas SET nome_fantasia='Entangle Systems', atualizado_em=datetime('now') WHERE id=43;

-- id=676 (REV-553): nome_fantasia  [de: fant='63.995.574 CREZIO ALVES DE SOU' cnpj=63.995.574/0001-67]  ()
UPDATE empresas SET nome_fantasia='14 BLACK', atualizado_em=datetime('now') WHERE id=676;

-- id=887 (REV-764): nome_fantasia  [de: fant='SIDNEY MALVEZZI JUNIOR 0399836' cnpj=12.674.135/0001-11]  ()
UPDATE empresas SET nome_fantasia='Consultório do Notebook', atualizado_em=datetime('now') WHERE id=887;

-- id=649 (REV-526): nome_fantasia  [de: fant='M C BARROS' cnpj=27.127.652/0001-48]  ()
UPDATE empresas SET nome_fantasia='MIX MONITORAMENTO', atualizado_em=datetime('now') WHERE id=649;

-- id=311 (REV-214): razao_social, nome_fantasia  [de: fant='Souza eletrônicos' cnpj=62.745.156/0001-59]  ()
UPDATE empresas SET razao_social='Souzaeletronicos', nome_fantasia='Souzaeletronicos', atualizado_em=datetime('now') WHERE id=311;

-- id=14 (REV-014): razao_social, nome_fantasia  [de: fant='FRANCO ANTENAS STARLINK | aces' cnpj=33850335000158]  ()
UPDATE empresas SET razao_social='33.850.335 WENDEL JEAN DE CASTRO FRANCO', nome_fantasia='FRANCO ANTENAS', atualizado_em=datetime('now') WHERE id=14;

-- id=618 (REV-495): nome_fantasia  [de: fant='JOAO BATISTA DE ALMEIDA PAREDE' cnpj=60.326.447/0001-87]  ()
UPDATE empresas SET nome_fantasia='ISRAEL TELECOM', atualizado_em=datetime('now') WHERE id=618;

-- id=38 (REV-038): nome_fantasia  [de: fant='DIEGO MARADONNA VIEIRA' cnpj=32.226.526/0001-80]  ()
UPDATE empresas SET nome_fantasia='PROTECH seguranca eletrônica', atualizado_em=datetime('now') WHERE id=38;

-- id=215 (REV-151): nome_fantasia  [de: fant='22.719.658 HAMILTON LUCINDO DA' cnpj=22.719.658/0001-90]  ()
UPDATE empresas SET nome_fantasia='Coldclimate', atualizado_em=datetime('now') WHERE id=215;

-- id=712 (REV-589): nome_fantasia  [de: fant='69.802.258 ALEX GONCALO DA COS' cnpj=69.802.258/0001-08]  ()
UPDATE empresas SET nome_fantasia='BELA TELECOM', atualizado_em=datetime('now') WHERE id=712;

-- id=755 (REV-632): nome_fantasia  [de: fant='64.467.760 WELLYSON DOS SANTOS' cnpj=64.467.760/0001-96]  ()
UPDATE empresas SET nome_fantasia='SOLCELL', atualizado_em=datetime('now') WHERE id=755;

-- id=356 (REV-245): inscricao_estadual  [de: fant='Eletronica sousa' cnpj=22.767.496/0001-66]  (ambiguo(2) resolvido por nome (score 1.00))
UPDATE empresas SET inscricao_estadual='Isento', atualizado_em=datetime('now') WHERE id=356;

-- id=176 (REV-132): nome_fantasia  [de: fant='EMBAIXADA TEGG GOIAS LTDA' cnpj=31.165.903/0001-56]  ()
UPDATE empresas SET nome_fantasia='TeggPhone', atualizado_em=datetime('now') WHERE id=176;

-- id=815 (REV-692): nome_fantasia  [de: fant='69.651.446 VANILDES GOMES CONS' cnpj=69.651.446/0001-82]  ()
UPDATE empresas SET nome_fantasia='VG SERVIÇOS', atualizado_em=datetime('now') WHERE id=815;

-- id=681 (REV-558): nome_fantasia  [de: fant='69.570.233 IRIS REGINA DE SOUZ' cnpj=69.570.233/0001-26]  ()
UPDATE empresas SET nome_fantasia='AGORA SERVIÇOS E INSTALAÇÕES', atualizado_em=datetime('now') WHERE id=681;

-- id=229 (REV-161): inscricao_estadual  [de: fant='CL ENXOVAIS E SERVICOS' cnpj=29.899.163/0001-30]  ()
UPDATE empresas SET inscricao_estadual='10.721.277-3', atualizado_em=datetime('now') WHERE id=229;

-- id=361 (REV-249): inscricao_estadual  [de: fant='L E DIGITAL' cnpj=34.580.835/0001-80]  ()
UPDATE empresas SET inscricao_estadual='Insento', atualizado_em=datetime('now') WHERE id=361;

