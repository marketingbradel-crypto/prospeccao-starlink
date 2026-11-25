# -*- coding: utf-8 -*-
"""Importacao/exportacao Excel: seed da planilha atual, modelo padronizado, import com dedupe por CNPJ."""
import datetime as dt
import io
import os
import re

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.datavalidation import DataValidation

from . import db, geo, listas

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANILHA_ATUAL = os.path.join(BASE, "Gestao_Prospeccao_Revendas_Starlink.xlsx")

# field -> rotulo amigavel (cabecalho do Excel)
FIELD_LABELS = {
    "codigo": "Código", "razao_social": "Razão social", "nome_fantasia": "Nome fantasia",
    "cnpj": "CNPJ", "inscricao_estadual": "Inscrição estadual",
    "telefone_comercial": "Telefone comercial", "whatsapp": "WhatsApp",
    "email_comercial": "E-mail comercial", "site_instagram": "Site/Instagram",
    "endereco": "Endereço", "cep": "CEP", "cidade": "Cidade", "uf": "UF",
    "microrregiao": "Microrregião", "latitude": "Latitude", "longitude": "Longitude",
    "resp_nome": "Responsável (nome)", "resp_cargo": "Cargo",
    "resp_telefone": "Telefone direto", "resp_whatsapp": "WhatsApp do responsável",
    "resp_email": "E-mail do responsável",
    "segmento": "Segmento", "produtos": "Principais produtos",
    "trabalha_telecom": "Trabalha com telecom/internet/tecnologia?",
    "ja_starlink": "Já comercializa Starlink?",
    "exp_antenas": "Experiência com instalação de antenas?",
    "equipe_tecnica": "Possui equipe técnica?", "loja_fisica": "Possui loja física?",
    "qtd_filiais": "Qtd. filiais", "capacidade_vendas_mes": "Capacidade de vendas/mês",
    "interesse_parceiro": "Interesse em ser parceiro credenciado",
    "origem_contato": "Origem do contato",
    "canal": "Canal", "responsavel": "Responsável comercial (Bradel)",
    "prioridade": "Prioridade", "status": "Status comercial",
    "status_vivensis": "Status Vivensis", "etapa": "Etapa (funil)",
    "motivo_perda": "Motivo de perda", "observacoes": "Observações",
    "data_lead": "Data do lead", "data_primeiro_contato": "Data 1º contato",
    "data_apresentacao": "Data apresentação", "data_interesse": "Data interesse",
    "data_cadastro": "Data cadastro", "data_inicio_cred": "Data início credenciamento",
    "data_cred": "Data credenciamento", "data_primeira_venda": "Data 1ª venda",
    "data_ultima_venda": "Data última venda", "data_ultimo_contato": "Data último contato",
    "proxima_acao": "Próxima ação", "proxima_acao_data": "Data próxima ação",
    "ativacoes_mes": "Ativações no mês", "ativacoes_acum": "Ativações acumuladas",
}
LABEL_TO_FIELD = {listas.norm(v): k for k, v in FIELD_LABELS.items()}
# aceita tambem a propria chave como cabecalho
LABEL_TO_FIELD.update({listas.norm(k): k for k in FIELD_LABELS})

BOOL_FIELDS = {"trabalha_telecom", "ja_starlink", "exp_antenas", "equipe_tecnica", "loja_fisica"}
DATE_FIELDS = {f for f in db.EMPRESA_CAMPOS if f.startswith("data_")} | {"proxima_acao_data"}
INT_FIELDS = {"qtd_filiais", "ativacoes_mes", "ativacoes_acum"}


# ---------------- helpers de valor ----------------
def cnpj_norm(s):
    return re.sub(r"\D", "", str(s or ""))


def parse_date(v):
    """Qualquer entrada -> 'YYYY-MM-DD' (ou '')."""
    if v in (None, ""):
        return ""
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    if not s:
        return ""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})", s)
    if m:
        d, mo, y = m.groups()
        if len(y) == 2:
            y = "20" + y
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    return s


def fmt_date_br(iso):
    if not iso:
        return ""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(iso))
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}" if m else str(iso)


def parse_bool(v):
    if v in (None, ""):
        return 0
    s = str(v).strip().lower()
    return 1 if s in ("1", "sim", "s", "true", "verdadeiro", "x", "yes", "y") else 0


