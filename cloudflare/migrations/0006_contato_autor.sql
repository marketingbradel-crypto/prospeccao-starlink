-- Carimbo automatico de quem registrou cada contato (username da pessoa logada).
-- Preenchido pelo backend no POST do contato; nao editavel pela pessoa.
ALTER TABLE contatos ADD COLUMN criado_por TEXT;
