# -*- coding: utf-8 -*-
"""Servidor da plataforma de prospeccao Starlink (Bradel).

Flask + SQLite (arquivo unico). Serve a SPA e a API JSON: CRUD de empresas,
filiais e contatos, inteligencia geografica/mapa, dashboard, filtros, pesquisa
e importacao/exportacao em Excel. Sem dependencias externas de rede (mapa SVG).
"""
import csv
import datetime as dt
import io
import math
import re

from flask import Flask, jsonify, render_template, request, send_file, abort

from . import db, geo
from . import listas as L

app = Flask(__name__, static_folder="static", template_folder="templates")

# Colunas aceitas da empresa (subconjunto editavel; metricas do funil ficam de fora da edicao manual)
_CAMPOS_TEXTO = {
    "codigo", "razao_social", "nome_fantasia", "cnpj", "inscricao_estadual",
    "telefone_comercial", "whatsapp", "email_comercial", "site_instagram",
    "endereco", "cep", "cidade", "uf", "microrregiao",
    "resp_nome", "resp_cargo", "resp_telefone", "resp_whatsapp", "resp_email",
    "segmento", "produtos", "capacidade_vendas_mes", "interesse_parceiro",
    "origem_contato", "canal", "responsavel", "prioridade", "status",
    "status_vivensis", "motivo_perda", "observacoes",
    "proxima_acao", "proxima_acao_data", "data_ultimo_contato",
}
_CAMPOS_BOOL = {"trabalha_telecom", "ja_starlink", "exp_antenas", "equipe_tecnica", "loja_fisica"}
_CAMPOS_INT = {"qtd_filiais", "ativacoes_mes", "ativacoes_acum"}
_CAMPOS_FLOAT = {"latitude", "longitude"}


# --------------------------------------------------------------------------
# Utilitarios
# --------------------------------------------------------------------------
def agora():
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def hoje():
    return dt.date.today().strftime("%Y-%m-%d")


def so_digitos(s):
    return re.sub(r"\D", "", s or "")


def to_bool_int(v):
    if isinstance(v, bool):
        return 1 if v else 0
    if v in (1, "1", "sim", "Sim", "SIM", "true", "True", True):
        return 1
    return 0


def to_int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def to_float(v):
    try:
        if v in (None, ""):
            return None
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def limpar(v):
    return (v or "").strip() if isinstance(v, str) else v


# --------------------------------------------------------------------------
# Montagem/normalizacao de empresa a partir do payload
# --------------------------------------------------------------------------
def montar_empresa(data, novo=True):
    e = {}
    for k in _CAMPOS_TEXTO:
        if k in data:
            e[k] = limpar(data.get(k)) or ""
    for k in _CAMPOS_BOOL:
        if k in data:
            e[k] = to_bool_int(data.get(k))
    for k in _CAMPOS_INT:
        if k in data:
            e[k] = to_int(data.get(k))
    for k in _CAMPOS_FLOAT:
        if k in data:
            e[k] = to_float(data.get(k))

    # Microrregiao automatica a partir do municipio + UF
    muni = e.get("cidade") or data.get("cidade")
    uf = (e.get("uf") or data.get("uf") or "").upper()
    if uf:
        e["uf"] = uf
    if (not e.get("microrregiao")) and muni:
        mr = geo.microrregiao_de(muni, uf or None)
        if mr:
            e["microrregiao"] = mr
            if not uf:
                v = geo.lookup_municipio(muni)
                if v:
                    e["uf"] = v["uf"]

    # Normalizacao de CNPJ (identificador unico)
    if "cnpj" in e:
        e["cnpj_norm"] = so_digitos(e["cnpj"])

    if novo:
        e.setdefault("status", "Prospectado")
        e.setdefault("canal", "Telecom")
        e.setdefault("status_vivensis", "Sem credenciamento")
        e["criado_em"] = agora()
        if not e.get("data_lead"):
            e["data_lead"] = hoje()
    e["atualizado_em"] = agora()
    return e


def empresa_dup_cnpj(cnpj_norm, excluir_id=None):
    if not cnpj_norm:
        return None
    conn = db.get_conn()
    if excluir_id:
        row = conn.execute(
            "SELECT id FROM empresas WHERE cnpj_norm=? AND id<>?",
            (cnpj_norm, excluir_id)).fetchone()
    else:
        row = conn.execute(
            "SELECT id FROM empresas WHERE cnpj_norm=?", (cnpj_norm,)).fetchone()
    return row["id"] if row else None


