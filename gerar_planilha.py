# -*- coding: utf-8 -*-
"""
Gera o modelo de gestão de prospecção de revendas Starlink (Bradel).
Planilha .xlsx com 6 abas, fórmulas vivas, validações, formatação condicional,
filtros, painéis congelados e gráfico de evolução.
"""
import datetime as dt
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, NamedStyle
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
from openpyxl.chart import LineChart, Reference
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.utils import get_column_letter

# ----------------------------------------------------------------------------
# Parâmetros gerais
# ----------------------------------------------------------------------------
HOJE = dt.date(2026, 11, 11)           # data de referência (hoje)
N_REV = 101                            # última linha usada para fórmulas em Revendas (dados 2..101)
N_MERC = 61                            # última linha usada em Mercado/Cobertura (dados 2..61)

# Cores / estilos
AZUL = "1F4E78"
AZUL_CLARO = "DDEBF7"
CINZA = "F2F2F2"
VERDE = "375623"
AMARELO = "FFF2CC"
VERMELHO = "F8CBAD"

hdr_fill = PatternFill("solid", fgColor=AZUL)
hdr_font = Font(color="FFFFFF", bold=True, size=11)
hdr_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
title_font = Font(bold=True, size=13, color=AZUL)
sub_font = Font(bold=True, size=11, color=AZUL)
note_font = Font(italic=True, size=9, color="808080")
thin = Side(style="thin", color="BFBFBF")
border = Border(left=thin, right=thin, top=thin, bottom=thin)

wb = Workbook()

def style_header(ws, row, c1, c2):
    for col in range(c1, c2 + 1):
        cell = ws.cell(row=row, column=col)
        cell.fill = hdr_fill
        cell.font = hdr_font
        cell.alignment = hdr_align
        cell.border = border

def set_widths(ws, widths):
    for col, w in widths.items():
        ws.column_dimensions[col].width = w

DATEFMT = "DD/MM/YYYY"
PCTFMT = "0.0%"

# ============================================================================
# ABA LISTAS  (criada primeiro: fornece validações e parâmetros)
# ============================================================================
wsL = wb.active
wsL.title = "Listas"

etapas = ["Lead identificado", "Primeiro contato", "Apresentação",
          "Interesse confirmado", "Revenda cadastrada", "Primeira venda",
          "Revenda ativa", "Perdida/Descartada"]
status_viv = ["Sem credenciamento", "Em credenciamento", "Credenciada"]
responsaveis = ["Leandro", "Ronaldo", "Luis Carlos", "Mateus", "Sunamita"]
canais = ["Telecom", "Varejo (mercantil)"]
origens = ["Indicação", "Evento", "Inbound (site)", "Prospecção ativa", "Parceiro"]
motivos = ["Preço", "Sem interesse", "Concorrência", "Sem perfil",
           "Não respondeu", "Outro"]
ufs = ["PA", "TO", "MA", "GO"]

# Territórios (divisão real por microrregião). Município -> Responsável.
# Usado para preencher automaticamente o responsável na aba Revendas pela cidade.
# Sunamita (varejo/mercantil) não tem território fixo: cobre todos os estados e
# é atribuída manualmente marcando o Canal = "Varejo (mercantil)".
territorios = [
    # (Município, UF, Responsável)
    ("Anápolis",       "GO", "Leandro"),
    ("Jataí",          "GO", "Leandro"),
    ("Rio Verde",      "GO", "Leandro"),
    ("Tucuruí",        "PA", "Leandro"),
    ("Parauapebas",    "PA", "Leandro"),
    ("Marabá",         "PA", "Leandro"),
    ("Paragominas",    "PA", "Leandro"),
    ("Imperatriz",     "MA", "Ronaldo"),
    ("Barra do Corda", "MA", "Ronaldo"),
    ("Balsas",         "MA", "Ronaldo"),
    ("Araguaína",      "TO", "Ronaldo"),
    ("Araguatins",     "TO", "Ronaldo"),
    ("Tocantinópolis", "TO", "Ronaldo"),
    ("Breves",         "PA", "Luis Carlos"),
    ("Altamira",       "PA", "Luis Carlos"),
    ("Itaituba",       "PA", "Luis Carlos"),
    ("Palmas",         "TO", "Mateus"),
    ("Porto Nacional", "TO", "Mateus"),
    ("Gurupi",         "TO", "Mateus"),
    ("Redenção",       "PA", "Mateus"),
    ("Tucumã",         "PA", "Mateus"),
    ("Xinguara",       "PA", "Mateus"),
]

wsL["A1"] = "LISTAS E PARÂMETROS"
wsL["A1"].font = title_font

# Cabeçalhos das listas na linha 3
listas_hdr = {
    "A": "Etapas (funil)", "B": "Status Vivensis", "C": "Responsáveis",
    "D": "Origens do lead", "E": "Motivos de perda", "F": "UFs", "G": "Canal",
    "H": "UF (filtro)", "I": "Responsável (filtro)",
}
for col, txt in listas_hdr.items():
    c = wsL[f"{col}3"]
    c.value = txt
    c.fill = hdr_fill
    c.font = hdr_font
    c.alignment = hdr_align
    c.border = border

def put_col(col, values, start=4):
    for i, v in enumerate(values):
        wsL[f"{col}{start+i}"] = v

put_col("A", etapas)
put_col("B", status_viv)
put_col("C", responsaveis)
put_col("D", origens)
put_col("E", motivos)
put_col("F", ufs)
put_col("G", canais)
put_col("H", ["Todos"] + ufs)
put_col("I", ["Todos"] + responsaveis)

# Tabela de territórios (Município | UF | Responsável | Chave) a partir da coluna N.
terr_hdr = {"N": "Município (território)", "O": "UF", "P": "Responsável",
            "Q": "Chave (Mun|UF)"}
for col, txt in terr_hdr.items():
    c = wsL[f"{col}3"]
    c.value = txt
    c.fill = hdr_fill; c.font = hdr_font; c.alignment = hdr_align; c.border = border
for i, (mun, uf, resp) in enumerate(territorios):
    r = 4 + i
    wsL[f"N{r}"] = mun
    wsL[f"O{r}"] = uf
    wsL[f"P{r}"] = resp
    wsL[f"Q{r}"] = f'=N{r}&"|"&O{r}'
    for col in ("N", "O", "P", "Q"):
        wsL[f"{col}{r}"].border = border
    wsL[f"O{r}"].alignment = Alignment(horizontal="center")

