# -*- coding: utf-8 -*-
"""Importa as revendas da planilha Gestao_Prospeccao_Revendas_Starlink.xlsx para o banco.

Mapeia as colunas da aba 'Revendas' para o modelo da plataforma, deriva o status
comercial (brief) a partir da etapa/Status Vivensis e preenche a microrregiao pelo
municipio. Idempotente: pula revendas cujo codigo ja existe.

Uso:  python -m tools.seed_from_excel
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openpyxl import load_workbook

from app import db, geo
from app import listas as L

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(BASE, "Gestao_Prospeccao_Revendas_Starlink.xlsx")

# coluna da planilha (1-based) -> campo do banco
MAP = {
    1: "codigo", 2: "nome_fantasia", 3: "cnpj", 4: "resp_nome", 5: "telefone_comercial",
    6: "email_comercial", 7: "cidade", 8: "uf", 9: "microrregiao", 10: "prioridade",
    11: "responsavel", 12: "origem_contato", 13: "etapa", 14: "status_vivensis",
    15: "data_lead", 16: "data_primeiro_contato", 17: "data_apresentacao",
    18: "data_interesse", 19: "data_cadastro", 20: "data_inicio_cred", 21: "data_cred",
    22: "data_primeira_venda", 23: "ativacoes_mes", 24: "ativacoes_acum",
    25: "data_ultima_venda", 27: "motivo_perda", 28: "observacoes", 33: "canal",
}
DATAS = {"data_lead", "data_primeiro_contato", "data_apresentacao", "data_interesse",
         "data_cadastro", "data_inicio_cred", "data_cred", "data_primeira_venda",
         "data_ultima_venda"}


def _fmt(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    return str(v).strip() if v not in (None, "") else ""


def seed(path=XLSX):
    if not os.path.exists(path):
        print(f"[seed] planilha não encontrada: {path}")
        return 0
    db.init_db()
    conn = db.get_conn()
    wb = load_workbook(path, data_only=True)
    ws = wb["Revendas"]

    novos = 0
    for r in range(2, ws.max_row + 1):
        nome = ws.cell(r, 2).value
        if not nome:
            continue
        e = {}
        for col, campo in MAP.items():
            v = ws.cell(r, col).value
            if campo in DATAS:
                e[campo] = _fmt(v)
            elif campo in ("ativacoes_mes", "ativacoes_acum"):
                try:
                    e[campo] = int(v) if v not in (None, "") else 0
                except (TypeError, ValueError):
                    e[campo] = 0
            else:
                e[campo] = _fmt(v)

        codigo = e.get("codigo") or ""
        if codigo and conn.execute("SELECT 1 FROM empresas WHERE codigo=?", (codigo,)).fetchone():
            continue  # idempotente

        e["razao_social"] = e.get("nome_fantasia", "")
        e["cnpj_norm"] = "".join(c for c in (e.get("cnpj") or "") if c.isdigit())
        # microrregiao automatica se vazia
        if not e.get("microrregiao") and e.get("cidade"):
            mr = geo.microrregiao_de(e["cidade"], e.get("uf") or None)
            if mr:
                e["microrregiao"] = mr
        # status comercial derivado
        e["status"] = L.status_a_partir_de(e.get("etapa"), e.get("status_vivensis"), e.get("motivo_perda"))
        e["trabalha_telecom"] = 1 if (e.get("canal") == "Telecom") else 0
        e["ja_starlink"] = 1 if (e.get("status_vivensis") == "Credenciada") else 0
        agora = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        e["criado_em"] = agora
        e["atualizado_em"] = agora

        cols = [c for c in db.EMPRESA_CAMPOS if c in e] + ["cnpj_norm", "criado_em", "atualizado_em"]
        placeholders = ",".join("?" for _ in cols)
        conn.execute(f"INSERT INTO empresas ({','.join(cols)}) VALUES ({placeholders})",
                     [e[c] for c in cols])
        novos += 1

    conn.commit()
    print(f"[seed] {novos} revenda(s) importada(s). Total no banco: {db.empresas_count()}")
    return novos


if __name__ == "__main__":
    seed()