def proximo_codigo():
    conn = db.get_conn()
    row = conn.execute(
        "SELECT codigo FROM empresas WHERE codigo LIKE 'REV-%' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    n = 0
    if row and row["codigo"]:
        m = re.search(r"(\d+)", row["codigo"])
        if m:
            n = int(m.group(1))
    return f"REV-{n + 1:03d}"


def inserir_empresa(e):
    conn = db.get_conn()
    cols = [c for c in db.EMPRESA_CAMPOS if c in e] + \
           [c for c in ("cnpj_norm", "criado_em", "atualizado_em") if c in e]
    placeholders = ",".join("?" for _ in cols)
    sql = f"INSERT INTO empresas ({','.join(cols)}) VALUES ({placeholders})"
    cur = conn.execute(sql, [e[c] for c in cols])
    conn.commit()
    return cur.lastrowid


def atualizar_empresa(eid, e):
    conn = db.get_conn()
    cols = [c for c in e.keys() if c != "id"]
    sets = ",".join(f"{c}=?" for c in cols)
    conn.execute(f"UPDATE empresas SET {sets} WHERE id=?", [e[c] for c in cols] + [eid])
    conn.commit()


def empresa_dict(row):
    d = db.row_to_dict(row)
    if d:
        d["cor"] = L.cor_do_status(d.get("status"))
        d["cor_hex"] = L.COR_HEX.get(d["cor"], L.COR_HEX["cinza"])
    return d


# --------------------------------------------------------------------------
# Filtros de listagem
# --------------------------------------------------------------------------
def construir_where(args):
    where, params = [], []
    uf = limpar(args.get("uf"))
    if uf:
        where.append("uf=?"); params.append(uf.upper())
    mr = limpar(args.get("microrregiao"))
    if mr:
        where.append("microrregiao=?"); params.append(mr)
    muni = limpar(args.get("municipio"))
    if muni:
        where.append("cidade=?"); params.append(muni)
    seg = limpar(args.get("segmento"))
    if seg:
        where.append("segmento=?"); params.append(seg)
    status = limpar(args.get("status"))
    if status:
        where.append("status=?"); params.append(status)
    canal = limpar(args.get("canal"))
    if canal:
        where.append("canal=?"); params.append(canal)
    resp = limpar(args.get("responsavel"))
    if resp:
        where.append("responsavel=?"); params.append(resp)
    prio = limpar(args.get("prioridade"))
    if prio:
        where.append("prioridade=?"); params.append(prio)
    if args.get("credenciado") in ("1", "true", "sim"):
        where.append("status='Credenciado'")
    if args.get("potencial") in ("1", "true", "sim"):
        where.append("status IN ('Prospectado','Primeiro contato realizado','Em negociação','Interessado')")
    if args.get("telecom") in ("1", "true", "sim"):
        where.append("(trabalha_telecom=1 OR ja_starlink=1)")
    q = limpar(args.get("q"))
    if q:
        like = f"%{q}%"
        where.append("(razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ? "
                     "OR resp_nome LIKE ? OR codigo LIKE ? OR cidade LIKE ?)")
        params += [like] * 6
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return clause, params


# --------------------------------------------------------------------------
# Rotas - pagina
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/bootstrap")
def bootstrap():
    """Listas, cores e rotulos para iniciar o front (geometria vem por UF em /api/geo)."""
    nomes = {}
    for uf in L.UFS:
        est = geo.estado(uf)
        nomes[uf] = est["nome"] if est else uf
    return jsonify({
        "ufs": L.UFS,
        "uf_nomes": nomes,
        "status": L.STATUS,
        "status_vivensis": L.STATUS_VIVENSIS,
        "canais": L.CANAIS,
        "responsaveis": L.RESPONSAVEIS,
        "origens": L.ORIGENS,
        "motivos_perda": L.MOTIVOS_PERDA,
        "tipos_contato": L.TIPOS_CONTATO,
        "segmentos": L.SEGMENTOS,
        "prioridades": L.PRIORIDADES,
        "interesse": L.INTERESSE,
        "status_cor": L.STATUS_COR,
        "cor_hex": L.COR_HEX,
        "cor_label": L.COR_LABEL,
        "map": {
            "dims": geo.overview_dims(),
            "regions": geo.overview_regions(),
        },
    })


@app.route("/api/geo/<uf>")
def geo_uf(uf):
    """Geometria do estado: municipios (poligonos) e regioes (microrregioes)."""
    est = geo.estado(uf)
    if not est:
        abort(404)
    return jsonify({
        "uf": est["uf"], "nome": est["nome"], "w": est["w"], "h": est["h"],
        "municipios": [{"n": m["n"], "rg": m.get("rg", ""), "d": m["d"]} for m in est["municipios"]],
        "regioes": [{"n": r["n"], "d": r["d"]} for r in est.get("regioes", [])],
    })


# --------------------------------------------------------------------------
# Rotas - empresas
# --------------------------------------------------------------------------
@app.route("/api/empresas")
def listar_empresas():
    clause, params = construir_where(request.args)
    conn = db.get_conn()
    rows = conn.execute(
        f"SELECT * FROM empresas{clause} ORDER BY razao_social COLLATE NOCASE", params
    ).fetchall()
    return jsonify([empresa_dict(r) for r in rows])


@app.route("/api/empresas/<int:eid>")
def obter_empresa(eid):
    conn = db.get_conn()
    row = conn.execute("SELECT * FROM empresas WHERE id=?", (eid,)).fetchone()
    if not row:
        abort(404)
    e = empresa_dict(row)
    e["filiais"] = [db.row_to_dict(r) for r in conn.execute(
        "SELECT * FROM filiais WHERE empresa_id=? ORDER BY id", (eid,)).fetchall()]
    e["contatos"] = [db.row_to_dict(r) for r in conn.execute(
        "SELECT * FROM contatos WHERE empresa_id=? ORDER BY data DESC, id DESC", (eid,)).fetchall()]
    return jsonify(e)


@app.route("/api/empresas", methods=["POST"])
def criar_empresa():
    data = request.get_json(force=True, silent=True) or {}
    if not limpar(data.get("razao_social")) and not limpar(data.get("nome_fantasia")):
        return jsonify({"erro": "Informe ao menos a razão social ou o nome fantasia."}), 400
    e = montar_empresa(data, novo=True)
    dup = empresa_dup_cnpj(e.get("cnpj_norm"))
    if dup:
        return jsonify({"erro": "Já existe uma empresa com este CNPJ.", "id": dup}), 409
    if not e.get("codigo"):
        e["codigo"] = proximo_codigo()
    eid = inserir_empresa(e)
    return jsonify({"id": eid}), 201


@app.route("/api/empresas/<int:eid>", methods=["PUT"])
def editar_empresa(eid):
    conn = db.get_conn()
    if not conn.execute("SELECT 1 FROM empresas WHERE id=?", (eid,)).fetchone():
        abort(404)
    data = request.get_json(force=True, silent=True) or {}
    e = montar_empresa(data, novo=False)
    dup = empresa_dup_cnpj(e.get("cnpj_norm"), excluir_id=eid)
    if dup:
        return jsonify({"erro": "Outra empresa já usa este CNPJ.", "id": dup}), 409
    atualizar_empresa(eid, e)
    return jsonify({"id": eid})


@app.route("/api/empresas/<int:eid>", methods=["DELETE"])
def excluir_empresa(eid):
    conn = db.get_conn()
    conn.execute("DELETE FROM empresas WHERE id=?", (eid,))
    conn.commit()
    return jsonify({"ok": True})


@app.route("/api/empresas/<int:eid>/status", methods=["PATCH"])
def mudar_status(eid):
    data = request.get_json(force=True, silent=True) or {}
    novo = limpar(data.get("status"))
    if novo not in L.STATUS:
        return jsonify({"erro": "Status inválido."}), 400
    conn = db.get_conn()
    extra, vals = "", []
    if "motivo_perda" in data:
        extra = ", motivo_perda=?"; vals.append(limpar(data.get("motivo_perda")))
    conn.execute(f"UPDATE empresas SET status=?, atualizado_em=?{extra} WHERE id=?",
                 [novo, agora()] + vals + [eid])
    conn.commit()
    return jsonify({"id": eid, "status": novo, "cor": L.cor_do_status(novo)})


# --------------------------------------------------------------------------
# Contatos (historico) e filiais
# --------------------------------------------------------------------------
@app.route("/api/empresas/<int:eid>/contatos", methods=["POST"])
def add_contato(eid):
    data = request.get_json(force=True, silent=True) or {}
    conn = db.get_conn()
    conn.execute(
        "INSERT INTO contatos (empresa_id,data,tipo,responsavel,resumo,proxima_acao,proxima_acao_data,criado_em) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (eid, limpar(data.get("data")) or hoje(), limpar(data.get("tipo")),
         limpar(data.get("responsavel")), limpar(data.get("resumo")),
         limpar(data.get("proxima_acao")), limpar(data.get("proxima_acao_data")), agora()))
    # atualiza data do ultimo contato e proxima acao na empresa
    conn.execute(
        "UPDATE empresas SET data_ultimo_contato=?, proxima_acao=?, proxima_acao_data=?, atualizado_em=? WHERE id=?",
        (limpar(data.get("data")) or hoje(), limpar(data.get("proxima_acao")),
         limpar(data.get("proxima_acao_data")), agora(), eid))
    conn.commit()
    return jsonify({"ok": True}), 201