def parse_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def today_iso():
    return dt.date.today().strftime("%Y-%m-%d")


def clean_row(d):
    """Normaliza um dict de entrada para os tipos do banco."""
    out = {}
    for f in db.EMPRESA_CAMPOS:
        if f not in d:
            continue
        v = d[f]
        if f in BOOL_FIELDS:
            out[f] = parse_bool(v)
        elif f in DATE_FIELDS:
            out[f] = parse_date(v)
        elif f in INT_FIELDS:
            out[f] = parse_int(v)
        elif f in ("latitude", "longitude"):
            try:
                out[f] = float(v) if v not in (None, "") else None
            except (TypeError, ValueError):
                out[f] = None
        else:
            out[f] = ("" if v is None else str(v)).strip()
    return out


def enrich(d):
    """Preenche microrregiao e responsavel por territorio quando faltarem."""
    if not d.get("microrregiao") and d.get("cidade"):
        d["microrregiao"] = geo.microrregiao_de(d["cidade"], d.get("uf"))
    if not d.get("responsavel") and d.get("canal") != "Varejo (mercantil)" and d.get("cidade"):
        chave = f"{listas.norm(d['cidade'])}|{(d.get('uf') or '').upper()}"
        row = db.get_conn().execute(
            "SELECT responsavel FROM territorios WHERE chave=?", (chave,)
        ).fetchone()
        if row and row["responsavel"]:
            d["responsavel"] = row["responsavel"]
    return d


# ---------------- seed a partir da planilha atual ----------------
# mapa coluna(1-indexada) da aba Revendas -> campo
_REV_MAP = {
    1: "codigo", 2: "nome_fantasia", 3: "cnpj", 4: "resp_nome", 5: "telefone_comercial",
    6: "email_comercial", 7: "cidade", 8: "uf", 9: "microrregiao", 10: "prioridade",
    11: "responsavel", 12: "origem_contato", 13: "etapa", 14: "status_vivensis",
    15: "data_lead", 16: "data_primeiro_contato", 17: "data_apresentacao",
    18: "data_interesse", 19: "data_cadastro", 20: "data_inicio_cred", 21: "data_cred",
    22: "data_primeira_venda", 23: "ativacoes_mes", 24: "ativacoes_acum",
    25: "data_ultima_venda", 27: "motivo_perda", 28: "observacoes", 33: "canal",
}


def seed_territorios(wb):
    """Carrega a tabela Municipio|UF -> Responsavel da aba Listas (colunas N/O/P a partir da linha 4)."""
    if "Listas" not in wb.sheetnames:
        return 0
    ws = wb["Listas"]
    conn = db.get_conn()
    n = 0
    for r in range(4, ws.max_row + 1):
        mun = ws.cell(row=r, column=14).value   # N
        uf = ws.cell(row=r, column=15).value    # O
        resp = ws.cell(row=r, column=16).value  # P
        if not mun or not uf:
            continue
        chave = f"{listas.norm(str(mun))}|{str(uf).strip().upper()}"
        conn.execute(
            "INSERT OR REPLACE INTO territorios (municipio, uf, responsavel, chave) VALUES (?,?,?,?)",
            (str(mun).strip(), str(uf).strip().upper(), str(resp or "").strip(), chave),
        )
        n += 1
    conn.commit()
    return n