# Parâmetros editáveis
wsL["K3"] = "Parâmetro"
wsL["L3"] = "Valor"
for col in ("K", "L"):
    c = wsL[f"{col}3"]
    c.fill = hdr_fill; c.font = hdr_font; c.alignment = hdr_align; c.border = border
params = [
    ("Dias para considerar revenda ATIVA (venda recente)", 60),
    ("Dias para alerta AMARELO (parada na etapa)", 30),
    ("Dias para alerta VERMELHO (parada na etapa)", 60),
]
for i, (lbl, val) in enumerate(params):
    r = 4 + i
    wsL[f"K{r}"] = lbl
    wsL[f"L{r}"] = val
    wsL[f"L{r}"].font = Font(bold=True)
    wsL[f"L{r}"].alignment = Alignment(horizontal="center")
    wsL[f"L{r}"].border = border
    wsL[f"K{r}"].border = border

set_widths(wsL, {"A": 22, "B": 20, "C": 16, "D": 18, "E": 16, "F": 8, "G": 18,
                 "H": 14, "I": 20, "K": 44, "L": 10,
                 "N": 22, "O": 6, "P": 16, "Q": 18})
wsL.freeze_panes = "A4"
wsL["A20"] = ("Observação: edite os valores da coluna 'Valor' (parâmetros) para ajustar "
              "a régua de dias. Todas as abas recalculam automaticamente.")
wsL["A20"].font = note_font

# Nomes definidos (named ranges) -------------------------------------------------
def dn(name, ref):
    wb.defined_names.add(DefinedName(name, attr_text=ref))

dn("etapas",          f"Listas!$A$4:$A${3+len(etapas)}")
dn("status_vivensis", f"Listas!$B$4:$B${3+len(status_viv)}")
dn("responsaveis",    f"Listas!$C$4:$C${3+len(responsaveis)}")
dn("origens",         f"Listas!$D$4:$D${3+len(origens)}")
dn("motivos",         f"Listas!$E$4:$E${3+len(motivos)}")
dn("ufs",             f"Listas!$F$4:$F${3+len(ufs)}")
dn("canais",          f"Listas!$G$4:$G${3+len(canais)}")
dn("uf_filtro",       f"Listas!$H$4:$H${4+len(ufs)}")
dn("resp_filtro",     f"Listas!$I$4:$I${4+len(responsaveis)}")
dn("territ_resp",     f"Listas!$P$4:$P${3+len(territorios)}")
dn("territ_chave",    f"Listas!$Q$4:$Q${3+len(territorios)}")
dn("param_dias_ativa", "Listas!$L$4")
dn("param_amarelo",    "Listas!$L$5")
dn("param_vermelho",   "Listas!$L$6")

# ============================================================================
# ABA MERCADO
# ============================================================================
wsM = wb.create_sheet("Mercado")
merc_cols = ["Município", "UF", "Região imediata", "Prioridade",
             "Vendas Jun", "Vendas Jul", "Vendas Ago",
             "Total 3 meses", "Chave (Município|UF)"]
for i, t in enumerate(merc_cols, start=1):
    wsM.cell(row=1, column=i, value=t)
style_header(wsM, 1, 1, len(merc_cols))

# Municípios-foco reais (um por território). Região imediata = o próprio
# município; todos Prioridade 1 (são cidades-foco). Vendas em branco para a
# usuária preencher com os números reais de mercado dos últimos 3 meses.
mercado_dados = [(mun, uf, mun, 1, None, None, None)
                 for (mun, uf, resp) in territorios]
for i, row in enumerate(mercado_dados):
    r = 2 + i
    for j, val in enumerate(row, start=1):
        if val is not None:
            wsM.cell(row=r, column=j, value=val)

# Fórmulas (Total 3 meses e Chave) para todas as linhas de trabalho
for r in range(2, N_MERC + 1):
    wsM.cell(row=r, column=8,
             value=f'=IF($A{r}="","",SUM(E{r}:G{r}))')
    wsM.cell(row=r, column=9,
             value=f'=IF($A{r}="","",$A{r}&"|"&$B{r})')
    for c in range(1, 10):
        wsM.cell(row=r, column=c).border = border

set_widths(wsM, {"A": 16, "B": 6, "C": 18, "D": 10, "E": 11, "F": 11,
                 "G": 11, "H": 13, "I": 20})
wsM.freeze_panes = "A2"
wsM.auto_filter.ref = f"A1:I{N_MERC}"
for r in range(2, N_MERC + 1):
    wsM.cell(row=r, column=4).alignment = Alignment(horizontal="center")

# ============================================================================
# ABA REVENDAS
# ============================================================================
wsR = wb.create_sheet("Revendas")
rev_cols = [
    "ID", "Nome da revenda", "CNPJ/CPF", "Contato", "Telefone", "E-mail",
    "Município", "UF", "Região imediata", "Prioridade", "Responsável comercial",
    "Origem do lead", "Etapa atual", "Status Vivensis",
    "Data lead", "Data 1º contato", "Data apresentação",
    "Data interesse confirmado", "Data cadastro",
    "Data início credenciamento Vivensis", "Data credenciamento Vivensis",
    "Data 1ª venda", "Ativações no mês", "Ativações acumuladas",
    "Data última venda", "Dias na etapa atual", "Motivo de perda",
    "Observações", "Última atualização",
    # helpers (col 30..32)
    "Ativa? (calc)", "Chave (calc)", "Etapa índice (calc)",
    # canal (col 33) — Telecom (padrão) ou Varejo (mercantil, Sunamita)
    "Canal",
]
for i, t in enumerate(rev_cols, start=1):
    wsR.cell(row=1, column=i, value=t)
style_header(wsR, 1, 1, len(rev_cols))

# Mapa de colunas úteis
# A1 ID ... col letters
# G=Município H=UF I=Região J=Prioridade K=Resp L=Origem M=Etapa N=Status
# O=Data lead P=1ºcontato Q=apresentação R=interesse S=cadastro
# T=início cred U=cred V=1ª venda W=ativ mês X=ativ acum Y=última venda
# Z=dias etapa AA=motivo AB=obs AC=última atualização
# AD=Ativa? AE=Chave AF=Etapa índice