@app.route("/api/contatos/<int:cid>", methods=["DELETE"])
def del_contato(cid):
    conn = db.get_conn()
    conn.execute("DELETE FROM contatos WHERE id=?", (cid,))
    conn.commit()
    return jsonify({"ok": True})


@app.route("/api/empresas/<int:eid>/filiais", methods=["POST"])
def add_filial(eid):
    data = request.get_json(force=True, silent=True) or {}
    conn = db.get_conn()
    conn.execute(
        "INSERT INTO filiais (empresa_id,nome,cnpj,endereco,cidade,uf,telefone,obs) VALUES (?,?,?,?,?,?,?,?)",
        (eid, limpar(data.get("nome")), limpar(data.get("cnpj")), limpar(data.get("endereco")),
         limpar(data.get("cidade")), (limpar(data.get("uf")) or "").upper(),
         limpar(data.get("telefone")), limpar(data.get("obs"))))
    conn.execute("UPDATE empresas SET qtd_filiais=(SELECT COUNT(*) FROM filiais WHERE empresa_id=?) WHERE id=?",
                 (eid, eid))
    conn.commit()
    return jsonify({"ok": True}), 201


@app.route("/api/filiais/<int:fid>", methods=["DELETE"])
def del_filial(fid):
    conn = db.get_conn()
    row = conn.execute("SELECT empresa_id FROM filiais WHERE id=?", (fid,)).fetchone()
    conn.execute("DELETE FROM filiais WHERE id=?", (fid,))
    if row:
        conn.execute("UPDATE empresas SET qtd_filiais=(SELECT COUNT(*) FROM filiais WHERE empresa_id=?) WHERE id=?",
                     (row["empresa_id"], row["empresa_id"]))
    conn.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
