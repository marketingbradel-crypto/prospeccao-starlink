# -*- coding: utf-8 -*-
"""Consolida o export do Google Forms (duas secoes/blocos de colunas) numa
planilha de bloco unico, com os campos da ficha mapeados CORRETAMENTE por
cabecalho da linha 1. Saida com os titulos que o /api/import reconhece.

Regra central (coalescencia por LINHA, sem misturar blocos):
  - Se a linha preencheu o Bloco 2 (Razao/Nome Fantasia/CNPJ/IE "2"),
    a identidade inteira vem do Bloco 2.
  - Senao, vem do Bloco 1.
  Isso evita reintroduzir o deslocamento visto no Bloco 1 das respostas de
  "Venda e Instalacao" (onde a coluna 'Nome Fantasia' contem CNPJ e a 'CNPJ'
  contem CNAE).
"""
import re
import openpyxl
from openpyxl.utils import column_index_from_string as CI

SRC = r"c:\Users\luisa.jansen\Downloads\Pasta VS Code\prospeccao-regional-starlink\Cadastro e Credenciamento – Parceiros Starlink (Venda + Instalação) (respostas).xlsx"
OUT = r"c:\Users\luisa.jansen\Downloads\Pasta VS Code\prospeccao-regional-starlink\import_credenciamento_CORRIGIDO.xlsx"

# ---------- helpers de valor ----------
def as_text(v):
    """Numero inteiro vira string sem '.0'; preserva texto."""
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()

def cnpj_fmt(v):
    """So digitos; zfill p/ recuperar zero a esquerda perdido quando veio como numero.
    Formata 14 digitos como ##.###.###/####-##. Fora disso, devolve ''."""
    d = re.sub(r"\D", "", as_text(v))
    if 12 <= len(d) <= 14:
        d = d.zfill(14)
    if len(d) != 14:
        return ""
    return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"

def simnao(v):
    t = as_text(v).strip().lower()
    if not t:
        return ""
    if t.startswith(("sim", "s ", "s,")) or t == "s":
        return "Sim"
    if t.startswith(("nao", "não", "n ", "n,")) or t == "n":
        return "Não"
    return as_text(v)  # resposta livre: preserva original

# ---------- leitura ----------
wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
ws = wb.active

def g(row, letter):
    i = CI(letter) - 1
    return "" if i >= len(row) or row[i] is None else as_text(row[i])

rows = list(ws.iter_rows(min_row=2, values_only=True))

# ---------- cabecalhos de saida (titulos reconhecidos pelo import) ----------
HEADERS = [
    "Razão social", "Nome fantasia", "CNPJ", "Inscrição estadual",
    "Telefone comercial", "WhatsApp", "E-mail comercial",
    "Endereço", "CEP", "Cidade", "UF",
    "Responsável (nome)", "Responsável (cargo)",
    "Loja física?", "Qtd. filiais", "Trabalha com telecom?", "Equipe técnica?",
    "Interesse em ser parceiro", "Origem do contato", "Observações",
]

aoa = [HEADERS]
stats = dict(total=0, bloco1=0, bloco2=0, com_cnpj=0, com_razao=0, com_fant=0, vazias=0)

for r in rows:
    usa_b2 = any(g(r, L) for L in ("AW", "AP", "AX", "BA"))  # Bloco 2 preenchido?
    if usa_b2:
        razao = g(r, "AW"); fant = g(r, "AP"); cnpj_raw = g(r, "AX")
        ie = g(r, "BA"); cargo = g(r, "BC")
        stats["bloco2"] += 1
    else:
        razao = g(r, "D"); fant = g(r, "E"); cnpj_raw = g(r, "F")
        ie = g(r, "I"); cargo = g(r, "L")
        stats["bloco1"] += 1

    cnpj = cnpj_fmt(cnpj_raw)

    # Campos compartilhados pelos dois blocos (coluna unica)
    email = g(r, "M"); tel = g(r, "N"); wpp = g(r, "O")
    uf = g(r, "AA"); cidade = g(r, "AC"); cep = g(r, "AR")
    logr = g(r, "AS"); num = g(r, "AU"); compl = g(r, "AV")
    resp_nome = g(r, "BE")
    loja = g(r, "Q"); qtd = g(r, "R")
    telecom = g(r, "U"); equipe = g(r, "V")
    interesse = g(r, "AL")
    tipo_cred = g(r, "B")

    endereco = ", ".join(p for p in (logr, num, compl) if p)

    # linha totalmente vazia (sem nome nenhum) -> descarta
    if not razao and not fant:
        stats["vazias"] += 1
        continue

    stats["total"] += 1
    if cnpj: stats["com_cnpj"] += 1
    if razao: stats["com_razao"] += 1
    if fant: stats["com_fant"] += 1

    obs_partes = []
    if tipo_cred:
        obs_partes.append(f"Credenciamento: {tipo_cred}")
    obs = " · ".join(obs_partes)

    aoa.append([
        razao, fant, cnpj, ie,
        tel, wpp, email,
        endereco, cep, cidade, uf,
        resp_nome, cargo,
        simnao(loja), qtd, simnao(telecom), simnao(equipe),
        interesse, "Formulário de credenciamento", obs,
    ])

wb.close()

# ---------- escrita ----------
out = openpyxl.Workbook()
wsout = out.active
wsout.title = "Empresas"
for line in aoa:
    wsout.append(line)
for i, _ in enumerate(HEADERS, 1):
    wsout.column_dimensions[openpyxl.utils.get_column_letter(i)].width = 20
out.save(OUT)

print("Gerado:", OUT)
print("Registros exportados:", stats["total"])
print("  via Bloco 1 (D/E/F/I):", stats["bloco1"], "| via Bloco 2 (AW/AP/AX/BA):", stats["bloco2"])
print("  com CNPJ valido:", stats["com_cnpj"], "| com Razao:", stats["com_razao"], "| com Fantasia:", stats["com_fant"])
print("  linhas vazias descartadas:", stats["vazias"])