# Dados de exemplo (8 revendas) ---------------------------------------------
# O Responsável NÃO é digitado aqui: é preenchido automaticamente pela tabela
# de territórios (coluna K = fórmula por Município|UF). A exceção é o varejo
# da Sunamita, que não tem território fixo e usa "resp_override".
d = lambda y, m, dd: dt.date(y, m, dd)
exemplos = [
    # ID, Nome, CNPJ, Contato, Tel, Email, Mun, UF, canal, Origem, Etapa, Status,
    #  dlead, d1c, dapr, dint, dcad, diniV, dcredV, d1venda, atvM, atvAc, dult, motivo, obs, datualiz
    dict(id="REV-001", nome="EXEMPLO - Conecta Norte LTDA", doc="12.345.678/0001-01",
         contato="João Pereira", tel="(91) 99999-0001", email="joao@conectanorte.com",
         mun="Marabá", uf="PA", canal="Telecom", origem="Indicação",
         etapa="Revenda ativa", status="Credenciada",
         dlead=d(2026,4,10), d1c=d(2026,4,15), dapr=d(2026,4,22), dint=d(2026,5,2),
         dcad=d(2026,5,10), diniV=d(2026,5,12), dcredV=d(2026,6,1), d1v=d(2026,6,20),
         atvM=5, atvAc=30, dult=d(2026,10,25), motivo="", obs="Melhor revenda da região (território Leandro).",
         datu=d(2026,11,10)),
    dict(id="REV-002", nome="EXEMPLO - TechSat Tocantins", doc="23.456.789/0001-02",
         contato="Marina Alves", tel="(63) 99999-0002", email="marina@techsat.com",
         mun="Palmas", uf="TO", canal="Telecom", origem="Evento",
         etapa="Primeira venda", status="Credenciada",
         dlead=d(2026,7,1), d1c=d(2026,7,5), dapr=d(2026,7,12), dint=d(2026,7,20),
         dcad=d(2026,8,1), diniV=d(2026,8,3), dcredV=d(2026,9,1), d1v=d(2026,11,1),
         atvM=2, atvAc=2, dult=d(2026,11,1), motivo="", obs="Primeira venda recente (território Mateus).",
         datu=d(2026,11,9)),
    dict(id="REV-003", nome="EXEMPLO - Maranhão Link ME", doc="34.567.890/0001-03",
         contato="Pedro Costa", tel="(98) 99999-0003", email="pedro@malink.com",
         mun="Imperatriz", uf="MA", canal="Telecom", origem="Inbound (site)",
         etapa="Revenda cadastrada", status="Em credenciamento",
         dlead=d(2026,8,5), d1c=d(2026,8,12), dapr=d(2026,8,25), dint=d(2026,9,5),
         dcad=d(2026,9,20), diniV=d(2026,10,1), dcredV=None, d1v=None,
         atvM=0, atvAc=0, dult=None, motivo="", obs="Aguardando documento Vivensis (território Ronaldo).",
         datu=d(2026,11,8)),
    dict(id="REV-004", nome="EXEMPLO - Goiás Orbital", doc="45.678.901/0001-04",
         contato="Luana Reis", tel="(62) 99999-0004", email="luana@gorbital.com",
         mun="Anápolis", uf="GO", canal="Telecom", origem="Prospecção ativa",
         etapa="Interesse confirmado", status="Sem credenciamento",
         dlead=d(2026,6,10), d1c=d(2026,6,20), dapr=d(2026,7,10), dint=d(2026,8,1),
         dcad=None, diniV=None, dcredV=None, d1v=None,
         atvM=0, atvAc=0, dult=None, motivo="", obs="Parado há semanas (demo de alerta vermelho / território Leandro).",
         datu=d(2026,8,1)),
    dict(id="REV-005", nome="EXEMPLO - Amazônia Net", doc="56.789.012/0001-05",
         contato="Rafael Lima", tel="(93) 99999-0005", email="rafael@amazonianet.com",
         mun="Altamira", uf="PA", canal="Telecom", origem="Parceiro",
         etapa="Revenda ativa", status="Sem credenciamento",
         dlead=d(2026,5,1), d1c=d(2026,5,8), dapr=d(2026,5,20), dint=d(2026,6,1),
         dcad=d(2026,6,15), diniV=None, dcredV=None, d1v=d(2026,7,10),
         atvM=3, atvAc=12, dult=d(2026,10,30), motivo="", obs="Ativa, porém sem Vivensis (território Luis Carlos).",
         datu=d(2026,11,5)),
    dict(id="REV-006", nome="EXEMPLO - Gurupi Digital", doc="67.890.123/0001-06",
         contato="Sofia Mendes", tel="(63) 99999-0006", email="sofia@gurupidigital.com",
         mun="Gurupi", uf="TO", canal="Telecom", origem="Evento",
         etapa="Apresentação", status="Sem credenciamento",
         dlead=d(2026,9,20), d1c=d(2026,9,28), dapr=d(2026,10,5), dint=None,
         dcad=None, diniV=None, dcredV=None, d1v=None,
         atvM=0, atvAc=0, dult=None, motivo="", obs="Parado (demo de alerta amarelo / território Mateus).",
         datu=d(2026,10,5)),
    dict(id="REV-007", nome="EXEMPLO - Balsas SAT", doc="78.901.234/0001-07",
         contato="Tiago Nunes", tel="(99) 99999-0007", email="tiago@balsassat.com",
         mun="Balsas", uf="MA", canal="Telecom", origem="Prospecção ativa",
         etapa="Perdida/Descartada", status="Sem credenciamento",
         dlead=d(2026,7,15), d1c=d(2026,7,20), dapr=d(2026,8,1), dint=None,
         dcad=None, diniV=None, dcredV=None, d1v=None,
         atvM=0, atvAc=0, dult=None, motivo="Preço", obs="Achou o custo alto (território Ronaldo).",
         datu=d(2026,8,10)),
    dict(id="REV-008", nome="EXEMPLO - Móveis Cerrado (varejo)", doc="89.012.345/0001-08",
         contato="Beatriz Rocha", tel="(62) 99999-0008", email="bia@moveiscerrado.com",
         mun="Rio Verde", uf="GO", canal="Varejo (mercantil)", resp_override="Sunamita",
         origem="Indicação", etapa="Primeiro contato", status="Sem credenciamento",
         dlead=d(2026,11,1), d1c=d(2026,11,6), dapr=None, dint=None,
         dcad=None, diniV=None, dcredV=None, d1v=None,
         atvM=0, atvAc=0, dult=None, motivo="", obs="Lojista de móveis/eletro — canal varejo (Sunamita).",
         datu=d(2026,11,6)),
]