# Mapa e dashboard
# --------------------------------------------------------------------------
_GOLDEN = 2.399963229728653  # angulo aureo para espalhar marcadores


def _jitter(k):
    """Deslocamento (dx,dy) em espiral de Vogel para o k-esimo ponto de uma regiao."""
    if k == 0:
        return 0.0, 0.0
    r = 7.0 * math.sqrt(k)
    a = k * _GOLDEN
    return r * math.cos(a), r * math.sin(a)


@app.route("/api/mapa")
def mapa():
    """Dados do mapa nacional (overview): agregado por microrregiao + marcadores por
    empresa posicionados no centroide da microrregiao (coords do overview)."""
    clause, params = construir_where(request.args)
    conn = db.get_conn()
    rows = conn.execute(
        f"SELECT id,razao_social,nome_fantasia,cidade,uf,microrregiao,status FROM empresas{clause}",
        params).fetchall()
    regioes = {}          # "UF|regiao" -> {count, credenciados, por_cor:{}}
    marcadores = []
    grupo = {}            # (uf,regiao) -> contador para jitter
    for r in rows:
        uf = (r["uf"] or "").upper()
        mr = r["microrregiao"] or ""
        status = r["status"] or ""
        cor = L.cor_do_status(status)
        chave = f"{uf}|{mr}"
        agg = regioes.setdefault(chave, {"uf": uf, "microrregiao": mr, "count": 0,
                                         "credenciados": 0, "por_cor": {}})
        agg["count"] += 1
        if status == "Credenciado":
            agg["credenciados"] += 1
        agg["por_cor"][cor] = agg["por_cor"].get(cor, 0) + 1
        cent = geo.centroide_regiao(uf, mr)
        if cent:
            k = grupo.get((uf, mr), 0)
            grupo[(uf, mr)] = k + 1
            dx, dy = _jitter(k)
            marcadores.append({
                "id": r["id"],
                "nome": r["nome_fantasia"] or r["razao_social"],
                "uf": uf, "microrregiao": mr, "municipio": r["cidade"],
                "status": status, "cor": cor, "hex": L.COR_HEX.get(cor, L.COR_HEX["cinza"]),
                "x": round(cent["cx"] + dx, 1), "y": round(cent["cy"] + dy, 1),
            })
    maxc = max((a["count"] for a in regioes.values()), default=0)
    return jsonify({"regioes": regioes, "marcadores": marcadores, "max": maxc})