def seed_from_existing():
    """Popula o banco a partir de Gestao_Prospeccao_Revendas_Starlink.xlsx. Retorna qtd. importada.

    TRAVA ANTI-DUPLA-FONTE: a fonte oficial é a plataforma na nuvem (Worker + D1),
    não esta planilha-protótipo (obsoleta). Para evitar reconstruir uma base local
    divergente, este seed só roda com opt-in explícito: PERMITIR_SEED_LEGADO=1.
    """
    if os.environ.get("PERMITIR_SEED_LEGADO") != "1":
        return {"ok": False, "motivo": "seed legado desativado (defina PERMITIR_SEED_LEGADO=1 para forçar)", "importadas": 0}
    if not os.path.exists(PLANILHA_ATUAL):
        return {"ok": False, "motivo": "planilha nao encontrada", "importadas": 0}
    wb = openpyxl.load_workbook(PLANILHA_ATUAL, data_only=True)
    seed_territorios(wb)
    if "Revendas" not in wb.sheetnames:
        return {"ok": False, "motivo": "aba Revendas ausente", "importadas": 0}
    ws = wb["Revendas"]
    importadas = 0
    for r in range(2, ws.max_row + 1):
        raw = {}
        for col, field in _REV_MAP.items():
            raw[field] = ws.cell(row=r, column=col).value
        if not (raw.get("codigo") or raw.get("nome_fantasia") or raw.get("cnpj")):
            continue
        d = clean_row(raw)
        d["razao_social"] = d.get("nome_fantasia", "")
        d["status"] = listas.status_a_partir_de(d.get("etapa"), d.get("status_vivensis"), d.get("motivo_perda"))
        if not d.get("canal"):
            d["canal"] = "Telecom"
        enrich(d)
        insert_empresa(d, dedupe=True)
        importadas += 1
    return {"ok": True, "importadas": importadas}


# ---------------- CRUD base usado pelo import/seed ----------------
def insert_empresa(d, dedupe=True):
    conn = db.get_conn()
    d = dict(d)
    d["cnpj_norm"] = cnpj_norm(d.get("cnpj"))
    now = today_iso()
    if dedupe and d["cnpj_norm"]:
        ex = conn.execute("SELECT id FROM empresas WHERE cnpj_norm=?", (d["cnpj_norm"],)).fetchone()
        if ex:
            return update_empresa(ex["id"], d), "atualizada"
    campos = [f for f in db.EMPRESA_CAMPOS if f in d] + ["cnpj_norm", "criado_em", "atualizado_em"]
    vals = [d.get(f) for f in campos[:-3]] + [d["cnpj_norm"], now, d.get("atualizado_em") or now]
    ph = ",".join("?" * len(campos))
    cur = conn.execute(f"INSERT INTO empresas ({','.join(campos)}) VALUES ({ph})", vals)
    conn.commit()
    return cur.lastrowid, "inserida"


def update_empresa(emp_id, d):
    conn = db.get_conn()
    d = dict(d)
    sets, vals = [], []
    for f in db.EMPRESA_CAMPOS:
        if f in d:
            sets.append(f"{f}=?")
            vals.append(d[f])
    if "cnpj" in d:
        sets.append("cnpj_norm=?")
        vals.append(cnpj_norm(d.get("cnpj")))
    sets.append("atualizado_em=?")
    vals.append(today_iso())
    vals.append(emp_id)
    conn.execute(f"UPDATE empresas SET {','.join(sets)} WHERE id=?", vals)
    conn.commit()
    return emp_id


# ---------------- exportacao / modelo ----------------
_HDR_FILL = PatternFill("solid", fgColor="1F3A5F")
_HDR_FONT = Font(bold=True, color="FFFFFF")


def _write_header(ws, fields):
    for i, f in enumerate(fields, start=1):
        c = ws.cell(row=1, column=i, value=FIELD_LABELS.get(f, f))
        c.fill = _HDR_FILL
        c.font = _HDR_FONT
        c.alignment = Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[c.column_letter].width = max(14, min(32, len(FIELD_LABELS.get(f, f)) + 2))
    ws.freeze_panes = "A2"