for i, e in enumerate(exemplos):
    r = 2 + i
    wsR.cell(row=r, column=1, value=e["id"])
    wsR.cell(row=r, column=2, value=e["nome"])
    wsR.cell(row=r, column=3, value=e["doc"])
    wsR.cell(row=r, column=4, value=e["contato"])
    wsR.cell(row=r, column=5, value=e["tel"])
    wsR.cell(row=r, column=6, value=e["email"])
    wsR.cell(row=r, column=7, value=e["mun"])
    wsR.cell(row=r, column=8, value=e["uf"])
    # col 11 (Responsável) NÃO é escrito aqui: vem da fórmula de território.
    wsR.cell(row=r, column=12, value=e["origem"])
    wsR.cell(row=r, column=13, value=e["etapa"])
    wsR.cell(row=r, column=14, value=e["status"])
    wsR.cell(row=r, column=15, value=e["dlead"])
    wsR.cell(row=r, column=16, value=e["d1c"])
    wsR.cell(row=r, column=17, value=e["dapr"])
    wsR.cell(row=r, column=18, value=e["dint"])
    wsR.cell(row=r, column=19, value=e["dcad"])
    wsR.cell(row=r, column=20, value=e["diniV"])
    wsR.cell(row=r, column=21, value=e["dcredV"])
    wsR.cell(row=r, column=22, value=e["d1v"])
    wsR.cell(row=r, column=23, value=e["atvM"])
    wsR.cell(row=r, column=24, value=e["atvAc"])
    wsR.cell(row=r, column=25, value=e["dult"])
    wsR.cell(row=r, column=27, value=e["motivo"])
    wsR.cell(row=r, column=28, value=e["obs"])
    wsR.cell(row=r, column=29, value=e["datu"])
    wsR.cell(row=r, column=33, value=e["canal"])          # Canal

# Fórmulas vivas para TODAS as linhas de trabalho (2..N_REV)
for r in range(2, N_REV + 1):
    # I Região imediata (busca por Município|UF na aba Mercado)
    wsR.cell(row=r, column=9, value=(
        f'=IF($G{r}="","",IFERROR(INDEX(Mercado!$C$2:$C${N_MERC},'
        f'MATCH($G{r}&"|"&$H{r},Mercado!$I$2:$I${N_MERC},0)),"(cadastrar no Mercado)"))'))
    # J Prioridade
    wsR.cell(row=r, column=10, value=(
        f'=IF($G{r}="","",IFERROR(INDEX(Mercado!$D$2:$D${N_MERC},'
        f'MATCH($G{r}&"|"&$H{r},Mercado!$I$2:$I${N_MERC},0)),""))'))
    # K Responsável comercial — preenchido pelo território (Município|UF).
    # Varejo/mercantil (Sunamita) não tem território: basta digitar por cima.
    wsR.cell(row=r, column=11, value=(
        f'=IF($G{r}="","",IFERROR(INDEX(territ_resp,'
        f'MATCH($G{r}&"|"&$H{r},territ_chave,0)),"(sem território — preencher)"))'))
    # Z Dias na etapa atual (dias desde a data da etapa vigente)
    # Construído de dentro para fora para garantir parênteses balanceados.
    etapa_data = [
        ("Lead identificado",     f'IF($O{r}="","",TODAY()-$O{r})'),
        ("Primeiro contato",      f'IF($P{r}="","",TODAY()-$P{r})'),
        ("Apresentação",          f'IF($Q{r}="","",TODAY()-$Q{r})'),
        ("Interesse confirmado",  f'IF($R{r}="","",TODAY()-$R{r})'),
        ("Revenda cadastrada",    f'IF($S{r}="","",TODAY()-$S{r})'),
        ("Primeira venda",        f'IF($V{r}="","",TODAY()-$V{r})'),
        ("Revenda ativa",         f'IF($Y{r}<>"",TODAY()-$Y{r},IF($V{r}="","",TODAY()-$V{r}))'),
        ("Perdida/Descartada",    f'IF($AC{r}="","",TODAY()-$AC{r})'),
    ]
    expr = '""'
    for et, val in reversed(etapa_data):
        expr = f'IF($M{r}="{et}",{val},{expr})'
    wsR.cell(row=r, column=26, value=f'=IF($M{r}="","",{expr})')
    # AD Ativa? (venda nos últimos param_dias_ativa dias)
    wsR.cell(row=r, column=30, value=(
        f'=IF(AND($Y{r}<>"",(TODAY()-$Y{r})<=param_dias_ativa),1,0)'))
    # AE Chave
    wsR.cell(row=r, column=31, value=f'=IF($G{r}="","",$G{r}&"|"&$H{r})')
    # AF Etapa índice
    wsR.cell(row=r, column=32, value=f'=IFERROR(MATCH($M{r},etapas,0),"")')

# Override do responsável nos casos sem território (varejo/Sunamita):
# escrito DEPOIS do loop para vencer a fórmula de território na coluna K.
for i, e in enumerate(exemplos):
    if e.get("resp_override"):
        wsR.cell(row=2 + i, column=11, value=e["resp_override"])

# Formatos de data e números
date_cols = [15, 16, 17, 18, 19, 20, 21, 22, 25, 29]
for r in range(2, N_REV + 1):
    for c in date_cols:
        wsR.cell(row=r, column=c).number_format = DATEFMT
    for c in (10, 23, 24, 26, 30, 32):
        wsR.cell(row=r, column=c).alignment = Alignment(horizontal="center")

# Validações (listas suspensas)
def add_dv(ws, formula, cells, allow_blank=True):
    dv = DataValidation(type="list", formula1=formula, allow_blank=allow_blank)
    dv.error = "Selecione um valor da lista."
    dv.errorTitle = "Valor inválido"
    ws.add_data_validation(dv)
    dv.add(cells)

rng = lambda col: f"{col}2:{col}{N_REV}"
add_dv(wsR, "etapas",          rng("M"))
add_dv(wsR, "status_vivensis", rng("N"))
add_dv(wsR, "responsaveis",    rng("K"))
add_dv(wsR, "origens",         rng("L"))
add_dv(wsR, "motivos",         rng("AA"))
add_dv(wsR, "ufs",             rng("H"))
add_dv(wsR, "canais",          rng("AG"))

# Formatação condicional (alertas de parada) sobre A2:AC{N}
rng_cf = f"A2:AC{N_REV}"
# Vermelho: parada > param_vermelho dias (exceto perdidas)
wsR.conditional_formatting.add(rng_cf, FormulaRule(
    formula=[f'AND($Z2<>"",$Z2>param_vermelho,$M2<>"Perdida/Descartada")'],
    fill=PatternFill("solid", fgColor=VERMELHO), stopIfTrue=True))
