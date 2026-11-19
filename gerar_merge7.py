# -*- coding: utf-8 -*-
"""Merge dos 7 pares duplicados com MESMO id_vsm (gravado float vs int).
Chave: id (UNICO). survivor = ficha com identidade correta + progresso comercial
(origem Formulario/Prospeccao); victim = ficha VSM "Aguardando contato".

Consolidacao survivor-first: survivor mantem seus valores; onde estiver VAZIO,
herda do victim (ex.: pendencia_vsm/vendas_vsm/instalacoes_vsm). id_vsm vira
inteiro limpo. Move contatos/filiais do victim -> survivor e remove o victim.
"""
import json, re

BASE = r"c:\Users\luisa.jansen\Downloads\Pasta VS Code\prospeccao-regional-starlink"
OUT = BASE + r"\merge_pares_mesmo_vsm.sql"
res = json.loads(open(BASE + r"\_merge_full.json", encoding="utf-8-sig").read())[0]["results"]
by = {r["id"]: r for r in res}

# (survivor_id, victim_id)
PARES = [(81, 934), (229, 267), (251, 448), (311, 874), (14, 781), (254, 542), (383, 949)]

NUNCA = {"id", "codigo", "criado_em"}

def vazio(v): return v is None or str(v).strip() == ""
def sqlval(v):
    if v is None: return "NULL"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(int(v)) if float(v).is_integer() else repr(v)
    return "'" + str(v).replace("'", "''") + "'"
def idvsm_int(v):
    m = re.match(r"^\s*(\d+)", str(v or ""))
    return m.group(1) if m else None

linhas = []
linhas.append("-- Merge de 7 pares duplicados (MESMO id_vsm, gravado float vs int).")
linhas.append("-- Chave: id (UNICO). survivor mantido; victim removido apos consolidar.")
linhas.append("-- Aplicar: wrangler d1 execute prospeccao-starlink --remote --file=merge_pares_mesmo_vsm.sql")
linhas.append("")
linhas.append("BEGIN TRANSACTION;")
linhas.append("")

for sid, vid in PARES:
    s, v = by[sid], by[vid]
    vsm = idvsm_int(s.get("id_vsm")) or idvsm_int(v.get("id_vsm"))
    sets = {}
    # 1) herda do victim os campos que o survivor tem vazios
    for col in s:
        if col in NUNCA or col == "id_vsm":
            continue
        if vazio(s[col]) and not vazio(v[col]):
            sets[col] = v[col]
    # 2) id_vsm limpo (inteiro) sempre
    if str(s.get("id_vsm") or "").strip() != str(vsm or ""):
        sets["id_vsm"] = vsm

    linhas.append(f"-- id_vsm {vsm}: manter id={sid} ({s.get('codigo')}, {str(s.get('nome_fantasia'))[:26]!r}) "
                  f"| remover id={vid} ({v.get('codigo')}, origem {v.get('origem_contato')})")
    if sets:
        set_sql = ", ".join(f"{k}={sqlval(val)}" for k, val in sets.items())
        linhas.append(f"UPDATE empresas SET {set_sql}, atualizado_em=datetime('now') WHERE id={sid};")
    else:
        linhas.append(f"-- (survivor id={sid} ja completo; so remocao do victim)")
    # move relacionamentos do victim -> survivor (idempotente; 0 linhas se nao houver)
    linhas.append(f"UPDATE contatos SET empresa_id={sid} WHERE empresa_id={vid};")
    linhas.append(f"UPDATE filiais  SET empresa_id={sid} WHERE empresa_id={vid};")
    linhas.append(f"DELETE FROM empresas WHERE id={vid};")
    linhas.append("")

linhas.append("COMMIT;")
open(OUT, "w", encoding="utf-8").write("\n".join(linhas))
print("Gerado:", OUT)
print("Pares:", len(PARES))