def _add_validations(ws, fields, nrows=400):
    """Dropdowns de valores validos nas colunas de enumeracao."""
    enum_cols = {
        "uf": listas.UFS, "canal": listas.CANAIS, "responsavel": listas.RESPONSAVEIS,
        "status": listas.STATUS, "status_vivensis": listas.STATUS_VIVENSIS,
        "etapa": listas.ETAPAS_FUNIL, "origem_contato": listas.ORIGENS,
        "motivo_perda": listas.MOTIVOS_PERDA,
    }
    bool_opts = ["Sim", "Não"]
    for i, f in enumerate(fields, start=1):
        opts = None
        if f in enum_cols:
            opts = enum_cols[f]
        elif f in BOOL_FIELDS:
            opts = bool_opts
        if not opts:
            continue
        col = ws.cell(row=1, column=i).column_letter
        dv = DataValidation(type="list", formula1='"' + ",".join(opts) + '"', allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(f"{col}2:{col}{nrows}")


def _row_values(emp, fields):
    out = []
    for f in fields:
        v = emp.get(f, "")
        if f in DATE_FIELDS:
            v = fmt_date_br(v)
        elif f in BOOL_FIELDS:
            v = "Sim" if v else "Não"
        out.append("" if v is None else v)
    return out


def export_rows(rows):
    """Gera um .xlsx (bytes) com as empresas informadas."""
    fields = db.EMPRESA_CAMPOS
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Lojistas"
    _write_header(ws, fields)
    for emp in rows:
        ws.append(_row_values(emp, fields))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_template():
    """Modelo de planilha padronizado (com dropdowns e 1 linha de exemplo)."""
    fields = db.EMPRESA_CAMPOS
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Lojistas"
    _write_header(ws, fields)
    _add_validations(ws, fields)
    exemplo = {
        "razao_social": "EXEMPLO - Conecta Norte LTDA", "nome_fantasia": "Conecta Norte",
        "cnpj": "12.345.678/0001-01", "telefone_comercial": "(91) 99999-0001",
        "cidade": "Marabá", "uf": "PA", "segmento": "Provedor de internet",
        "status": "Prospectado", "canal": "Telecom", "trabalha_telecom": 1,
        "origem_contato": "Prospecção ativa",
    }
    ws.append(_row_values({f: exemplo.get(f, "") for f in fields}, fields))
    # aba de instrucoes
    wsi = wb.create_sheet("Instruções")
    instr = [
        "COMO USAR ESTE MODELO",
        "",
        "1. Preencha uma linha por lojista na aba 'Lojistas'.",
        "2. Campos com seta (dropdown) têm valores padronizados — use-os.",
        "3. O CNPJ é o identificador único: se já existir no sistema, o registro é ATUALIZADO (não duplica).",
        "4. Datas no formato DD/MM/AAAA. Campos Sim/Não aceitam também 1/0.",
        "5. Microrregião e Responsável comercial são preenchidos automaticamente pelo município, se deixados em branco.",
        "6. Salve o arquivo e use 'Importar Excel' na plataforma.",
    ]
    for i, t in enumerate(instr, start=1):
        c = wsi.cell(row=i, column=1, value=t)
        if i == 1:
            c.font = Font(bold=True, size=13)
    wsi.column_dimensions["A"].width = 100
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def import_file(data_bytes):
    """Importa um .xlsx (bytes). Dedupe por CNPJ. Retorna resumo."""
    wb = openpyxl.load_workbook(io.BytesIO(data_bytes), data_only=True)
    ws = wb["Lojistas"] if "Lojistas" in wb.sheetnames else wb.active
    # mapeia cabecalhos -> campos
    headers = {}
    for c in range(1, ws.max_column + 1):
        h = ws.cell(row=1, column=c).value
        if h is None:
            continue
        field = LABEL_TO_FIELD.get(listas.norm(str(h)))
        if field:
            headers[c] = field
    if not headers:
        return {"ok": False, "motivo": "cabeçalhos não reconhecidos", "inseridas": 0, "atualizadas": 0, "erros": []}
    inseridas = atualizadas = 0
    erros = []
    for r in range(2, ws.max_row + 1):
        raw = {headers[c]: ws.cell(row=r, column=c).value for c in headers}
        if not any(str(v).strip() for v in raw.values() if v is not None):
            continue
        if not (raw.get("razao_social") or raw.get("nome_fantasia") or raw.get("cnpj")):
            erros.append(f"Linha {r}: sem razão social/nome fantasia/CNPJ — ignorada")
            continue
        try:
            d = clean_row(raw)
            if not d.get("razao_social"):
                d["razao_social"] = d.get("nome_fantasia", "")
            if not d.get("status"):
                d["status"] = "Prospectado"
            if not d.get("canal"):
                d["canal"] = "Telecom"
            enrich(d)
            _id, acao = insert_empresa(d, dedupe=True)
            if acao == "inserida":
                inseridas += 1
            else:
                atualizadas += 1
        except Exception as e:  # noqa: BLE001
            erros.append(f"Linha {r}: {e}")
    return {"ok": True, "inseridas": inseridas, "atualizadas": atualizadas, "erros": erros}