# Amarelo: parada > param_amarelo e <= param_vermelho
wsR.conditional_formatting.add(rng_cf, FormulaRule(
    formula=[f'AND($Z2<>"",$Z2>param_amarelo,$Z2<=param_vermelho,$M2<>"Perdida/Descartada")'],
    fill=PatternFill("solid", fgColor=AMARELO)))

set_widths(wsR, {
    "A": 9, "B": 30, "C": 20, "D": 16, "E": 16, "F": 24, "G": 14, "H": 6,
    "I": 18, "J": 9, "K": 18, "L": 16, "M": 20, "N": 18,
    "O": 12, "P": 13, "Q": 14, "R": 16, "S": 12, "T": 18, "U": 18, "V": 12,
    "W": 11, "X": 13, "Y": 14, "Z": 12, "AA": 16, "AB": 30, "AC": 14,
    "AD": 11, "AE": 16, "AF": 14, "AG": 18,
})
wsR.freeze_panes = "C2"          # congela cabeçalho + colunas de identificação
wsR.auto_filter.ref = f"A1:AG{N_REV}"
for r in range(2, N_REV + 1):
    for c in range(1, 34):
        cell = wsR.cell(row=r, column=c)
        if cell.border.left.style is None:
            cell.border = border

# ============================================================================
# ABA FUNIL
# ============================================================================
wsF = wb.create_sheet("Funil")
wsF["A1"] = "FUNIL DE PROSPECÇÃO — contagem, conversão e tempos médios"
wsF["A1"].font = title_font

# Filtros
wsF["A3"] = "Filtro UF:"
wsF["A3"].font = sub_font
wsF["B3"] = "Todos"
wsF["A4"] = "Filtro Responsável:"
wsF["A4"].font = sub_font
wsF["B4"] = "Todos"
for cell in ("B3", "B4"):
    wsF[cell].fill = PatternFill("solid", fgColor=AZUL_CLARO)
    wsF[cell].border = border
    wsF[cell].alignment = Alignment(horizontal="center")
add_dv(wsF, "uf_filtro", "B3", allow_blank=False)
add_dv(wsF, "resp_filtro", "B4", allow_blank=False)
# Critérios resolvidos (para COUNTIFS): * = todos
wsF["D3"] = "Critério UF:"
wsF["E3"] = '=IF($B$3="Todos","*",$B$3)'
wsF["D4"] = "Critério Resp.:"
wsF["E4"] = '=IF($B$4="Todos","*",$B$4)'
wsF["D3"].font = note_font; wsF["D4"].font = note_font
UFC = "$E$3"; RESPC = "$E$4"

def filt():
    return (f',Revendas!$H$2:$H${N_REV},{UFC}'
            f',Revendas!$K$2:$K${N_REV},{RESPC}')

# --- Bloco 1: Matriz Etapa x Status -------------------------------------------
wsF["A6"] = "1) Contagem por Etapa × Status Vivensis"
wsF["A6"].font = sub_font
hdr_row = 7
wsF.cell(row=hdr_row, column=1, value="Etapa")
for j, s in enumerate(status_viv):
    wsF.cell(row=hdr_row, column=2 + j, value=s)
wsF.cell(row=hdr_row, column=5, value="Total")
style_header(wsF, hdr_row, 1, 5)
for i, et in enumerate(etapas):
    r = hdr_row + 1 + i
    wsF.cell(row=r, column=1, value=et).border = border
    for j, s in enumerate(status_viv):
        col = 2 + j
        wsF.cell(row=r, column=col, value=(
            f'=COUNTIFS(Revendas!$M$2:$M${N_REV},$A{r},'
            f'Revendas!$N$2:$N${N_REV},{get_column_letter(col)}${hdr_row}{filt()})'))
        wsF.cell(row=r, column=col).border = border
        wsF.cell(row=r, column=col).alignment = Alignment(horizontal="center")
    wsF.cell(row=r, column=5, value=f'=SUM(B{r}:D{r})')
    wsF.cell(row=r, column=5).border = border
    wsF.cell(row=r, column=5).alignment = Alignment(horizontal="center")
tot_row = hdr_row + 1 + len(etapas)
wsF.cell(row=tot_row, column=1, value="Total").font = Font(bold=True)
for col in range(2, 6):
    L = get_column_letter(col)
    wsF.cell(row=tot_row, column=col,
             value=f'=SUM({L}{hdr_row+1}:{L}{tot_row-1})')
    wsF.cell(row=tot_row, column=col).font = Font(bold=True)
    wsF.cell(row=tot_row, column=col).border = border
    wsF.cell(row=tot_row, column=col).alignment = Alignment(horizontal="center")

# --- Bloco 2: Atingiram a etapa (cumulativo) ----------------------------------
# etapa índice 1..7 (exclui Perdida=8). Reached(k)=contagem idx entre k e 7.
b2 = tot_row + 2
wsF.cell(row=b2, column=1, value="2) Quantas revendas ATINGIRAM cada etapa (cumulativo, exclui perdidas)")
wsF.cell(row=b2, column=1).font = sub_font
h2 = b2 + 1
wsF.cell(row=h2, column=1, value="Etapa")
wsF.cell(row=h2, column=2, value="k")
for j, s in enumerate(status_viv):
    wsF.cell(row=h2, column=3 + j, value=s)
wsF.cell(row=h2, column=6, value="Total")
style_header(wsF, h2, 1, 6)
reached_first = h2 + 1
for k in range(1, 8):
    r = reached_first + (k - 1)
    wsF.cell(row=r, column=1, value=etapas[k-1]).border = border
    wsF.cell(row=r, column=2, value=k).border = border
    wsF.cell(row=r, column=2).alignment = Alignment(horizontal="center")
    for j, s in enumerate(status_viv):
        col = 3 + j
        wsF.cell(row=r, column=col, value=(
            f'=COUNTIFS(Revendas!$AF$2:$AF${N_REV},">="&$B{r},'
            f'Revendas!$AF$2:$AF${N_REV},"<=7",'
            f'Revendas!$N$2:$N${N_REV},{get_column_letter(col)}${h2}{filt()})'))
        wsF.cell(row=r, column=col).border = border
        wsF.cell(row=r, column=col).alignment = Alignment(horizontal="center")
    wsF.cell(row=r, column=6, value=f'=SUM(C{r}:E{r})')
    wsF.cell(row=r, column=6).border = border
    wsF.cell(row=r, column=6).alignment = Alignment(horizontal="center")
reached_last = reached_first + 6