@app.route("/api/dashboard")
def dashboard():
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM empresas").fetchall()
    total = len(rows)
    por_status = {s: 0 for s in L.STATUS}
    por_uf = {u: 0 for u in L.UFS}
    por_segmento = {}
    municipios, microrregioes = set(), set()
    credenciados = em_negociacao = aguardando = potenciais = perdidos = 0
    for r in rows:
        st = r["status"] or ""
        por_status[st] = por_status.get(st, 0) + 1
        uf = (r["uf"] or "").upper()
        if uf:
            por_uf[uf] = por_uf.get(uf, 0) + 1
        seg = r["segmento"] or "—"
        por_segmento[seg] = por_segmento.get(seg, 0) + 1
        if r["cidade"]:
            municipios.add((uf, (r["cidade"] or "").strip().lower()))
        if r["microrregiao"]:
            microrregioes.add((uf, r["microrregiao"]))
        cor = L.cor_do_status(st)
        if st == "Credenciado":
            credenciados += 1
        elif cor == "amarelo":
            em_negociacao += 1
        elif cor == "laranja":
            aguardando += 1
        elif cor == "azul":
            potenciais += 1
        elif cor == "vermelho":
            perdidos += 1
    taxa = round(100.0 * credenciados / total, 1) if total else 0.0
    return jsonify({
        "total": total,
        "potenciais": potenciais,
        "credenciados": credenciados,
        "em_negociacao": em_negociacao,
        "aguardando": aguardando,
        "perdidos": perdidos,
        "municipios": len(municipios),
        "microrregioes": len(microrregioes),
        "taxa_conversao": taxa,
        "por_status": por_status,
        "por_uf": por_uf,
        "por_segmento": dict(sorted(por_segmento.items(), key=lambda kv: -kv[1])),
    })


@app.route("/api/municipios")
def municipios():
    return jsonify(geo.lista_municipios(limpar(request.args.get("uf"))))


@app.route("/api/microrregioes")
def microrregioes():
    return jsonify(geo.lista_microrregioes(limpar(request.args.get("uf"))))


# --------------------------------------------------------------------------
# Importacao / exportacao Excel
# --------------------------------------------------------------------------
# Cabecalhos do modelo padronizado (ordem) -> coluna no banco
MODELO_COLS = [
    ("Razão social", "razao_social"),
    ("Nome fantasia", "nome_fantasia"),
    ("CNPJ", "cnpj"),
    ("Inscrição estadual", "inscricao_estadual"),
    ("Telefone comercial", "telefone_comercial"),
    ("WhatsApp", "whatsapp"),
    ("E-mail comercial", "email_comercial"),
    ("Site / Instagram", "site_instagram"),
    ("Endereço", "endereco"),
    ("CEP", "cep"),
    ("Cidade", "cidade"),
    ("UF", "uf"),
    ("Microrregião", "microrregiao"),
    ("Latitude", "latitude"),
    ("Longitude", "longitude"),
    ("Responsável (nome)", "resp_nome"),
    ("Responsável (cargo)", "resp_cargo"),
    ("Responsável (telefone)", "resp_telefone"),
    ("Responsável (WhatsApp)", "resp_whatsapp"),
    ("Responsável (e-mail)", "resp_email"),
    ("Segmento", "segmento"),
    ("Produtos", "produtos"),
    ("Trabalha com telecom?", "trabalha_telecom"),
    ("Já comercializa Starlink?", "ja_starlink"),
    ("Experiência com antenas?", "exp_antenas"),
    ("Equipe técnica?", "equipe_tecnica"),
    ("Loja física?", "loja_fisica"),
    ("Qtd. filiais", "qtd_filiais"),
    ("Capacidade de vendas/mês", "capacidade_vendas_mes"),
    ("Interesse em ser parceiro", "interesse_parceiro"),
    ("Origem do contato", "origem_contato"),
    ("Canal", "canal"),
    ("Responsável interno", "responsavel"),
    ("Prioridade", "prioridade"),
    ("Status comercial", "status"),
    ("Observações", "observacoes"),
]


