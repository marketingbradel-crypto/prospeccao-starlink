-- SPACE INTERNET: mantem ficha 11 (Parauapebas, com telefone); Baiao e Garrafao do Norte viram filiais; remove 27 e 956
INSERT INTO filiais (empresa_id, nome, cidade, uf) VALUES
  (11, 'Space Internet – Baião', 'Baião', 'PA'),
  (11, 'Space Internet – Garrafão do Norte', 'Garrafão do Norte', 'PA');
UPDATE empresas SET qtd_filiais=2, atualizado_em='2026-11-18 09:30:00' WHERE id=11;
DELETE FROM empresas WHERE id IN (27,956);