# --- Bloco 3: Conversão entre etapas consecutivas -----------------------------
b3 = reached_last + 2
wsF.cell(row=b3, column=1, value="3) Taxa de conversão entre etapas consecutivas (por status)")
wsF.cell(row=b3, column=1).font = sub_font
h3 = b3 + 1
wsF.cell(row=h3, column=1, value="Transição")
for j, s in enumerate(status_viv):
    wsF.cell(row=h3, column=2 + j, value=s)
wsF.cell(row=h3, column=5, value="Total")
style_header(wsF, h3, 1, 5)
for k in range(1, 7):  # 1->2 ... 6->7
    r = h3 + k
    wsF.cell(row=r, column=1,
             value=f"{etapas[k-1]} → {etapas[k]}").border = border
    # reached rows: etapa k at reached_first+(k-1); cols C,D,E,F(total)
    num_row = reached_first + k        # k+1
    den_row = reached_first + (k - 1)  # k
    for j in range(len(status_viv)):
        col = 2 + j
        src = get_column_letter(3 + j)  # C/D/E in reached table
        wsF.cell(row=r, column=col, value=(
            f'=IFERROR({src}{num_row}/{src}{den_row},"")'))
        wsF.cell(row=r, column=col).number_format = PCTFMT
        wsF.cell(row=r, column=col).border = border
        wsF.cell(row=r, column=col).alignment = Alignment(horizontal="center")
    wsF.cell(row=r, column=5, value=f'=IFERROR(F{num_row}/F{den_row},"")')
    wsF.cell(row=r, column=5).number_format = PCTFMT
    wsF.cell(row=r, column=5).border = border
    wsF.cell(row=r, column=5).alignment = Alignment(horizontal="center")

# --- Bloco 4: Tempos médios (dias) por status ---------------------------------
b4 = h3 + 7 + 1
wsF.cell(row=b4, column=1, value="4) Tempo médio (dias) por status Vivensis")
wsF.cell(row=b4, column=1).font = sub_font
h4 = b4 + 1
wsF.cell(row=h4, column=1, value="Intervalo")
for j, s in enumerate(status_viv):
    wsF.cell(row=h4, column=2 + j, value=s)
wsF.cell(row=h4, column=5, value="Geral")
style_header(wsF, h4, 1, 5)

# (coluna origem, coluna destino) em Revendas
intervalos = [
    ("Lead → Cadastro", "O", "S"),
    ("Cadastro → Credenciamento", "S", "U"),
    ("Cadastro → 1ª venda", "S", "V"),
]
def tempo_formula(c1, c2, status_cell=None):
    nR = N_REV
    cond_status = ""
    if status_cell:
        cond_status = f'*(Revendas!$N$2:$N${nR}={status_cell})'
    uf = f'*((Revendas!$H$2:$H${nR}=$B$3)+($B$3="Todos")>0)'
    rp = f'*((Revendas!$K$2:$K${nR}=$B$4)+($B$4="Todos")>0)'
    base = (f'(Revendas!${c1}$2:${c1}${nR}<>"")*(Revendas!${c2}$2:${c2}${nR}<>"")'
            f'{cond_status}{uf}{rp}')
    num = (f'SUMPRODUCT({base}*(Revendas!${c2}$2:${c2}${nR}-Revendas!${c1}$2:${c1}${nR}))')
    den = f'SUMPRODUCT({base})'
    return f'=IFERROR(ROUND({num}/{den},1),"")'

for i, (lbl, c1, c2) in enumerate(intervalos):
    r = h4 + 1 + i
    wsF.cell(row=r, column=1, value=lbl).border = border
    for j, s in enumerate(status_viv):
        col = 2 + j
        status_cell = f'$H${h4}'  # placeholder; use literal status text
        wsF.cell(row=r, column=col,
                 value=tempo_formula(c1, c2, f'{get_column_letter(col)}${h4}'))
        wsF.cell(row=r, column=col).border = border
        wsF.cell(row=r, column=col).alignment = Alignment(horizontal="center")
    wsF.cell(row=r, column=5, value=tempo_formula(c1, c2, None))
    wsF.cell(row=r, column=5).border = border
    wsF.cell(row=r, column=5).alignment = Alignment(horizontal="center")

# --- Bloco 5: Ativações médias por revenda ativa ------------------------------
b5 = h4 + 1 + len(intervalos) + 1
wsF.cell(row=b5, column=1, value="5) Ativações médias por revenda ATIVA")
wsF.cell(row=b5, column=1).font = sub_font
nR = N_REV
uf_f = f'*((Revendas!$H$2:$H${nR}=$B$3)+($B$3="Todos")>0)'
rp_f = f'*((Revendas!$K$2:$K${nR}=$B$4)+($B$4="Todos")>0)'
ativa = f'Revendas!$AD$2:$AD${nR}'
atvm = f'Revendas!$W$2:$W${nR}'
cred = f'(Revendas!$N$2:$N${nR}="Credenciada")'
ncred = f'(Revendas!$N$2:$N${nR}<>"Credenciada")'
wsF.cell(row=b5+1, column=1, value="Com Vivensis (credenciada)").border = border
wsF.cell(row=b5+1, column=2, value=(
    f'=IFERROR(ROUND(SUMPRODUCT({ativa}*{cred}*{atvm}{uf_f}{rp_f})/'
    f'SUMPRODUCT({ativa}*{cred}{uf_f}{rp_f}),2),"")'))
wsF.cell(row=b5+2, column=1, value="Sem Vivensis").border = border
wsF.cell(row=b5+2, column=2, value=(
    f'=IFERROR(ROUND(SUMPRODUCT({ativa}*{ncred}*{atvm}{uf_f}{rp_f})/'
    f'SUMPRODUCT({ativa}*{ncred}{uf_f}{rp_f}),2),"")'))
for rr in (b5+1, b5+2):
    wsF.cell(row=rr, column=2).border = border
    wsF.cell(row=rr, column=2).alignment = Alignment(horizontal="center")

set_widths(wsF, {"A": 34, "B": 18, "C": 18, "D": 16, "E": 14, "F": 12})
wsF.freeze_panes = "A2"

# ============================================================================
# ABA COBERTURA
# ============================================================================
wsC = wb.create_sheet("Cobertura")
cob_cols = ["Município", "UF", "Prioridade", "Vendas mercado (3m)",
            "Revendas em prospecção", "Revendas ativas (total)",
            "Revendas ativas sem Vivensis", "Revendas credenciadas",
            "Situação de cobertura",
            "Tem ativa (calc)", "Tem cred. ativa (calc)", "Score oport. (calc)"]
for i, t in enumerate(cob_cols, start=1):
    wsC.cell(row=1, column=i, value=t)
style_header(wsC, 1, 1, len(cob_cols))