@app.route("/api/modelo.xlsx")
def modelo_xlsx():
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = "Empresas"
    fill = PatternFill("solid", fgColor="1F4E78")
    font = Font(color="FFFFFF", bold=True)
    for c, (titulo, _col) in enumerate(MODELO_COLS, start=1):
        cell = ws.cell(1, c, titulo)
        cell.fill = fill
        cell.font = font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[ws.cell(1, c).column_letter].width = 20
    ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="modelo_empresas_starlink.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.route("/api/export.xlsx")
def export_xlsx():
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    clause, params = construir_where(request.args)
    conn = db.get_conn()
    rows = conn.execute(
        f"SELECT * FROM empresas{clause} ORDER BY razao_social COLLATE NOCASE", params).fetchall()
    wb = Workbook()
    ws = wb.active
    ws.title = "Empresas"
    cabecalhos = ["Código"] + [t for t, _ in MODELO_COLS]
    cols = ["codigo"] + [c for _, c in MODELO_COLS]
    fill = PatternFill("solid", fgColor="1F4E78")
    font = Font(color="FFFFFF", bold=True)
    for c, titulo in enumerate(cabecalhos, start=1):
        cell = ws.cell(1, c, titulo)
        cell.fill = fill
        cell.font = font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for r, row in enumerate(rows, start=2):
        for c, col in enumerate(cols, start=1):
            v = row[col] if col in row.keys() else ""
            if col in _CAMPOS_BOOL:
                v = "Sim" if v else "Não"
            ws.cell(r, c, v)
    ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="empresas_starlink.xlsx",
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def _linha_para_empresa(d):
    """Normaliza um dict (cabecalho do modelo -> valor) em payload de empresa."""
    # aceita tanto o nome amigavel quanto a coluna do banco
    titulo_para_col = {t.strip().lower(): c for t, c in MODELO_COLS}
    out = {}
    for k, v in d.items():
        key = (k or "").strip().lower()
        col = titulo_para_col.get(key, key if key in (
            {c for _, c in MODELO_COLS} | _CAMPOS_TEXTO) else None)
        if col:
            out[col] = v
    return out


@app.route("/api/import", methods=["POST"])
def importar():
    f = request.files.get("arquivo")
    if not f:
        return jsonify({"erro": "Envie um arquivo .xlsx ou .csv no campo 'arquivo'."}), 400
    nome = (f.filename or "").lower()
    registros = []
    if nome.endswith(".csv"):
        texto = f.read().decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(texto))
        registros = [dict(r) for r in reader]
    else:
        from openpyxl import load_workbook
        wb = load_workbook(f, data_only=True)
        ws = wb.active
        headers = [str(c.value).strip() if c.value is not None else "" for c in ws[1]]
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not any(v not in (None, "") for v in row):
                continue
            registros.append({headers[i]: row[i] for i in range(len(headers)) if headers[i]})

    criados = atualizados = ignorados = 0
    erros = []
    for i, bruto in enumerate(registros, start=2):
        data = _linha_para_empresa(bruto)
        nome_emp = limpar(data.get("razao_social")) or limpar(data.get("nome_fantasia"))
        if not nome_emp:
            ignorados += 1
            continue
        e = montar_empresa(data, novo=True)
        dup = empresa_dup_cnpj(e.get("cnpj_norm"))
        try:
            if dup:
                e2 = montar_empresa(data, novo=False)
                atualizar_empresa(dup, e2)
                atualizados += 1
            else:
                if not e.get("codigo"):
                    e["codigo"] = proximo_codigo()
                inserir_empresa(e)
                criados += 1
        except Exception as ex:  # noqa: BLE001
            erros.append(f"Linha {i}: {ex}")
    return jsonify({"criados": criados, "atualizados": atualizados,
                    "ignorados": ignorados, "erros": erros})


def criar_app():
    db.init_db()
    return app
