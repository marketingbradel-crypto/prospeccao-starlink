# -*- coding: utf-8 -*-
"""Merge dos 7 pares credenciamento×VSM com SO UM lado tendo id_vsm.
survivor = ficha Formulario (identidade correta); victim = ficha VSM (tem id_vsm).
Consolidacao survivor-first; survivor herda id_vsm/capilaridade/campos vazios do victim;
move contatos/filiais; remove victim. Chave: id (UNICO)."""
import json, re

BASE = r"c:\Users\luisa.jansen\Downloads\Pasta VS Code\prospeccao-regional-starlink"
OUT = BASE + r"\merge_pares_um_vsm.sql"
res = json.loads(open(BASE + r"\_merge_full2.json", encoding="utf-8-sig").read())[0]["results"]
by = {r["id"]: r for r in res}

# (survivor_id Formulario, victim_id VSM)
PARES = [(56, 48), (95, 253), (257, 55), (260, 121), (270, 159), (276, 206), (288, 211)]
NUNCA = {"id", "codigo", "criado_em"}

def vazio(v): return v is None or str(v).strip() == ""
def sqlval(v):
    if v is None: return "NULL"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(int(v)) if float(v).is_integer() else repr(v)
    return "'" + str(v).replace("'", "''") + "'"
def idvsm_int(v):
    m = re.match(r"^\s*(\d+)", str(v or "")); return m.group(1) if m else None

L = []
L.append("-- Merge de 7 pares credenciamento x VSM (SO UM lado tem id_vsm; sem conflito).")
L.append("-- Chave: id (UNICO). survivor=Formulario mantido; victim=VSM removido apos consolidar.")
L.append("-- Aplicar: wrangler d1 execute prospeccao-starlink --remote --file=merge_pares_um_vsm.sql")
L.append("-- (D1 aplica o arquivo atomicamente; em falha, volta ao estado original)")
L.append("")
for sid, vid in PARES:
    s, v = by[sid], by[vid]
    vsm = idvsm_int(s.get("id_vsm")) or idvsm_int(v.get("id_vsm"))
    sets = {}
    for col in s:
        if col in NUNCA or col == "id_vsm":
            continue
        if vazio(s[col]) and not vazio(v[col]):
            sets[col] = v[col]
    if str(s.get("id_vsm") or "").strip() != str(vsm or ""):
        sets["id_vsm"] = vsm
    L.append(f"-- id_vsm {vsm}: manter id={sid} ({s.get('codigo')}, {str(s.get('nome_fantasia'))[:26]!r}) "
             f"| remover id={vid} ({v.get('codigo')}, origem {v.get('origem_contato')})")
    if sets:
        set_sql = ", ".join(f"{k}={sqlval(val)}" for k, val in sets.items())
        L.append(f"UPDATE empresas SET {set_sql}, atualizado_em=datetime('now') WHERE id={sid};")
    else:
        L.append(f"-- (survivor id={sid} ja completo; so remocao do victim)")
    L.append(f"UPDATE contatos SET empresa_id={sid} WHERE empresa_id={vid};")
    L.append(f"UPDATE filiais  SET empresa_id={sid} WHERE empresa_id={vid};")
    L.append(f"DELETE FROM empresas WHERE id={vid};")
    L.append("")
open(OUT, "w", encoding="utf-8").write("\n".join(L))
print("Gerado:", OUT, "| pares:", len(PARES))