for r in range(2, N_MERC + 1):
    mun = f'$A{r}'
    A = f'=IF(Mercado!A{r}="","",Mercado!A{r})'
    wsC.cell(row=r, column=1, value=A)
    wsC.cell(row=r, column=2, value=f'=IF(Mercado!A{r}="","",Mercado!B{r})')
    # C Prioridade e D Vendas: numéricos (0 quando vazio) p/ SUMPRODUCT dos KPIs
    wsC.cell(row=r, column=3, value=f'=IF(Mercado!A{r}="",0,Mercado!D{r})')
    wsC.cell(row=r, column=4, value=f'=IF(Mercado!A{r}="",0,Mercado!H{r})')
    # E prospecção (todas as revendas do município, menos as perdidas)
    wsC.cell(row=r, column=5, value=(
        f'=IF($A{r}="","",'
        f'COUNTIFS(Revendas!$G$2:$G${N_REV},$A{r},Revendas!$H$2:$H${N_REV},$B{r})'
        f'-COUNTIFS(Revendas!$G$2:$G${N_REV},$A{r},Revendas!$H$2:$H${N_REV},$B{r},'
        f'Revendas!$M$2:$M${N_REV},"Perdida/Descartada"))'))
    # F ativas total
    wsC.cell(row=r, column=6, value=(
        f'=IF($A{r}="","",SUMPRODUCT((Revendas!$G$2:$G${N_REV}=$A{r})*'
        f'(Revendas!$H$2:$H${N_REV}=$B{r})*(Revendas!$AD$2:$AD${N_REV})))'))
    # G ativas sem vivensis
    wsC.cell(row=r, column=7, value=(
        f'=IF($A{r}="","",SUMPRODUCT((Revendas!$G$2:$G${N_REV}=$A{r})*'
        f'(Revendas!$H$2:$H${N_REV}=$B{r})*(Revendas!$AD$2:$AD${N_REV})*'
        f'(Revendas!$N$2:$N${N_REV}<>"Credenciada")))'))
    # H credenciadas
    wsC.cell(row=r, column=8, value=(
        f'=IF($A{r}="","",COUNTIFS(Revendas!$G$2:$G${N_REV},$A{r},'
        f'Revendas!$H$2:$H${N_REV},$B{r},'
        f'Revendas!$N$2:$N${N_REV},"Credenciada"))'))
    # I situação (melhor situação existente)
    wsC.cell(row=r, column=9, value=(
        f'=IF($A{r}="","",IF($H{r}>0,"Revenda credenciada",'
        f'IF($G{r}>0,"Revenda sem Vivensis",'
        f'IF($E{r}>0,"Em prospecção","Sem revenda"))))'))
    # J tem ativa (numérico 0/1 p/ SUMPRODUCT dos KPIs)
    wsC.cell(row=r, column=10, value=f'=IF($A{r}="",0,IF($F{r}>0,1,0))')
    # K tem cred ativa (numérico 0/1 p/ SUMPRODUCT dos KPIs)
    wsC.cell(row=r, column=11, value=(
        f'=IF($A{r}="",0,IF(SUMPRODUCT((Revendas!$G$2:$G${N_REV}=$A{r})*'
        f'(Revendas!$H$2:$H${N_REV}=$B{r})*(Revendas!$AD$2:$AD${N_REV})*'
        f'(Revendas!$N$2:$N${N_REV}="Credenciada"))>0,1,0))'))
    # L score oportunidade (P1 sem credenciada), desempate por linha
    wsC.cell(row=r, column=12, value=(
        f'=IF($A{r}="","",IF(AND($C{r}=1,$H{r}=0),$D{r}-{r}/1000000,""))'))
    for c in range(1, 13):
        cell = wsC.cell(row=r, column=c)
        cell.border = border
        if c in (3, 5, 6, 7, 8, 10, 11):
            cell.alignment = Alignment(horizontal="center")
    # oculta zeros das linhas vazias (C Prioridade, D Vendas) para visual limpo
    wsC.cell(row=r, column=3).number_format = '0;0;""'
    wsC.cell(row=r, column=4).number_format = '#,##0;-#,##0;""'

# --- Formatação condicional da "Situação de cobertura" (coluna I) ---
sit_rng = f"I2:I{N_MERC}"
cores_sit = {
    "Sem revenda": "F8CBAD",
    "Em prospecção": "FFF2CC",
    "Revenda sem Vivensis": "DDEBF7",
    "Revenda credenciada": "C6EFCE",
}
for txt, cor in cores_sit.items():
    wsC.conditional_formatting.add(sit_rng, FormulaRule(
        formula=[f'$I2="{txt}"'], fill=PatternFill("solid", fgColor=cor)))

# --- Painel de KPIs (à direita, a partir da coluna N) ---
def pxrange(col):
    return f'$C$2:$C${N_MERC}', f'$D$2:$D${N_MERC}', f'$J$2:$J${N_MERC}', f'$K$2:$K${N_MERC}', f'$B$2:$B${N_MERC}'
Ccol, Dcol, Jcol, Kcol, Bcol = pxrange(None)

wsC["N1"] = "KPIs DE COBERTURA (vendas de mercado como peso)"
wsC["N1"].font = title_font
wsC["N3"] = "Cobertura P1 (≥1 revenda ativa)"
wsC["O3"] = (f'=IFERROR(SUMPRODUCT(({Ccol}=1)*({Jcol})*({Dcol}))/'
             f'SUMPRODUCT(({Ccol}=1)*({Dcol})),0)')
wsC["N4"] = "Cobertura P1 credenciada"
wsC["O4"] = (f'=IFERROR(SUMPRODUCT(({Ccol}=1)*({Kcol})*({Dcol}))/'
             f'SUMPRODUCT(({Ccol}=1)*({Dcol})),0)')
for r in (3, 4):
    wsC[f"N{r}"].font = sub_font
    wsC[f"O{r}"].number_format = PCTFMT
    wsC[f"O{r}"].font = Font(bold=True, size=12, color=VERDE)
    wsC[f"O{r}"].alignment = Alignment(horizontal="center")
    wsC[f"O{r}"].fill = PatternFill("solid", fgColor=AZUL_CLARO)
    wsC[f"O{r}"].border = border

# KPIs por UF
wsC["N6"] = "Por UF"
wsC["N6"].font = sub_font
wsC["N7"] = "UF"; wsC["O7"] = "Cobertura P1"; wsC["P7"] = "Cob. P1 credenc."
style_header(wsC, 7, 14, 16)
for i, uf in enumerate(ufs):
    r = 8 + i
    wsC.cell(row=r, column=14, value=uf).border = border
    wsC.cell(row=r, column=14).alignment = Alignment(horizontal="center")
    wsC.cell(row=r, column=15, value=(
        f'=IFERROR(SUMPRODUCT(({Ccol}=1)*({Bcol}=$N{r})*({Jcol})*({Dcol}))/'
        f'SUMPRODUCT(({Ccol}=1)*({Bcol}=$N{r})*({Dcol})),0)'))
    wsC.cell(row=r, column=16, value=(
        f'=IFERROR(SUMPRODUCT(({Ccol}=1)*({Bcol}=$N{r})*({Kcol})*({Dcol}))/'
        f'SUMPRODUCT(({Ccol}=1)*({Bcol}=$N{r})*({Dcol})),0)'))
    for c in (15, 16):
        wsC.cell(row=r, column=c).number_format = PCTFMT
        wsC.cell(row=r, column=c).alignment = Alignment(horizontal="center")
        wsC.cell(row=r, column=c).border = border

# Bloco Oportunidades
op_start = 8 + len(ufs) + 2
wsC.cell(row=op_start, column=14,
         value="OPORTUNIDADES — P1 sem revenda credenciada (maior venda primeiro)")
wsC.cell(row=op_start, column=14).font = sub_font
oph = op_start + 1
wsC.cell(row=oph, column=14, value="Município")
wsC.cell(row=oph, column=15, value="UF")
wsC.cell(row=oph, column=16, value="Vendas 3m")
style_header(wsC, oph, 14, 16)
Lrange = f'$L$2:$L${N_MERC}'
for k in range(1, 11):
    r = oph + k
    mt = (f'MATCH(LARGE({Lrange},{k}),{Lrange},0)')
    wsC.cell(row=r, column=14, value=(
        f'=IFERROR(INDEX($A$2:$A${N_MERC},{mt}),"")'))
    wsC.cell(row=r, column=15, value=(
        f'=IFERROR(INDEX($B$2:$B${N_MERC},{mt}),"")'))
    wsC.cell(row=r, column=16, value=(
        f'=IFERROR(INDEX($D$2:$D${N_MERC},{mt}),"")'))
    for c in (14, 15, 16):
        wsC.cell(row=r, column=c).border = border
    wsC.cell(row=r, column=15).alignment = Alignment(horizontal="center")
    wsC.cell(row=r, column=16).alignment = Alignment(horizontal="center")

set_widths(wsC, {"A": 16, "B": 6, "C": 10, "D": 16, "E": 18, "F": 18,
                 "G": 20, "H": 18, "I": 20, "J": 13, "K": 16, "L": 15,
                 "N": 30, "O": 16, "P": 16})
wsC.freeze_panes = "A2"
wsC.auto_filter.ref = f"A1:I{N_MERC}"

# ============================================================================
# ABA HISTÓRICO
# ============================================================================
wsH = wb.create_sheet("Histórico")
hist_cols = ["Data do registro", "UF", "Cobertura P1", "Cobertura P1 credenciada",
             "Revendas em prospecção", "Revendas ativas sem Vivensis",
             "Revendas credenciadas", "Ativações no período"]
# Nota no topo
wsH["A1"] = ("COMO REGISTRAR A SEMANA: a cada segunda-feira, abra a aba Cobertura, "
             "copie os KPIs atuais e cole COMO VALORES em uma nova linha abaixo "
             "(Colar especial > Valores). Nunca use fórmulas aqui — este é um registro "
             "fotográfico da evolução. Use UF='Todos' para o consolidado ou uma UF específica.")
wsH["A1"].font = note_font
wsH["A1"].alignment = Alignment(wrap_text=True, vertical="top")
wsH.row_dimensions[1].height = 48
for i in range(2, 9):
    wsH.cell(row=1, column=i)  # mantém linha 1 ocupada só pela nota

# Cabeçalho na linha 2
for i, t in enumerate(hist_cols, start=1):
    wsH.cell(row=2, column=i, value=t)
style_header(wsH, 2, 1, len(hist_cols))

# Exemplos de registros semanais (valores estáticos — como deve ser preenchido)
hist_dados = [
    (dt.date(2026,10,19), "Todos", 0.35, 0.18, 5, 1, 1, 6),
    (dt.date(2026,10,26), "Todos", 0.42, 0.22, 6, 1, 1, 7),
    (dt.date(2026,11, 2), "Todos", 0.48, 0.25, 7, 2, 2, 9),
    (dt.date(2026,11, 9), "Todos", 0.55, 0.31, 8, 2, 2, 12),
]
for i, row in enumerate(hist_dados):
    r = 3 + i
    for j, v in enumerate(row, start=1):
        cell = wsH.cell(row=r, column=j, value=v)
        cell.border = border
        if j == 1:
            cell.number_format = DATEFMT
        elif j in (3, 4):
            cell.number_format = PCTFMT
        else:
            cell.alignment = Alignment(horizontal="center")

set_widths(wsH, {"A": 16, "B": 10, "C": 14, "D": 22, "E": 20, "F": 24,
                 "G": 18, "H": 18})
wsH.freeze_panes = "A3"
wsH.auto_filter.ref = f"A2:H{2+len(hist_dados)}"

# Gráfico de linhas: evolução da Cobertura P1 e P1 credenciada
chart = LineChart()
chart.title = "Evolução da Cobertura P1 (geral x credenciada)"
chart.style = 12
chart.y_axis.title = "% de cobertura"
chart.x_axis.title = "Data do registro"
chart.y_axis.numFmt = "0%"
data = Reference(wsH, min_col=3, max_col=4, min_row=2, max_row=2+len(hist_dados))
cats = Reference(wsH, min_col=1, min_row=3, max_row=2+len(hist_dados))
chart.add_data(data, titles_from_data=True)
chart.set_categories(cats)
chart.height = 8
chart.width = 16
wsH.add_chart(chart, "J2")

# ============================================================================
# Ordem das abas e salvamento
# ============================================================================
wb.move_sheet("Listas", offset=len(wb.sheetnames))  # manda Listas para o fim
ordem = ["Revendas", "Mercado", "Funil", "Cobertura", "Histórico", "Listas"]
wb._sheets.sort(key=lambda s: ordem.index(s.title))
wb.active = wb.sheetnames.index("Revendas")

out = r"c:\Users\luisa.jansen\Downloads\Pasta VS Code\prospeccao-regional-starlink\Gestao_Prospeccao_Revendas_Starlink.xlsx"
wb.save(out)
print("OK ->", out)
